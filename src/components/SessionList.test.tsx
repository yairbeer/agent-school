import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SessionList } from "./SessionList";
import type { SessionSummary } from "../../shared/types";

describe("SessionList", () => {
  const mockOnSelectChange = vi.fn();
  const mockSessions: SessionSummary[] = [
    {
      id: "session-1",
      displayName: "First Session",
      timestamp: Date.now() - 86400000,
      messageCount: 10,
      models: ["gpt-5.5"],
      tokenTotal: 1000,
      costTotal: 0.01,
      filePath: "/path/to/session1.jsonl",
    },
    {
      id: "session-2",
      displayName: "Second Session",
      timestamp: Date.now(),
      messageCount: 20,
      models: ["gpt-5.5", "claude"],
      tokenTotal: 2000,
      costTotal: 0.02,
      filePath: "/path/to/session2.jsonl",
    },
  ];

  beforeEach(() => {
    mockOnSelectChange.mockClear();
    vi.clearAllMocks();
  });

  it("renders the session list heading and instructions", () => {
    render(<SessionList sessions={mockSessions} onSelectChange={mockOnSelectChange} />);

    expect(screen.getByText("Preview & Select Sessions")).toBeInTheDocument();
    expect(screen.getByText(/Review the sessions below/i)).toBeInTheDocument();
  });

  it("displays all sessions in a table", () => {
    render(<SessionList sessions={mockSessions} onSelectChange={mockOnSelectChange} />);

    expect(screen.getByText("First Session")).toBeInTheDocument();
    expect(screen.getByText("Second Session")).toBeInTheDocument();
  });

  it("displays table headers", () => {
    render(<SessionList sessions={mockSessions} onSelectChange={mockOnSelectChange} />);

    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Timestamp")).toBeInTheDocument();
    expect(screen.getByText("Messages")).toBeInTheDocument();
  });

  it("filters sessions by name", () => {
    render(<SessionList sessions={mockSessions} onSelectChange={mockOnSelectChange} />);

    const filterInput = screen.getByPlaceholderText(/Filter sessions/i);
    fireEvent.change(filterInput, { target: { value: "First" } });

    expect(screen.getByText("First Session")).toBeInTheDocument();
    expect(screen.queryByText("Second Session")).not.toBeInTheDocument();
  });

  it("shows privacy banner", () => {
    render(<SessionList sessions={mockSessions} onSelectChange={mockOnSelectChange} />);

    expect(screen.getByText(/⚠️ Privacy Notice/i)).toBeInTheDocument();
    expect(screen.getByText(/Selected sessions will be analyzed by the LLM/i)).toBeInTheDocument();
  });

  it("displays empty state when no sessions", () => {
    render(<SessionList sessions={[]} onSelectChange={mockOnSelectChange} />);

    expect(screen.getByText(/No sessions match your filter/i)).toBeInTheDocument();
  });

  it("displays selection summary stats", () => {
    render(<SessionList sessions={mockSessions} onSelectChange={mockOnSelectChange} />);

    expect(screen.getByText(/Total Sessions:/)).toBeInTheDocument();
  });

  it("supports sorting by different columns", () => {
    render(<SessionList sessions={mockSessions} onSelectChange={mockOnSelectChange} />);

    const sortSelect = screen.getByDisplayValue(/Recent/i);
    expect(sortSelect).toBeInTheDocument();

    // Change sort to Name
    fireEvent.change(sortSelect, { target: { value: "name" } });
    expect(sortSelect).toHaveValue("name");
  });

  it("shows an exclude-thinking toggle and reduces the token/cost estimate", () => {
    const sessions: SessionSummary[] = [
      {
        id: "s1",
        displayName: "With Thinking",
        timestamp: Date.now(),
        messageCount: 5,
        models: ["claude"],
        tokenTotal: 1000,
        costTotal: 0.1,
        contentTokenTotal: 1000,
        thinkingTokenTotal: 400,
        filePath: "/p/s1.jsonl",
      },
    ];
    const onExclude = vi.fn();

    // Not excluding: full content tokens shown
    const { rerender } = render(
      <SessionList
        sessions={sessions}
        onSelectChange={mockOnSelectChange}
        excludeThinking={false}
        onExcludeThinkingChange={onExclude}
      />
    );
    expect(screen.getByText("1,000")).toBeInTheDocument();

    const toggle = screen.getByLabelText(/Exclude thinking from analysis/i);
    fireEvent.click(toggle);
    expect(onExclude).toHaveBeenCalledWith(true);

    // Excluding: content minus thinking (1000 - 400 = 600)
    rerender(
      <SessionList
        sessions={sessions}
        onSelectChange={mockOnSelectChange}
        excludeThinking={true}
        onExcludeThinkingChange={onExclude}
      />
    );
    expect(screen.getByText("600")).toBeInTheDocument();
  });
});
