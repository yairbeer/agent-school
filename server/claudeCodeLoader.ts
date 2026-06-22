/**
 * Session loader for Claude Code (claude.ai/code) sessions.
 *
 * Claude Code stores per-project transcripts as JSONL under
 *   ~/.claude/projects/<encoded-project-path>/<session-uuid>.jsonl
 *
 * The on-disk format differs from pi's:
 *   - There is no leading `session` header line; metadata (cwd, sessionId,
 *     version, gitBranch) is repeated on every entry.
 *   - Entries are tagged with a top-level `type` ("user" | "assistant" |
 *     "system" | "file-history-snapshot" | "ai-title" | ...). Only user and
 *     assistant entries carry conversation content.
 *   - Assistant content is an array of blocks: { type: "thinking" | "text" |
 *     "tool_use" }. User content is either a plain string or an array that may
 *     contain { type: "tool_result" } blocks.
 *   - Usage lives under message.usage as { input_tokens, output_tokens,
 *     cache_* }, and cost is not recorded.
 *
 * This module converts that format into the same SessionSummary /
 * ParsedSession / RenderableEntry shapes the rest of the app already consumes,
 * so the review/aggregate/propose pipeline works unchanged.
 */

import fs from "fs";
import path from "path";
import os from "os";
import { createHash } from "crypto";

import type {
  SessionSummary,
  RenderableEntry,
  ConversationBranch,
  ParsedSession,
} from "../shared/types.js";

/** A raw Claude Code JSONL entry (loosely typed; shape varies by `type`). */
interface ClaudeEntry {
  type?: string;
  uuid?: string;
  parentUuid?: string | null;
  isSidechain?: boolean;
  isMeta?: boolean;
  timestamp?: string;
  cwd?: string;
  sessionId?: string;
  version?: string;
  gitBranch?: string;
  aiTitle?: string;
  message?: {
    role?: string;
    model?: string;
    content?: unknown;
    usage?: Record<string, unknown>;
  };
}

/**
 * Encode a filesystem path to Claude Code's project-folder scheme.
 * Claude replaces every non-alphanumeric character with a dash, so the
 * encoding is lossy (both `/` and `_` collapse to `-`). We therefore never
 * decode it; the project path is supplied by the user and the real `cwd` is
 * read back from inside each session file.
 *
 * E.g. /Users/alice/projects/my_app -> -Users-alice-projects-my-app
 */
export function encodeClaudePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  return normalized.replace(/[^a-zA-Z0-9]/g, "-");
}

/**
 * Resolve the Claude Code sessions directory for a given project directory.
 * Accepts either a project path (encoded on the fly) or an explicit existing
 * directory under ~/.claude/projects.
 */
export function resolveClaudeSessionsDirectory(pathInput: string): string {
  // Already a Claude projects directory? Use as-is.
  if (pathInput.includes(`${path.sep}.claude${path.sep}projects`)) {
    return pathInput;
  }
  const base = path.join(os.homedir(), ".claude", "projects");
  return path.join(base, encodeClaudePath(pathInput));
}

/** True for user content strings that are slash-command/CLI noise, not prose. */
function isCommandNoise(text: string): boolean {
  const t = text.trimStart();
  return (
    t.startsWith("<command-name>") ||
    t.startsWith("<command-message>") ||
    t.startsWith("<local-command-") ||
    t.startsWith("<command-args>")
  );
}

/** Parse a Claude Code JSONL file into raw entries, tolerating bad lines. */
export function parseClaudeSessionFile(filePath: string): {
  entries: ClaudeEntry[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const entries: ClaudeEntry[] = [];

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n").filter((l) => l.length > 0);
    for (let i = 0; i < lines.length; i++) {
      try {
        entries.push(JSON.parse(lines[i]) as ClaudeEntry);
      } catch (err) {
        warnings.push(
          `Line ${i + 1}: Failed to parse JSON (${
            err instanceof Error ? err.message : "unknown error"
          })`
        );
      }
    }
  } catch (err) {
    warnings.push(
      `Failed to read file: ${err instanceof Error ? err.message : "unknown error"}`
    );
  }

  return { entries, warnings };
}

/** Pull readable text out of a Claude tool_result content value. */
function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && typeof (b as any).text === "string" ? (b as any).text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/**
 * Build a map of tool_use id -> tool name by scanning assistant content, so
 * tool_result entries (which only carry the id) can show the tool name.
 */
function buildToolNameMap(entries: ClaudeEntry[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of entries) {
    if (entry.type === "assistant" && Array.isArray(entry.message?.content)) {
      for (const block of entry.message!.content as any[]) {
        if (block?.type === "tool_use" && block.id && block.name) {
          map.set(block.id, block.name);
        }
      }
    }
  }
  return map;
}

/**
 * Convert a single Claude entry into zero or more RenderableEntry rows.
 * Assistant entries with thinking blocks produce a separate thinking row plus
 * the assistant row (Claude keeps thinking + tool_use in one message).
 */
function toRenderableEntries(
  entry: ClaudeEntry,
  toolNames: Map<string, string>
): RenderableEntry[] {
  const id = entry.uuid || createHash("sha256").update(JSON.stringify(entry)).digest("hex").slice(0, 16);
  const parentId = entry.parentUuid ?? null;
  const msg = entry.message;

  if (entry.type === "user") {
    const content = msg?.content;

    // Tool results arrive as user entries with an array content of
    // { type: "tool_result" } blocks. Render each as a toolResult row.
    if (Array.isArray(content)) {
      const rows: RenderableEntry[] = [];
      for (const block of content as any[]) {
        if (block?.type === "tool_result") {
          const isError = block.is_error === true;
          rows.push({
            entryId: `${id}-${block.tool_use_id ?? rows.length}`,
            parentId,
            kind: "toolResult",
            payload: {
              toolCallId: block.tool_use_id,
              toolName: block.tool_use_id ? toolNames.get(block.tool_use_id) : undefined,
              content: toolResultText(block.content),
              isError,
            },
            friction: isError ? { isError: true, signal: "tool-error" } : undefined,
          });
        } else if (block?.type === "text" && typeof block.text === "string") {
          rows.push({
            entryId: id,
            parentId,
            kind: "user",
            payload: { role: "user", content: block.text },
          });
        }
      }
      return rows;
    }

    if (typeof content === "string") {
      if (!content.trim() || isCommandNoise(content)) return [];
      return [
        {
          entryId: id,
          parentId,
          kind: "user",
          payload: { role: "user", content },
        },
      ];
    }
    return [];
  }

  if (entry.type === "assistant") {
    const content = msg?.content;
    if (!Array.isArray(content)) return [];

    const rows: RenderableEntry[] = [];
    const thinking = (content as any[])
      .filter((b) => b?.type === "thinking" && typeof b.thinking === "string")
      .map((b) => b.thinking)
      .join("\n");
    if (thinking) {
      rows.push({
        entryId: `${id}-thinking`,
        parentId,
        kind: "thinking",
        payload: { thinking },
      });
    }

    // Keep text + tool_use blocks for the assistant row (drop raw thinking;
    // it is captured above so it can be excluded independently).
    const assistantContent = (content as any[]).filter((b) => b?.type !== "thinking");
    if (assistantContent.length > 0) {
      rows.push({
        entryId: id,
        parentId,
        kind: "assistant",
        payload: {
          role: "assistant",
          content: assistantContent,
          stopReason: (msg as any)?.stop_reason,
          model: msg?.model,
          usage: msg?.usage,
        },
      });
    }
    return rows;
  }

  return [];
}

/**
 * Build the conversation transcript in file order.
 *
 * Claude Code writes entries chronologically, so file order already reflects
 * the active conversation. We deliberately avoid a parentUuid walk here: parent
 * links frequently point at non-conversation entries (system / snapshots) that
 * we filter out, which would truncate the chain. We drop sidechains (subagent
 * branches) and meta rows (slash-command echoes) instead.
 */
export function reconstructClaudeBranch(
  entries: ClaudeEntry[],
  filePath: string
): ConversationBranch {
  const convo = entries.filter(
    (e) =>
      (e.type === "user" || e.type === "assistant") &&
      !e.isSidechain &&
      !e.isMeta &&
      e.uuid
  );

  const toolNames = buildToolNameMap(entries);
  const renderable: RenderableEntry[] = [];
  for (const e of convo) {
    renderable.push(...toRenderableEntries(e, toolNames));
  }

  const first = entries.find((e) => e.timestamp);
  const timestamp = first?.timestamp ? new Date(first.timestamp).getTime() : Date.now();
  const sessionId = entries.find((e) => e.sessionId)?.sessionId || path.basename(filePath, ".jsonl");
  const cwd = entries.find((e) => e.cwd)?.cwd;
  const aiTitle = entries.find((e) => e.type === "ai-title" && e.aiTitle)?.aiTitle;

  const metadata: Record<string, unknown> = { agent: "claude-code" };
  if (cwd) metadata.cwd = cwd;
  const gitBranch = entries.find((e) => e.gitBranch)?.gitBranch;
  if (gitBranch) metadata.gitBranch = gitBranch;
  const version = entries.find((e) => e.version)?.version;
  if (version) metadata.version = version;

  return {
    header: {
      sessionId,
      timestamp,
      displayName: aiTitle || sessionId,
    },
    entries: renderable,
    metadata,
    warnings: [],
  };
}

/** Build a SessionSummary from parsed Claude entries. */
export function extractClaudeSessionSummary(
  filePath: string,
  entries: ClaudeEntry[]
): SessionSummary | null {
  if (entries.length === 0) return null;

  const first = entries.find((e) => e.timestamp);
  const timestamp = first?.timestamp ? new Date(first.timestamp).getTime() : Date.now();

  // Prefer Claude's own ai-title; otherwise the first real user prompt.
  let displayName = entries.find((e) => e.type === "ai-title" && e.aiTitle)?.aiTitle || "";
  if (!displayName) {
    for (const entry of entries) {
      if (entry.type === "user" && !entry.isMeta) {
        const content = entry.message?.content;
        if (typeof content === "string" && content.trim() && !isCommandNoise(content)) {
          displayName = content.substring(0, 100);
          break;
        }
      }
    }
  }
  if (!displayName) displayName = path.basename(filePath);

  const models: string[] = [];
  let totalTokens = 0;
  let messageCount = 0;
  let thinkingChars = 0;
  let contentChars = 0;

  for (const entry of entries) {
    if (entry.type !== "user" && entry.type !== "assistant") continue;
    messageCount++;
    const msg = entry.message;
    if (!msg) continue;

    if (entry.type === "assistant" && msg.model && !models.includes(msg.model)) {
      models.push(msg.model);
    }

    const usage = msg.usage as any;
    if (usage) {
      totalTokens +=
        (usage.input_tokens || 0) +
        (usage.output_tokens || 0) +
        (usage.cache_creation_input_tokens || 0) +
        (usage.cache_read_input_tokens || 0);
    }

    const content = msg.content;
    if (typeof content === "string") {
      contentChars += content.length;
    } else if (Array.isArray(content)) {
      for (const block of content as any[]) {
        if (!block || typeof block !== "object") continue;
        if (typeof block.text === "string") contentChars += block.text.length;
        if (typeof block.thinking === "string") {
          thinkingChars += block.thinking.length;
          contentChars += block.thinking.length;
        }
        if (block.type === "tool_use" && block.input) {
          contentChars += JSON.stringify(block.input).length;
        }
        if (block.type === "tool_result") {
          contentChars += toolResultText(block.content).length;
        }
      }
    }
  }

  const contentTokenTotal = Math.round(contentChars / 4);
  const thinkingTokenTotal = Math.min(Math.round(thinkingChars / 4), contentTokenTotal);

  const id = createHash("sha256").update(filePath).digest("hex").substring(0, 16);

  return {
    id,
    filePath,
    displayName,
    timestamp,
    messageCount,
    models,
    tokenTotal: totalTokens,
    costTotal: 0,
    contentTokenTotal,
    thinkingTokenTotal,
  };
}

/** List Claude Code sessions in a directory as SessionSummary[]. */
export function listClaudeSessionsInDirectory(sessionsDirPath: string): {
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

    for (const item of fs.readdirSync(sessionsDirPath)) {
      if (!item.endsWith(".jsonl")) continue;
      const filePath = path.join(sessionsDirPath, item);
      try {
        const { entries, warnings: parseWarnings } = parseClaudeSessionFile(filePath);
        if (parseWarnings.length > 0) warnings.push(`${item}: ${parseWarnings.join("; ")}`);
        const summary = extractClaudeSessionSummary(filePath, entries);
        // Skip empty/transcript-less sessions (e.g. command-only stubs).
        if (summary && summary.messageCount > 0) sessions.push(summary);
      } catch (err) {
        warnings.push(
          `${item}: Failed to process (${err instanceof Error ? err.message : "unknown error"})`
        );
      }
    }

    sessions.sort((a, b) => b.timestamp - a.timestamp);
  } catch (err) {
    warnings.push(
      `Failed to list sessions: ${err instanceof Error ? err.message : "unknown error"}`
    );
  }

  return { sessions, warnings };
}

/** Load and parse a single Claude Code session file. */
export function loadClaudeSessionFile(filePath: string): ParsedSession | null {
  const { entries, warnings } = parseClaudeSessionFile(filePath);
  if (entries.length === 0) return null;

  const branch = reconstructClaudeBranch(entries, filePath);
  const id = createHash("sha256").update(filePath).digest("hex").substring(0, 16);

  return {
    id,
    filePath,
    header: { agent: "claude-code", sessionId: branch.header.sessionId },
    branches: [branch],
    warnings,
  };
}
