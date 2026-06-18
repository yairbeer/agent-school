/**
 * Vitest fixtures and test suite for session loader
 * Tests FR-1 through FR-4
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

import {
  encodePath,
  decodePath,
  resolveSessionsDirectory,
  parseSessionFile,
  extractSessionSummary,
  reconstructActiveBranch,
  listSessionsInDirectory,
  loadSessionFile,
} from "./sessionLoader";

import type { SessionEntry, SessionHeader } from "@earendil-works/pi-coding-agent";

describe("Session Loader", () => {
  let tempDir: string;

  beforeAll(() => {
    // Create a temporary directory for test fixtures
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-loader-tests-"));
  });

  afterAll(() => {
    // Clean up temporary directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("FR-1: Path encoding/decoding", () => {
    it("should encode absolute paths to pi --path-- scheme", () => {
      const result = encodePath("/Users/alice/projects/webapp");
      expect(result).toBe("--Users-alice-projects-webapp--");
    });

    it("should encode paths with multiple slashes", () => {
      const result = encodePath("/home/user/projects/my-project");
      expect(result).toBe("--home-user-projects-my-project--");
    });

    it("should encode paths on Windows (backslashes to forward slashes)", () => {
      const result = encodePath("C:\\Users\\alice\\projects\\webapp");
      // Windows paths preserve the colon after drive letter
      expect(result).toBe("--C:-Users-alice-projects-webapp--");
    });

    it("should decode pi --path-- scheme back to filesystem paths", () => {
      const result = decodePath("--Users-alice-projects-webapp--");
      expect(result).toBe("/Users/alice/projects/webapp");
    });

    it("should handle roundtrip encoding/decoding", () => {
      const original = "/Users/alice/projects/webapp";
      const encoded = encodePath(original);
      const decoded = decodePath(encoded);
      expect(decoded).toBe(original);
    });

    it("should resolve direct paths", () => {
      const dirPath = "/Users/alice/projects/webapp";
      const sessionDir = resolveSessionsDirectory(dirPath);
      expect(sessionDir).toContain("/.pi/agent/sessions");
      expect(sessionDir).toContain("--Users-alice-projects-webapp--");
    });

    it("should resolve encoded paths", () => {
      const encodedPath = "--Users-alice-projects-webapp--";
      const sessionDir = resolveSessionsDirectory(encodedPath);
      expect(sessionDir).toContain("/.pi/agent/sessions");
      expect(sessionDir).toContain(encodedPath);
    });
  });

  describe("FR-3: Robust JSONL parsing", () => {
    it("should parse a header-only session", () => {
      const sessionFile = path.join(tempDir, "header-only.jsonl");
      const header = {
        type: "session",
        version: 3,
        id: "test-session-1",
        timestamp: "2026-06-15T12:00:00.000Z",
        cwd: "/test/project",
      };

      fs.writeFileSync(sessionFile, JSON.stringify(header) + "\n");

      const { header: parsedHeader, entries, warnings } = parseSessionFile(sessionFile);

      expect(parsedHeader).toBeDefined();
      expect(parsedHeader?.id).toBe("test-session-1");
      expect(entries).toHaveLength(0);
      expect(warnings).toHaveLength(0);
    });

    it("should skip malformed JSON lines with warnings", () => {
      const sessionFile = path.join(tempDir, "malformed.jsonl");
      const content = `{"type":"session","version":3,"id":"test","timestamp":"2026-06-15T12:00:00.000Z","cwd":"/test"}
{"type":"message","id":"msg1","parentId":null,"timestamp":"2026-06-15T12:00:01.000Z","message":{"role":"user","content":"hello"}}
this is not valid json {
{"type":"message","id":"msg2","parentId":"msg1","timestamp":"2026-06-15T12:00:02.000Z","message":{"role":"assistant","content":[{"type":"text","text":"hi"}]}}
`;

      fs.writeFileSync(sessionFile, content);

      const { header, entries, warnings } = parseSessionFile(sessionFile);

      expect(header).toBeDefined();
      expect(entries).toHaveLength(2); // Should parse 2 valid messages, skip malformed
      expect(warnings).toContainEqual(expect.stringContaining("Failed to parse JSON"));
    });

    it("should handle v1 sessions with migration warnings", () => {
      const sessionFile = path.join(tempDir, "v1-session.jsonl");
      const content = `{"type":"session","version":1,"id":"v1-test","timestamp":"2026-06-15T12:00:00.000Z","cwd":"/test"}
{"type":"message","id":"msg1","parentId":null,"timestamp":"2026-06-15T12:00:01.000Z","message":{"role":"user","content":"hello"}}
`;

      fs.writeFileSync(sessionFile, content);

      const { warnings } = parseSessionFile(sessionFile);

      expect(warnings).toContainEqual(
        expect.stringContaining("version 1")
      );
    });

    it("should handle v2 sessions with migration", () => {
      const sessionFile = path.join(tempDir, "v2-session.jsonl");
      const content = `{"type":"session","version":2,"id":"v2-test","timestamp":"2026-06-15T12:00:00.000Z","cwd":"/test"}
{"type":"message","id":"msg1","parentId":null,"timestamp":"2026-06-15T12:00:01.000Z","message":{"role":"user","content":"hello"}}
`;

      fs.writeFileSync(sessionFile, content);

      const { warnings } = parseSessionFile(sessionFile);

      expect(warnings).toContainEqual(
        expect.stringContaining("version 2")
      );
    });

    it("should tolerate unknown entry types", () => {
      const sessionFile = path.join(tempDir, "unknown-type.jsonl");
      const content = `{"type":"session","version":3,"id":"test","timestamp":"2026-06-15T12:00:00.000Z","cwd":"/test"}
{"type":"message","id":"msg1","parentId":null,"timestamp":"2026-06-15T12:00:01.000Z","message":{"role":"user","content":"hello"}}
{"type":"unknown_future_type","id":"unknown1","parentId":"msg1","timestamp":"2026-06-15T12:00:02.000Z","data":{}}
{"type":"message","id":"msg2","parentId":"unknown1","timestamp":"2026-06-15T12:00:03.000Z","message":{"role":"assistant","content":[{"type":"text","text":"hi"}]}}
`;

      fs.writeFileSync(sessionFile, content);

      const { entries, warnings } = parseSessionFile(sessionFile);

      expect(entries).toHaveLength(3); // Should include unknown type
      expect(warnings).toHaveLength(0); // Unknown types don't generate warnings, just skipped silently
    });

    it("should never throw on parse errors", () => {
      const sessionFile = path.join(tempDir, "corrupted.jsonl");
      const content = `{"type":"session","version":3,"id":"test"
this is incomplete json
{broken json with {nested {issues
`;

      fs.writeFileSync(sessionFile, content);

      expect(() => {
        parseSessionFile(sessionFile);
      }).not.toThrow();

      const { warnings } = parseSessionFile(sessionFile);
      expect(warnings.length).toBeGreaterThan(0);
    });
  });

  describe("FR-2: Session summary extraction", () => {
    it("should extract display name from session_info", () => {
      const sessionFile = path.join(tempDir, "with-info.jsonl");
      const header: SessionHeader = {
        type: "session",
        version: 3,
        id: "test-session",
        timestamp: "2026-06-15T12:00:00.000Z",
        cwd: "/test",
      };

      const entries = [
        {
          type: "message",
          id: "msg1",
          parentId: null,
          timestamp: "2026-06-15T12:00:01.000Z",
          message: { role: "user", content: "hello" },
        } as SessionEntry,
        {
          type: "session_info",
          id: "info1",
          parentId: "msg1",
          timestamp: "2026-06-15T12:00:02.000Z",
          name: "My Awesome Session",
        } as any as SessionEntry,
      ];

      const summary = extractSessionSummary(sessionFile, header, entries);

      expect(summary).toBeDefined();
      expect(summary?.displayName).toBe("My Awesome Session");
    });

    it("should extract display name from first user message if no session_info", () => {
      const sessionFile = path.join(tempDir, "no-info.jsonl");
      const header: SessionHeader = {
        type: "session",
        version: 3,
        id: "test-session",
        timestamp: "2026-06-15T12:00:00.000Z",
        cwd: "/test",
      };

      const entries = [
        {
          type: "message",
          id: "msg1",
          parentId: null,
          timestamp: "2026-06-15T12:00:01.000Z",
          message: { role: "user", content: "Help me refactor this function" },
        } as SessionEntry,
      ];

      const summary = extractSessionSummary(sessionFile, header, entries);

      expect(summary).toBeDefined();
      expect(summary?.displayName).toContain("Help me refactor");
    });

    it("should sum up tokens and costs from usage data", () => {
      const sessionFile = path.join(tempDir, "with-usage.jsonl");
      const header: SessionHeader = {
        type: "session",
        version: 3,
        id: "test-session",
        timestamp: "2026-06-15T12:00:00.000Z",
        cwd: "/test",
      };

      const entries = [
        {
          type: "message",
          id: "msg1",
          parentId: null,
          timestamp: "2026-06-15T12:00:01.000Z",
          message: { role: "user", content: "hello" },
        } as SessionEntry,
        {
          type: "message",
          id: "msg2",
          parentId: "msg1",
          timestamp: "2026-06-15T12:00:02.000Z",
          message: {
            role: "assistant",
            model: "claude-3.5-sonnet",
            usage: {
              totalTokens: 100,
              cost: { total: 0.01 },
            },
          },
        } as any as SessionEntry,
        {
          type: "message",
          id: "msg3",
          parentId: "msg2",
          timestamp: "2026-06-15T12:00:03.000Z",
          message: {
            role: "assistant",
            model: "gpt-5.5",
            usage: {
              totalTokens: 200,
              cost: { total: 0.02 },
            },
          },
        } as any as SessionEntry,
      ];

      const summary = extractSessionSummary(sessionFile, header, entries);

      expect(summary).toBeDefined();
      expect(summary?.tokenTotal).toBe(300);
      expect(summary?.costTotal).toBeCloseTo(0.03, 4);
      expect(summary?.models).toContain("claude-3.5-sonnet");
      expect(summary?.models).toContain("gpt-5.5");
    });

    it("should count message entries correctly", () => {
      const sessionFile = path.join(tempDir, "count-test.jsonl");
      const header: SessionHeader = {
        type: "session",
        version: 3,
        id: "test-session",
        timestamp: "2026-06-15T12:00:00.000Z",
        cwd: "/test",
      };

      const entries = [
        {
          type: "message",
          id: "msg1",
          parentId: null,
          timestamp: "2026-06-15T12:00:01.000Z",
          message: { role: "user", content: "hello" },
        } as SessionEntry,
        {
          type: "compaction",
          id: "comp1",
          parentId: "msg1",
          timestamp: "2026-06-15T12:00:02.000Z",
          summary: "Earlier context",
        } as any as SessionEntry,
        {
          type: "message",
          id: "msg2",
          parentId: "comp1",
          timestamp: "2026-06-15T12:00:03.000Z",
          message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
        } as any as SessionEntry,
      ];

      const summary = extractSessionSummary(sessionFile, header, entries);

      expect(summary?.messageCount).toBe(3);
    });
  });

  describe("FR-4: Active branch reconstruction with friction flags", () => {
    it("should reconstruct a simple linear branch", () => {
      const header: SessionHeader = {
        type: "session",
        version: 3,
        id: "test-session",
        timestamp: "2026-06-15T12:00:00.000Z",
        cwd: "/test",
      };

      const entries = [
        {
          type: "message",
          id: "msg1",
          parentId: null,
          timestamp: "2026-06-15T12:00:01.000Z",
          message: { role: "user", content: "hello" },
        } as SessionEntry,
        {
          type: "message",
          id: "msg2",
          parentId: "msg1",
          timestamp: "2026-06-15T12:00:02.000Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "hi" }],
            stopReason: "stop",
          },
        } as any as SessionEntry,
      ];

      const branch = reconstructActiveBranch(entries, header);

      expect(branch.entries).toHaveLength(2);
      // Branch entries are in leaf->root order (reverse of tree)
      expect(branch.entries[1].kind).toBe("user");
      expect(branch.entries[0].kind).toBe("assistant");
    });

    it("should detect friction flag for tool error", () => {
      const header: SessionHeader = {
        type: "session",
        version: 3,
        id: "test-session",
        timestamp: "2026-06-15T12:00:00.000Z",
        cwd: "/test",
      };

      const entries = [
        {
          type: "message",
          id: "msg1",
          parentId: null,
          timestamp: "2026-06-15T12:00:01.000Z",
          message: { role: "user", content: "run command" },
        } as SessionEntry,
        {
          type: "message",
          id: "msg2",
          parentId: "msg1",
          timestamp: "2026-06-15T12:00:02.000Z",
          message: {
            role: "toolResult",
            toolCallId: "call1",
            toolName: "bash",
            content: [{ type: "text", text: "error output" }],
            isError: true,
          },
        } as any as SessionEntry,
      ];

      const branch = reconstructActiveBranch(entries, header);

      const toolResultEntry = branch.entries.find((e) => e.kind === "toolResult");
      expect(toolResultEntry?.friction?.isError).toBe(true);
      expect(toolResultEntry?.friction?.signal).toBe("tool-error");
    });

    it("should detect friction flag for stop reason error", () => {
      const header: SessionHeader = {
        type: "session",
        version: 3,
        id: "test-session",
        timestamp: "2026-06-15T12:00:00.000Z",
        cwd: "/test",
      };

      const entries = [
        {
          type: "message",
          id: "msg1",
          parentId: null,
          timestamp: "2026-06-15T12:00:01.000Z",
          message: { role: "user", content: "hello" },
        } as SessionEntry,
        {
          type: "message",
          id: "msg2",
          parentId: "msg1",
          timestamp: "2026-06-15T12:00:02.000Z",
          message: {
            role: "assistant",
            content: [],
            stopReason: "error",
          },
        } as any as SessionEntry,
      ];

      const branch = reconstructActiveBranch(entries, header);

      const assistantEntry = branch.entries.find((e) => e.kind === "assistant");
      expect(assistantEntry?.friction?.signal).toBe("stop-reason-error");
    });

    it("should detect friction flag for bash non-zero exit", () => {
      const header: SessionHeader = {
        type: "session",
        version: 3,
        id: "test-session",
        timestamp: "2026-06-15T12:00:00.000Z",
        cwd: "/test",
      };

      const entries = [
        {
          type: "message",
          id: "msg1",
          parentId: null,
          timestamp: "2026-06-15T12:00:01.000Z",
          message: { role: "user", content: "hello" },
        } as SessionEntry,
        {
          type: "message",
          id: "msg2",
          parentId: "msg1",
          timestamp: "2026-06-15T12:00:02.000Z",
          message: {
            role: "bashExecution",
            command: "false",
            output: "",
            exitCode: 1,
          },
        } as any as SessionEntry,
      ];

      const branch = reconstructActiveBranch(entries, header);

      const bashEntry = branch.entries.find((e) => e.kind === "bash");
      expect(bashEntry?.friction?.isError).toBe(true);
      expect(bashEntry?.friction?.signal).toBe("nonzero-exit");
    });

    it("should handle branched sessions", () => {
      const header: SessionHeader = {
        type: "session",
        version: 3,
        id: "test-session",
        timestamp: "2026-06-15T12:00:00.000Z",
        cwd: "/test",
      };

      const entries = [
        {
          type: "message",
          id: "msg1",
          parentId: null,
          timestamp: "2026-06-15T12:00:01.000Z",
          message: { role: "user", content: "hello" },
        } as SessionEntry,
        {
          type: "message",
          id: "msg2",
          parentId: "msg1",
          timestamp: "2026-06-15T12:00:02.000Z",
          message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
        } as any as SessionEntry,
        {
          type: "branch_summary",
          id: "branch1",
          parentId: "msg1",
          timestamp: "2026-06-15T12:00:03.000Z",
          fromId: "msg2",
          summary: "Abandoned approach",
        } as any as SessionEntry,
        {
          type: "message",
          id: "msg3",
          parentId: "branch1",
          timestamp: "2026-06-15T12:00:04.000Z",
          message: { role: "user", content: "try again" },
        } as SessionEntry,
      ];

      const branch = reconstructActiveBranch(entries, header);

      // Should include the branch summary and the new leaf
      expect(branch.entries.length).toBeGreaterThan(0);
    });

    it("should handle compacted sessions", () => {
      const header: SessionHeader = {
        type: "session",
        version: 3,
        id: "test-session",
        timestamp: "2026-06-15T12:00:00.000Z",
        cwd: "/test",
      };

      const entries = [
        {
          type: "message",
          id: "msg1",
          parentId: null,
          timestamp: "2026-06-15T12:00:01.000Z",
          message: { role: "user", content: "hello" },
        } as SessionEntry,
        {
          type: "compaction",
          id: "comp1",
          parentId: "msg1",
          timestamp: "2026-06-15T12:00:02.000Z",
          summary: "Earlier context summarized",
          firstKeptEntryId: "msg1",
          tokensBefore: 5000,
        } as any as SessionEntry,
        {
          type: "message",
          id: "msg2",
          parentId: "comp1",
          timestamp: "2026-06-15T12:00:03.000Z",
          message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
        } as any as SessionEntry,
      ];

      const branch = reconstructActiveBranch(entries, header);

      // Should find the compaction summary
      const compEntry = branch.entries.find((e) => e.kind === "summary" && e.payload.type === "compaction");
      expect(compEntry).toBeDefined();
    });
  });

  describe("Integration tests", () => {
    it("should load a complete session file", () => {
      const sessionFile = path.join(tempDir, "complete.jsonl");
      const content = `{"type":"session","version":3,"id":"complete-test","timestamp":"2026-06-15T12:00:00.000Z","cwd":"/test"}
{"type":"message","id":"msg1","parentId":null,"timestamp":"2026-06-15T12:00:01.000Z","message":{"role":"user","content":"refactor this"}}
{"type":"message","id":"msg2","parentId":"msg1","timestamp":"2026-06-15T12:00:02.000Z","message":{"role":"assistant","content":[{"type":"text","text":"here's the refactor"}],"model":"claude-3.5-sonnet","usage":{"totalTokens":150,"cost":{"total":0.015}},"stopReason":"stop"}}
`;

      fs.writeFileSync(sessionFile, content);

      const parsed = loadSessionFile(sessionFile);

      expect(parsed).toBeDefined();
      expect(parsed?.branches).toHaveLength(1);
      expect(parsed?.branches[0].entries).toHaveLength(2);
      expect(parsed?.warnings).toHaveLength(0);
    });

    it("should list sessions in a directory", () => {
      const sessionsDir = path.join(tempDir, "sessions-dir");
      fs.mkdirSync(sessionsDir, { recursive: true });

      // Create a few test session files
      for (let i = 1; i <= 3; i++) {
        const sessionFile = path.join(
          sessionsDir,
          `session-${i}_${Math.random().toString(36)}.jsonl`
        );
        const content = `{"type":"session","version":3,"id":"session-${i}","timestamp":"2026-06-15T12:0${i}:00.000Z","cwd":"/test"}
{"type":"message","id":"msg1","parentId":null,"timestamp":"2026-06-15T12:0${i}:01.000Z","message":{"role":"user","content":"test ${i}"}}
`;
        fs.writeFileSync(sessionFile, content);
      }

      const { sessions, warnings } = listSessionsInDirectory(sessionsDir);

      expect(sessions).toHaveLength(3);
      expect(warnings).toHaveLength(0);
    });
  });
});
