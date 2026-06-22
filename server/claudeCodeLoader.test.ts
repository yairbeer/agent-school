/**
 * Tests for the Claude Code session loader.
 *
 * Fixtures are fully synthetic (neutral placeholder paths) — they do not point
 * at any real on-disk Claude sessions.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

import {
  encodeClaudePath,
  resolveClaudeSessionsDirectory,
  parseClaudeSessionFile,
  extractClaudeSessionSummary,
  reconstructClaudeBranch,
  listClaudeSessionsInDirectory,
  loadClaudeSessionFile,
} from "./claudeCodeLoader";

// A small but representative Claude Code JSONL transcript:
// - a permission-mode header line (ignored)
// - a meta/command user line (ignored)
// - a real user prompt
// - an assistant message with thinking + tool_use
// - a user tool_result
// - a final assistant text reply
// - an ai-title line (used for the display name)
const SAMPLE = [
  `{"type":"permission-mode","permissionMode":"default","sessionId":"sess-1"}`,
  `{"type":"user","isMeta":true,"uuid":"u0","parentUuid":null,"timestamp":"2026-06-01T10:00:00.000Z","cwd":"/Users/alice/projects/webapp","sessionId":"sess-1","gitBranch":"main","version":"2.1.0","message":{"role":"user","content":"<command-name>/model</command-name>"}}`,
  `{"type":"user","uuid":"u1","parentUuid":null,"timestamp":"2026-06-01T10:00:01.000Z","cwd":"/Users/alice/projects/webapp","sessionId":"sess-1","gitBranch":"main","version":"2.1.0","message":{"role":"user","content":"Add a retry to the fetch helper"}}`,
  `{"type":"assistant","uuid":"a1","parentUuid":"u1","timestamp":"2026-06-01T10:00:02.000Z","cwd":"/Users/alice/projects/webapp","sessionId":"sess-1","message":{"role":"assistant","model":"claude-opus-4","content":[{"type":"thinking","thinking":"Let me read the helper first."},{"type":"tool_use","id":"tu1","name":"Read","input":{"file_path":"/Users/alice/projects/webapp/fetch.ts"}}],"stop_reason":"tool_use","usage":{"input_tokens":10,"output_tokens":20,"cache_read_input_tokens":5}}}`,
  `{"type":"user","uuid":"u2","parentUuid":"a1","timestamp":"2026-06-01T10:00:03.000Z","cwd":"/Users/alice/projects/webapp","sessionId":"sess-1","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tu1","content":"export async function fetchJson() {}"}]}}`,
  `{"type":"user","uuid":"u3","parentUuid":"a1","timestamp":"2026-06-01T10:00:04.000Z","cwd":"/Users/alice/projects/webapp","sessionId":"sess-1","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tu-missing","content":"boom","is_error":true}]}}`,
  `{"type":"assistant","uuid":"a2","parentUuid":"u2","timestamp":"2026-06-01T10:00:05.000Z","cwd":"/Users/alice/projects/webapp","sessionId":"sess-1","message":{"role":"assistant","model":"claude-opus-4","content":[{"type":"text","text":"Done — added a retry loop."}],"stop_reason":"end_turn","usage":{"input_tokens":30,"output_tokens":40}}}`,
  `{"type":"ai-title","sessionId":"sess-1","aiTitle":"Add retry to fetch helper"}`,
].join("\n");

describe("Claude Code Loader", () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-loader-tests-"));
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe("encodeClaudePath", () => {
    it("replaces every non-alphanumeric char with a dash", () => {
      expect(encodeClaudePath("/Users/alice/projects/webapp")).toBe(
        "-Users-alice-projects-webapp"
      );
    });

    it("collapses underscores and dots like Claude does", () => {
      expect(encodeClaudePath("/Users/alice/my_app.v2")).toBe("-Users-alice-my-app-v2");
    });

    it("normalizes Windows backslashes", () => {
      expect(encodeClaudePath("C:\\Users\\alice\\app")).toBe("C--Users-alice-app");
    });
  });

  describe("resolveClaudeSessionsDirectory", () => {
    it("builds a path under ~/.claude/projects", () => {
      const dir = resolveClaudeSessionsDirectory("/Users/alice/projects/webapp");
      expect(dir).toBe(
        path.join(os.homedir(), ".claude", "projects", "-Users-alice-projects-webapp")
      );
    });

    it("passes through an existing .claude/projects directory", () => {
      const existing = path.join(os.homedir(), ".claude", "projects", "-foo");
      expect(resolveClaudeSessionsDirectory(existing)).toBe(existing);
    });
  });

  describe("parse + summary", () => {
    it("parses entries and tolerates bad lines", () => {
      const file = path.join(tempDir, "bad.jsonl");
      fs.writeFileSync(file, `${SAMPLE}\nnot json here\n`);
      const { entries, warnings } = parseClaudeSessionFile(file);
      expect(entries.length).toBeGreaterThan(0);
      expect(warnings.some((w) => w.includes("Failed to parse JSON"))).toBe(true);
    });

    it("uses the ai-title as the display name and counts only messages", () => {
      const file = path.join(tempDir, "summary.jsonl");
      fs.writeFileSync(file, SAMPLE);
      const { entries } = parseClaudeSessionFile(file);
      const summary = extractClaudeSessionSummary(file, entries)!;
      expect(summary.displayName).toBe("Add retry to fetch helper");
      expect(summary.models).toEqual(["claude-opus-4"]);
      // 2 user prompts/results + tool result + 2 assistant + meta user = counted
      expect(summary.messageCount).toBeGreaterThanOrEqual(4);
      // input+output+cache tokens summed across assistant usage
      expect(summary.tokenTotal).toBe(10 + 20 + 5 + 30 + 40);
      expect(summary.costTotal).toBe(0);
    });
  });

  describe("reconstructClaudeBranch", () => {
    it("renders user/assistant/thinking/toolResult rows in order", () => {
      const file = path.join(tempDir, "branch.jsonl");
      fs.writeFileSync(file, SAMPLE);
      const { entries } = parseClaudeSessionFile(file);
      const branch = reconstructClaudeBranch(entries, file);

      const kinds = branch.entries.map((e) => e.kind);
      expect(kinds).toContain("user");
      expect(kinds).toContain("assistant");
      expect(kinds).toContain("thinking");
      expect(kinds).toContain("toolResult");

      // The meta/command user line must be dropped.
      const userTexts = branch.entries
        .filter((e) => e.kind === "user")
        .map((e) => e.payload.content);
      expect(userTexts).toContain("Add a retry to the fetch helper");
      expect(userTexts.some((t) => typeof t === "string" && t.includes("command-name"))).toBe(
        false
      );

      // tool_use id is resolved back to a tool name on the result row.
      const okResult = branch.entries.find(
        (e) => e.kind === "toolResult" && e.payload.toolCallId === "tu1"
      );
      expect(okResult?.payload.toolName).toBe("Read");

      // An errored tool_result is flagged as friction.
      const errResult = branch.entries.find(
        (e) => e.kind === "toolResult" && e.payload.isError === true
      );
      expect(errResult?.friction?.isError).toBe(true);

      expect(branch.metadata.agent).toBe("claude-code");
      expect(branch.metadata.cwd).toBe("/Users/alice/projects/webapp");
      expect(branch.header.displayName).toBe("Add retry to fetch helper");
    });
  });

  describe("list + load", () => {
    it("lists sessions in a directory and skips non-jsonl files", () => {
      const dir = path.join(tempDir, "sessions");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "sess-1.jsonl"), SAMPLE);
      fs.writeFileSync(path.join(dir, "notes.txt"), "ignore me");

      const { sessions, warnings } = listClaudeSessionsInDirectory(dir);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].displayName).toBe("Add retry to fetch helper");
      expect(warnings).toHaveLength(0);
    });

    it("warns when the directory does not exist", () => {
      const { sessions, warnings } = listClaudeSessionsInDirectory(
        path.join(tempDir, "does-not-exist")
      );
      expect(sessions).toHaveLength(0);
      expect(warnings.some((w) => w.includes("does not exist"))).toBe(true);
    });

    it("loads a single session file into a ParsedSession", () => {
      const file = path.join(tempDir, "load.jsonl");
      fs.writeFileSync(file, SAMPLE);
      const parsed = loadClaudeSessionFile(file)!;
      expect(parsed).not.toBeNull();
      expect(parsed.branches).toHaveLength(1);
      expect(parsed.header.agent).toBe("claude-code");
      expect(parsed.branches[0].entries.length).toBeGreaterThan(0);
    });
  });
});
