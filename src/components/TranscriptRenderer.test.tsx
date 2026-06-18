/**
 * Tests for TranscriptRenderer component
 */

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { TranscriptRenderer } from "./TranscriptRenderer";
import type { ParsedSession, ConversationBranch, RenderableEntry } from "../../shared/types";

// Test helper to create mock entries
function createMockEntry(
  entryId: string,
  kind: RenderableEntry["kind"],
  payload: Record<string, unknown>,
  friction?: { isError?: boolean }
): RenderableEntry {
  return {
    entryId,
    parentId: null,
    kind,
    payload,
    friction,
  };
}

function createMockSession(entries: RenderableEntry[]): ParsedSession {
  const branch: ConversationBranch = {
    header: {
      sessionId: "test-session",
      timestamp: Date.now(),
      displayName: "Test Conversation",
    },
    entries,
    metadata: {},
    warnings: [],
  };

  return {
    id: "test-session",
    filePath: "/path/to/session.jsonl",
    header: {},
    branches: [branch],
    warnings: [],
  };
}

describe("TranscriptRenderer", () => {
  it("should render empty state when no entries", () => {
    const session = createMockSession([]);
    render(<TranscriptRenderer session={session} />);
    expect(screen.getByText("This conversation has no entries to display.")).toBeInTheDocument();
  });

  it("should render session header", () => {
    const entries = [
      createMockEntry("1", "user", { text: "Hello" }),
    ];
    const session = createMockSession(entries);
    render(<TranscriptRenderer session={session} />);
    expect(screen.getByText("Test Conversation")).toBeInTheDocument();
  });

  it("should render user message entry", () => {
    const entries = [
      createMockEntry("1", "user", { text: "Hello, assistant!" }),
    ];
    const session = createMockSession(entries);
    render(<TranscriptRenderer session={session} />);
    expect(screen.getByText("Hello, assistant!")).toBeInTheDocument();
    expect(screen.getByText(/User/)).toBeInTheDocument();
  });

  it("should render assistant message entry", () => {
    const entries = [
      createMockEntry("1", "assistant", { text: "Hello, user!", stopReason: "end_turn" }),
    ];
    const session = createMockSession(entries);
    render(<TranscriptRenderer session={session} />);
    expect(screen.getByText("Hello, user!")).toBeInTheDocument();
    expect(screen.getByText(/Assistant/)).toBeInTheDocument();
    expect(screen.getByText("end_turn")).toBeInTheDocument();
  });

  it("should flag assistant message with error stopReason", () => {
    const entries = [
      createMockEntry("1", "assistant", { text: "Error occurred", stopReason: "error" }),
    ];
    const session = createMockSession(entries);
    const { container } = render(<TranscriptRenderer session={session} />);
    const entryWrapper = container.querySelector('[data-entry-id="1"]');
    expect(entryWrapper?.classList.contains("friction")).toBe(true);
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("should render thinking block (collapsible)", async () => {
    const entries = [
      createMockEntry("1", "thinking", { text: "Let me think about this..." }),
    ];
    const session = createMockSession(entries);
    render(<TranscriptRenderer session={session} />);
    
    // Initially collapsed, so content shouldn't be visible
    expect(screen.queryByText("Let me think about this...")).not.toBeInTheDocument();
    
    // Click to expand
    const toggleButton = screen.getByRole("button", { name: /Thinking/i });
    fireEvent.click(toggleButton);
    
    // Now content should be visible
    expect(screen.getByText("Let me think about this...")).toBeInTheDocument();
  });

  it("should render tool call with arguments", () => {
    const entries = [
      createMockEntry("1", "toolCall", {
        toolName: "search_web",
        toolInput: { query: "TypeScript best practices" },
      }),
    ];
    const session = createMockSession(entries);
    render(<TranscriptRenderer session={session} />);
    
    expect(screen.getByText(/Tool Call: search_web/)).toBeInTheDocument();
    // JSON should be visible
    const preElements = screen.getAllByRole("generic", { hidden: true });
    const hasJson = preElements.some(el => el.textContent?.includes("query"));
    expect(hasJson).toBe(true);
  });

  it("should render tool result and flag errors", () => {
    const entries = [
      createMockEntry("1", "toolResult", {
        output: "Error: Tool failed",
      }, { isError: true }),
    ];
    const session = createMockSession(entries);
    const { container } = render(<TranscriptRenderer session={session} />);
    
    expect(screen.getByText(/Tool Result/)).toBeInTheDocument();
    expect(screen.getByText("ERROR")).toBeInTheDocument();
    
    const entryWrapper = container.querySelector('[data-entry-id="1"]');
    expect(entryWrapper?.classList.contains("friction")).toBe(true);
  });

  it("should handle fullOutputPath reference in tool result", () => {
    const entries = [
      createMockEntry("1", "toolResult", {
        output: "Truncated output...",
        fullOutputPath: "/tmp/full-output.txt",
      }),
    ];
    const session = createMockSession(entries);
    render(<TranscriptRenderer session={session} />);
    
    expect(screen.getByText(/Full output: \/tmp\/full-output\.txt/)).toBeInTheDocument();
  });

  it("should render bash execution with exit code", () => {
    const entries = [
      createMockEntry("1", "bash", {
        command: "npm test",
        output: "✓ All tests passed",
        exitCode: 0,
      }),
    ];
    const session = createMockSession(entries);
    render(<TranscriptRenderer session={session} />);
    
    expect(screen.getByText("$ npm test")).toBeInTheDocument();
    expect(screen.getByText("✓ All tests passed")).toBeInTheDocument();
    expect(screen.getByText("exit 0")).toBeInTheDocument();
  });

  it("should flag bash execution with non-zero exit code", () => {
    const entries = [
      createMockEntry("1", "bash", {
        command: "npm test",
        output: "FAIL: Test failed",
        exitCode: 1,
      }),
    ];
    const session = createMockSession(entries);
    const { container } = render(<TranscriptRenderer session={session} />);
    
    const exitBadge = screen.getByText("exit 1");
    expect(exitBadge.classList.contains("error")).toBe(true);
    
    const entryWrapper = container.querySelector('[data-entry-id="1"]');
    expect(entryWrapper?.classList.contains("friction")).toBe(true);
  });

  it("should expand/collapse long content", async () => {
    const longText = "a".repeat(600);
    const entries = [
      createMockEntry("1", "assistant", { text: longText }),
    ];
    const session = createMockSession(entries);
    render(<TranscriptRenderer session={session} />);
    
    // Initially truncated
    const contentBefore = screen.getByText(longText.slice(0, 500) + "...");
    expect(contentBefore).toBeInTheDocument();
    
    // Click expand
    const expandBtn = screen.getByRole("button", { name: /Show more/i });
    fireEvent.click(expandBtn);
    
    // Now full text visible
    expect(screen.getByText(longText)).toBeInTheDocument();
  });

  it("should provide per-entry anchors", () => {
    const entries = [
      createMockEntry("entry-1", "user", { text: "Question?" }),
      createMockEntry("entry-2", "assistant", { text: "Answer!" }),
    ];
    const session = createMockSession(entries);
    const { container } = render(<TranscriptRenderer session={session} />);
    
    const entry1 = container.querySelector('[data-entry-id="entry-1"]');
    const entry2 = container.querySelector('[data-entry-id="entry-2"]');
    
    expect(entry1?.id).toBe("entry-entry-1");
    expect(entry2?.id).toBe("entry-entry-2");
  });

  it("should handle warnings display", () => {
    const entries = [
      createMockEntry("1", "user", { text: "Hello" }),
    ];
    const session = createMockSession(entries);
    session.branches[0].warnings = ["Warning 1", "Warning 2"];
    
    render(<TranscriptRenderer session={session} />);
    
    expect(screen.getByText("Parsing Warnings")).toBeInTheDocument();
    expect(screen.getByText("Warning 1")).toBeInTheDocument();
    expect(screen.getByText("Warning 2")).toBeInTheDocument();
  });

  it("should show friction badge for error entries", () => {
    const entries = [
      createMockEntry("1", "assistant", {
        text: "This will fail",
        stopReason: "error",
      }),
    ];
    const session = createMockSession(entries);
    render(<TranscriptRenderer session={session} />);
    
    const frictionBadges = screen.getAllByText("⚠");
    expect(frictionBadges.length).toBeGreaterThan(0);
  });

  it("should display entry count", () => {
    const entries = [
      createMockEntry("1", "user", { text: "Q1" }),
      createMockEntry("2", "assistant", { text: "A1" }),
      createMockEntry("3", "user", { text: "Q2" }),
    ];
    const session = createMockSession(entries);
    render(<TranscriptRenderer session={session} />);
    
    expect(screen.getByText("3 entries")).toBeInTheDocument();
  });

  it("should handle multiple branches (use first by default)", () => {
    const entries1 = [createMockEntry("1", "user", { text: "Branch 1" })];
    const entries2 = [createMockEntry("2", "user", { text: "Branch 2" })];
    
    const branch1: ConversationBranch = {
      header: { sessionId: "s1", timestamp: Date.now(), displayName: "Branch 1" },
      entries: entries1,
      metadata: {},
      warnings: [],
    };
    
    const branch2: ConversationBranch = {
      header: { sessionId: "s1", timestamp: Date.now(), displayName: "Branch 2" },
      entries: entries2,
      metadata: {},
      warnings: [],
    };
    
    const session: ParsedSession = {
      id: "test",
      filePath: "/path",
      header: {},
      branches: [branch1, branch2],
      warnings: [],
    };
    
    render(<TranscriptRenderer session={session} branchIndex={0} />);
    const headings = screen.getAllByText("Branch 1");
    expect(headings.length).toBeGreaterThan(0);
    expect(screen.queryByText("Branch 2")).not.toBeInTheDocument();
  });

  it("should render custom branch by index", () => {
    const entries1 = [createMockEntry("1", "user", { text: "Branch 1" })];
    const entries2 = [createMockEntry("2", "user", { text: "Branch 2" })];
    
    const branch1: ConversationBranch = {
      header: { sessionId: "s1", timestamp: Date.now(), displayName: "Branch 1" },
      entries: entries1,
      metadata: {},
      warnings: [],
    };
    
    const branch2: ConversationBranch = {
      header: { sessionId: "s1", timestamp: Date.now(), displayName: "Branch 2" },
      entries: entries2,
      metadata: {},
      warnings: [],
    };
    
    const session: ParsedSession = {
      id: "test",
      filePath: "/path",
      header: {},
      branches: [branch1, branch2],
      warnings: [],
    };
    
    render(<TranscriptRenderer session={session} branchIndex={1} />);
    const headings = screen.getAllByText("Branch 2");
    expect(headings.length).toBeGreaterThan(0);
    expect(screen.queryByText("Branch 1")).not.toBeInTheDocument();
  });


  it("should truncate and expand tool arguments", async () => {
    const longArgs = {
      data: "x".repeat(500),
    };
    const entries = [
      createMockEntry("1", "toolCall", {
        toolName: "process",
        toolInput: longArgs,
      }),
    ];
    const session = createMockSession(entries);
    render(<TranscriptRenderer session={session} />);
    
    // Should have expand button
    const expandBtn = screen.getByRole("button", { name: /Show full args/i });
    expect(expandBtn).toBeInTheDocument();
    
    fireEvent.click(expandBtn);
    
    // After clicking, should show full args button text changes
    expect(screen.getByRole("button", { name: /Show less/i })).toBeInTheDocument();
  });

  it("should handle bash output with long text", async () => {
    const longOutput = "x".repeat(500);
    const entries = [
      createMockEntry("1", "bash", {
        command: "cat file.txt",
        output: longOutput,
        exitCode: 0,
      }),
    ];
    const session = createMockSession(entries);
    render(<TranscriptRenderer session={session} />);
    
    const expandBtn = screen.getByRole("button", { name: /Show full output/i });
    expect(expandBtn).toBeInTheDocument();
    
    fireEvent.click(expandBtn);
    
    expect(screen.getByRole("button", { name: /Show less/i })).toBeInTheDocument();
  });

  it("should show warnings count badge", () => {
    const entries = [createMockEntry("1", "user", { text: "Hello" })];
    const session = createMockSession(entries);
    session.branches[0].warnings = ["W1", "W2", "W3"];
    
    render(<TranscriptRenderer session={session} />);
    
    expect(screen.getByText("⚠ 3 warnings")).toBeInTheDocument();
  });

  it("should handle metadata display in empty sessions", () => {
    const session = createMockSession([]);
    session.branches[0].metadata = { custom: "value", count: 42 };
    
    render(<TranscriptRenderer session={session} />);
    
    // Metadata should be displayed
    const metadataSection = screen.getByText("Metadata:");
    expect(metadataSection).toBeInTheDocument();
  });
});
