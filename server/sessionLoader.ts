/**
 * Session loader and discovery for pi-coding-agent sessions
 * Implements FR-1 through FR-4 from the task spec
 */

import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { createHash } from "crypto";

import {
  migrateSessionEntries,
  type SessionEntry,
  type SessionHeader,
  type SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";

import type {
  SessionSummary,
  RenderableEntry,
  ConversationBranch,
  ParsedSession,
} from "../shared/types.js";

/**
 * FR-1: Path encoder/decoder for pi's --path-- scheme
 * /Users/alice/projects/webapp <-> --Users-alice-projects-webapp--
 * Cross-platform: / becomes - in the encoding
 */

/**
 * Sentinel project dir that points at the bundled demo sessions, so the tool
 * can be tried without any real pi sessions on disk.
 */
export const DEMO_DIR = "__demo__";

/**
 * Resolve the on-disk project directory for a given input. The only special
 * case is the demo sentinel, which maps to the repo's bundled `demo/` folder.
 */
export function resolveProjectDir(dir: string): string {
  if (dir === DEMO_DIR) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(here, "..", "demo");
  }
  return dir;
}

/**
 * Encode a filesystem path to pi's --path-- scheme
 * E.g., /Users/alice/projects/webapp -> --Users-alice-projects-webapp--
 */
export function encodePath(filePath: string): string {
  // On Windows, convert backslashes to forward slashes first
  const normalized = filePath.replace(/\\/g, "/");

  // Remove leading slash for consistent encoding
  const pathPart = normalized.startsWith("/")
    ? normalized.substring(1)
    : normalized;

  // Replace all slashes with dashes
  const encoded = pathPart.replace(/\//g, "-");

  // Wrap with --
  return `--${encoded}--`;
}

/**
 * Decode a pi --path-- scheme back to a filesystem path
 * E.g., --Users-alice-projects-webapp-- -> /Users/alice/projects/webapp
 */
export function decodePath(encodedPath: string): string {
  // Remove leading and trailing --
  let decoded = encodedPath;
  if (decoded.startsWith("--") && decoded.endsWith("--")) {
    decoded = decoded.substring(2, decoded.length - 2);
  }

  // Replace dashes with slashes
  const filePath = decoded.replace(/-/g, "/");

  // Add leading slash for absolute paths
  return "/" + filePath;
}

/**
 * Resolve a session directory path
 * Accepts either: pi-encoded --path-- scheme or direct path
 * Returns the sessions directory
 */
export function resolveSessionsDirectory(pathInput: string): string {
  // Demo sentinel: bundled sessions under <repo>/demo/sessions
  if (pathInput === DEMO_DIR) {
    return path.join(resolveProjectDir(pathInput), "sessions");
  }

  let projectDir: string;

  // Check if it's a pi-encoded path
  if (pathInput.startsWith("--") && pathInput.endsWith("--")) {
    projectDir = decodePath(pathInput);
  } else {
    projectDir = pathInput;
  }

  // If it's already a sessions directory (ends with /.pi/agent/sessions/something),
  // return it as-is; otherwise build the path
  if (projectDir.includes("/.pi/agent/sessions")) {
    return projectDir;
  }

  // Build path to sessions directory for this project
  // ~/.pi/agent/sessions/--encoded-path--/
  const homeDir = os.homedir();
  const sessionsDirBase = path.join(homeDir, ".pi", "agent", "sessions");
  const encodedProjectPath = encodePath(projectDir);
  return path.join(sessionsDirBase, encodedProjectPath);
}

/**
 * FR-2: Extract metadata from a session file to build SessionSummary
 */
export function extractSessionSummary(
  filePath: string,
  header: SessionHeader,
  entries: SessionEntry[]
): SessionSummary | null {
  const fileName = path.basename(filePath);
  let displayName = fileName;
  let timestamp = header.timestamp
    ? new Date(header.timestamp).getTime()
    : Date.now();

  let firstUserMessage = "";
  let models: string[] = [];
  let totalTokens = 0;
  let totalCost = 0;

  // Look for session_info to get display name
  for (const entry of entries) {
    if (entry.type === "session_info") {
      const infoEntry = entry as any;
      if (infoEntry.name) {
        displayName = infoEntry.name;
        break;
      }
    }
  }

  // If no session_info name found, try first user message
  if (displayName === fileName) {
    for (const entry of entries) {
      if (entry.type === "message") {
        const msgEntry = entry as SessionMessageEntry;
        if (msgEntry.message?.role === "user") {
          const content = msgEntry.message.content;
          if (typeof content === "string") {
            firstUserMessage = content.substring(0, 100);
          } else if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "text") {
                firstUserMessage = (block as any).text.substring(0, 100);
                break;
              }
            }
          }
          if (firstUserMessage) {
            displayName = firstUserMessage;
            break;
          }
        }
      }
    }
  }

  // Collect models and token/cost data
  let thinkingChars = 0;
  let contentChars = 0;
  const addText = (v: unknown) => {
    if (typeof v === "string") contentChars += v.length;
  };
  for (const entry of entries) {
    if (entry.type === "message") {
      const msgEntry = entry as SessionMessageEntry;
      if (
        msgEntry.message?.role === "assistant" &&
        msgEntry.message.model &&
        !models.includes(msgEntry.message.model)
      ) {
        models.push(msgEntry.message.model);
      }

      // Sum usage from assistant messages
      if (
        msgEntry.message?.role === "assistant" &&
        msgEntry.message.usage
      ) {
        const usage = msgEntry.message.usage as any;
        if (usage.totalTokens) {
          totalTokens += usage.totalTokens;
        }
        if (usage.cost?.total) {
          totalCost += usage.cost.total;
        }
      }

      // Estimate transcript content size (~4 chars/token) and the portion
      // attributable to thinking, so the UI can show how excluding thinking
      // changes the analysis-input size and cost estimate.
      const msg = msgEntry.message as any;
      if (msg) {
        if (Array.isArray(msg.content)) {
          for (const block of msg.content as any[]) {
            if (!block || typeof block !== "object") {
              addText(block);
              continue;
            }
            if (typeof block.text === "string") addText(block.text);
            if (typeof block.thinking === "string") {
              thinkingChars += block.thinking.length;
              contentChars += block.thinking.length;
            }
          }
        } else {
          addText(msg.content);
        }
        addText(msg.command);
        addText(msg.output);
      }
    }
  }

  const contentTokenTotal = Math.round(contentChars / 4);
  const thinkingTokenTotal = Math.min(
    Math.round(thinkingChars / 4),
    contentTokenTotal
  );

  // Generate ID from file path hash
  const hash = createHash("sha256").update(filePath).digest("hex");
  const id = hash.substring(0, 16);

  return {
    id,
    filePath,
    displayName,
    timestamp,
    messageCount: entries.length,
    models,
    tokenTotal: totalTokens,
    costTotal: totalCost,
    contentTokenTotal,
    thinkingTokenTotal,
  };
}

/**
 * FR-3: Robust JSONL parsing
 * Tolerates unknown types, skips malformed lines with warnings,
 * handles versions 1-3 via migration; never throws
 */
export function parseSessionFile(
  filePath: string
): { header?: SessionHeader; entries: SessionEntry[]; warnings: string[] } {
  const warnings: string[] = [];
  let header: SessionHeader | undefined;
  const entries: SessionEntry[] = [];

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n").filter((line) => line.length > 0);

    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1;
      try {
        const json = JSON.parse(lines[i]);

        if (i === 0 && json.type === "session") {
          // First line is the session header
          header = json as SessionHeader;

          // Handle version migration
          const version = header.version || 1;
          if (version < 3) {
            warnings.push(
              `Session is version ${version}, will be auto-migrated to v3`
            );
          }
        } else {
          // Regular entry
          entries.push(json);
        }
      } catch (parseErr) {
        // Malformed JSON on this line - skip with warning
        warnings.push(
          `Line ${lineNum}: Failed to parse JSON (${
            parseErr instanceof Error ? parseErr.message : "unknown error"
          })`
        );
      }
    }

    // Apply migration if needed
    if (header && (header.version || 1) < 3) {
      try {
        const allEntries = [header as any, ...entries];
        const migratedEntries = migrateSessionEntries(
          allEntries
        ) as SessionEntry[];

        // Extract header from migrated entries
        if (migratedEntries.length > 0 && migratedEntries[0].type === "session") {
          header = migratedEntries[0] as SessionHeader;
          entries.length = 0;
          entries.push(...migratedEntries.slice(1));
        }
      } catch (migrationErr) {
        warnings.push(
          `Migration failed: ${
            migrationErr instanceof Error ? migrationErr.message : "unknown error"
          }`
        );
      }
    }
  } catch (err) {
    warnings.push(
      `Failed to read file: ${err instanceof Error ? err.message : "unknown error"}`
    );
  }

  return { header, entries, warnings };
}

/**
 * FR-4: Reconstruct active branch and compute friction flags
 */
function computeFrictionFlags(
  entry: SessionEntry
): { isError?: boolean; signal?: string } | undefined {
  const friction: { isError?: boolean; signal?: string } = {};

  if (entry.type === "message") {
    const msgEntry = entry as SessionMessageEntry;

    // Check toolResult for isError
    if (msgEntry.message?.role === "toolResult") {
      const trMsg = msgEntry.message as any;
      if (trMsg.isError) {
        friction.isError = true;
        friction.signal = "tool-error";
      }
    }

    // Check assistant stopReason for error
    if (msgEntry.message?.role === "assistant") {
      const assistantMsg = msgEntry.message as any;
      if (assistantMsg.stopReason === "error") {
        friction.signal = "stop-reason-error";
      }
    }
  }

  // Check bash execution for non-zero exit code
  if (entry.type === "message") {
    const msgEntry = entry as SessionMessageEntry;
    if (msgEntry.message?.role === "bashExecution") {
      const bashMsg = msgEntry.message as any;
      if (bashMsg.exitCode !== 0 && bashMsg.exitCode !== undefined) {
        friction.isError = true;
        friction.signal = "nonzero-exit";
      }
    }
  }

  return Object.keys(friction).length > 0 ? friction : undefined;
}

/**
 * Convert SessionEntry to RenderableEntry
 */
function toRenderableEntry(entry: SessionEntry): RenderableEntry {
  let kind: RenderableEntry["kind"] = "summary";
  let payload: Record<string, unknown> = {};

  if (entry.type === "message") {
    const msgEntry = entry as SessionMessageEntry;
    const msg = msgEntry.message;

    if (msg?.role === "user") {
      kind = "user";
      payload = { role: "user", content: msg.content };
    } else if (msg?.role === "assistant") {
      kind = "assistant";
      payload = {
        role: "assistant",
        content: msg.content,
        stopReason: (msg as any).stopReason,
        model: (msg as any).model,
        usage: (msg as any).usage,
      };
    } else if (msg?.role === "toolResult") {
      kind = "toolResult";
      payload = {
        toolCallId: (msg as any).toolCallId,
        toolName: (msg as any).toolName,
        content: msg.content,
        isError: (msg as any).isError,
      };
    } else if (msg?.role === "bashExecution") {
      kind = "bash";
      payload = {
        command: (msg as any).command,
        output: (msg as any).output,
        exitCode: (msg as any).exitCode,
      };
    } else if (msg?.role === "custom") {
      kind = "toolCall";
      payload = { customType: (msg as any).customType, content: msg.content };
    }

    // Check for thinking content in assistant messages
    if (msg?.role === "assistant" && Array.isArray(msg.content)) {
      const thinkingBlocks = (msg.content as any[]).filter(
        (b) => b.type === "thinking"
      );
      if (thinkingBlocks.length > 0) {
        // Create thinking entry
        return {
          entryId: `${entry.id}-thinking`,
          parentId: entry.parentId,
          kind: "thinking",
          payload: {
            thinking: thinkingBlocks.map((b: any) => b.thinking).join("\n"),
          },
          friction: undefined,
        };
      }
    }
  } else if (entry.type === "compaction") {
    kind = "summary";
    payload = {
      type: "compaction",
      summary: (entry as any).summary,
    };
  } else if (entry.type === "branch_summary") {
    kind = "summary";
    payload = {
      type: "branch_summary",
      summary: (entry as any).summary,
      fromId: (entry as any).fromId,
    };
  }

  return {
    entryId: entry.id,
    parentId: entry.parentId,
    kind,
    payload,
    friction: computeFrictionFlags(entry),
  };
}

/**
 * FR-4: Reconstruct the active branch (leaf to root)
 */
export function reconstructActiveBranch(
  entries: SessionEntry[],
  header: SessionHeader
): ConversationBranch {
  // Build a map of entries by ID for quick lookup
  const entryMap = new Map<string, SessionEntry>();
  for (const entry of entries) {
    entryMap.set(entry.id, entry);
  }

  // Find the leaf (entry with no children, or last entry in tree walk)
  let leafEntry: SessionEntry | undefined;
  const hasChildren = new Set<string>();
  for (const entry of entries) {
    if (entry.parentId) {
      hasChildren.add(entry.parentId);
    }
  }

  // The leaf is an entry that has no children
  for (const entry of entries) {
    if (!hasChildren.has(entry.id)) {
      // Prefer the last one added if multiple leaves exist
      leafEntry = entry;
    }
  }

  // Walk from leaf to root
  const branchEntries: SessionEntry[] = [];
  let current = leafEntry;

  while (current) {
    branchEntries.unshift(current); // Prepend to build root->leaf order, then reverse
    if (!current.parentId) break;

    current = entryMap.get(current.parentId);
  }

  // Reverse to get leaf->root order
  branchEntries.reverse();

  // Convert to RenderableEntry[]
  const renderableEntries = branchEntries.map(toRenderableEntry);

  // Extract timestamp and display name
  const timestamp = header.timestamp
    ? new Date(header.timestamp).getTime()
    : Date.now();

  const displayName = header.id || "Unnamed Session";

  const metadata: Record<string, unknown> = {};
  if ((header as any).version) {
    metadata.version = (header as any).version;
  }
  if ((header as any).cwd) {
    metadata.cwd = (header as any).cwd;
  }

  return {
    header: {
      sessionId: header.id,
      timestamp,
      displayName,
    },
    entries: renderableEntries,
    metadata,
    warnings: [],
  };
}

/**
 * FR-2: List all .jsonl sessions in a directory
 * Returns SessionSummary[] with metadata
 */
export function listSessionsInDirectory(sessionsDirPath: string): {
  sessions: SessionSummary[];
  warnings: string[];
} {
  const sessions: SessionSummary[] = [];
  const warnings: string[] = [];

  try {
    if (!fs.existsSync(sessionsDirPath)) {
      warnings.push(`Sessions directory does not exist: ${sessionsDirPath}`);
      return { sessions, warnings };
    }

    // List all files in the sessions directory
    const items = fs.readdirSync(sessionsDirPath);

    for (const item of items) {
      if (!item.endsWith(".jsonl")) {
        continue; // Skip non-JSONL files
      }

      const filePath = path.join(sessionsDirPath, item);

      try {
        const { header, entries, warnings: parseWarnings } =
          parseSessionFile(filePath);

        if (parseWarnings.length > 0) {
          warnings.push(
            `${item}: ${parseWarnings.join("; ")}`
          );
        }

        if (!header) {
          warnings.push(`${item}: No session header found`);
          continue;
        }

        const summary = extractSessionSummary(filePath, header, entries);
        if (summary) {
          sessions.push(summary);
        }
      } catch (err) {
        warnings.push(
          `${item}: Failed to process (${
            err instanceof Error ? err.message : "unknown error"
          })`
        );
      }
    }

    // Sort by timestamp descending (newest first)
    sessions.sort((a, b) => b.timestamp - a.timestamp);
  } catch (err) {
    warnings.push(
      `Failed to list sessions: ${
        err instanceof Error ? err.message : "unknown error"
      }`
    );
  }

  return { sessions, warnings };
}

/**
 * Load and parse a single session file
 */
export function loadSessionFile(filePath: string): ParsedSession | null {
  const { header, entries, warnings } = parseSessionFile(filePath);

  if (!header) {
    return null;
  }

  const branch = reconstructActiveBranch(entries, header);

  // Generate ID from file path hash
  const hash = createHash("sha256").update(filePath).digest("hex");
  const id = hash.substring(0, 16);

  return {
    id,
    filePath,
    header: header as unknown as Record<string, unknown>,
    branches: [branch],
    warnings,
  };
}
