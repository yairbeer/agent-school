/**
 * EditStep component tests
 * Tests the combined propose + diff + edit + save flow.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ChangeEvent } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditStep } from "./EditStep";
import * as client from "../api/client";
import type { ConversationReview } from "../../shared/types";

// Mock the API client
vi.mock("../api/client", () => ({
  getAgents: vi.fn(),
  saveAgents: vi.fn(),
  aggregateSessions: vi.fn(),
  proposeAgents: vi.fn(),
}));

// Mock Monaco Editor to avoid rendering issues in tests
vi.mock("@monaco-editor/react", async () => {
  const React = await import("react");
  return {
    DiffEditor: ({
      original,
      modified,
      onMount,
    }: {
      original: string;
      modified: string;
      onMount?: (editor: unknown) => void;
    }) => {
      const valueRef = React.useRef(modified);
      const cbRef = React.useRef<null | (() => void)>(null);
      valueRef.current = modified;
      React.useEffect(() => {
        const ed = {
          getModifiedEditor: () => ({
            getValue: () => valueRef.current,
            onDidChangeModelContent: (cb: () => void) => {
              cbRef.current = cb;
            },
          }),
        };
        onMount?.(ed);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return (
        <div data-testid="mock-diff-editor">
          <textarea data-testid="original-editor" value={original} readOnly />
          <textarea
            data-testid="modified-editor"
            value={modified}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
              valueRef.current = e.target.value;
              cbRef.current?.();
            }}
          />
        </div>
      );
    },
  };
});

describe("EditStep", () => {
  const mockProjectDir = "/test/project";
  const mockCurrentContent = "# Current AGENTS.md\n\nExisting rules here.";
  const mockProposedContent = "# Proposed AGENTS.md\n\nNew rules here.";
  const mockMtime = 1234567890;
  const mockReviews: ConversationReview[] = [
    {
      sessionId: "s1",
      summary: "x",
      userFixes: [],
      selfCorrections: [],
      lessonsLearned: [],
      confidence: 0.9,
    },
  ];

  // Configure the aggregate + propose mocks. `proposed` becomes the editable
  // (right) pane content.
  const setupProposal = (proposed = mockProposedContent) => {
    vi.mocked(client.aggregateSessions).mockResolvedValue({
      aggregated: {
        projectId: "test",
        timestamp: Date.now(),
        userFixes: [],
        selfCorrections: [],
        lessonsLearned: [],
        projectSpecific: [],
        general: [],
      },
    });
    vi.mocked(client.proposeAgents).mockResolvedValue({
      proposal: {
        before: mockCurrentContent,
        after: proposed,
        traceability: [],
        confidence: 0.8,
        prompt: { system: "SYSTEM-PROMPT-TEXT", user: "USER-MESSAGE-TEXT" },
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setupProposal();
  });

  describe("Load and Display", () => {
    it("should aggregate, propose, and load current AGENTS.md on mount", async () => {
      vi.mocked(client.getAgents).mockResolvedValue({ content: mockCurrentContent, mtime: mockMtime });

      render(<EditStep projectDir={mockProjectDir} agent="pi" reviews={mockReviews} />);

      await waitFor(() => {
        expect(screen.getByText("Propose & Save AGENTS.md")).toBeInTheDocument();
      });

      expect(client.getAgents).toHaveBeenCalledWith(mockProjectDir, "pi");
      expect(client.aggregateSessions).toHaveBeenCalledWith(mockReviews);
      expect(client.proposeAgents).toHaveBeenCalledWith(
        expect.anything(),
        mockCurrentContent,
        undefined,
        false
      );
    });

    it("should handle empty current AGENTS.md gracefully", async () => {
      vi.mocked(client.getAgents).mockResolvedValue({ content: undefined, mtime: undefined });

      render(<EditStep projectDir={mockProjectDir} agent="pi" reviews={mockReviews} />);

      await waitFor(() => {
        expect(screen.getByText("Propose & Save AGENTS.md")).toBeInTheDocument();
      });

      expect(
        screen.getByText(/This will create a new AGENTS.md for the first time/)
      ).toBeInTheDocument();
    });

    it("should display error if proposal generation fails", async () => {
      const errorMessage = "Network error";
      vi.mocked(client.getAgents).mockRejectedValue(new Error(errorMessage));

      render(<EditStep projectDir={mockProjectDir} agent="pi" reviews={mockReviews} />);

      await waitFor(() => {
        expect(screen.getByText("Error Loading AGENTS.md")).toBeInTheDocument();
        expect(screen.getByText(new RegExp(errorMessage))).toBeInTheDocument();
      });
    });

    it("should display the diff editor with current and proposed content", async () => {
      vi.mocked(client.getAgents).mockResolvedValue({ content: mockCurrentContent, mtime: mockMtime });

      render(<EditStep projectDir={mockProjectDir} agent="pi" reviews={mockReviews} />);

      await waitFor(() => {
        expect(screen.getByTestId("mock-diff-editor")).toBeInTheDocument();
      });

      const originalEditor = screen.getByTestId("original-editor") as HTMLTextAreaElement;
      const modifiedEditor = screen.getByTestId("modified-editor") as HTMLTextAreaElement;
      expect(originalEditor.value).toBe(mockCurrentContent);
      expect(modifiedEditor.value).toBe(mockProposedContent);
    });

    it("lets the user review the system prompt and user message", async () => {
      vi.mocked(client.getAgents).mockResolvedValue({ content: mockCurrentContent, mtime: mockMtime });

      render(<EditStep projectDir={mockProjectDir} agent="pi" reviews={mockReviews} />);

      await waitFor(() => {
        expect(screen.getByText(/Review the prompt sent to the model/)).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText(/Review the prompt sent to the model/));

      expect(screen.getByText("SYSTEM-PROMPT-TEXT")).toBeInTheDocument();
      expect(screen.getByText("USER-MESSAGE-TEXT")).toBeInTheDocument();
    });
  });

  describe("Editing", () => {
    it("should allow editing the modified editor", async () => {
      vi.mocked(client.getAgents).mockResolvedValue({ content: mockCurrentContent, mtime: mockMtime });

      render(<EditStep projectDir={mockProjectDir} agent="pi" reviews={mockReviews} />);

      await waitFor(() => {
        expect(screen.getByTestId("modified-editor")).toBeInTheDocument();
      });

      const modifiedEditor = screen.getByTestId("modified-editor") as HTMLTextAreaElement;
      await userEvent.clear(modifiedEditor);
      await userEvent.type(modifiedEditor, "# Updated content");
      expect(modifiedEditor.value).toBe("# Updated content");
    });

    it("should disable save button when proposed content is empty", async () => {
      setupProposal("");
      vi.mocked(client.getAgents).mockResolvedValue({ content: mockCurrentContent, mtime: mockMtime });

      render(<EditStep projectDir={mockProjectDir} agent="pi" reviews={mockReviews} />);

      await waitFor(() => {
        const saveButton = screen.getByRole("button", { name: /Save AGENTS.md/ });
        expect(saveButton).toBeDisabled();
      });
    });

    it("should enable save button when content is not empty", async () => {
      vi.mocked(client.getAgents).mockResolvedValue({ content: mockCurrentContent, mtime: mockMtime });

      render(<EditStep projectDir={mockProjectDir} agent="pi" reviews={mockReviews} />);

      await waitFor(() => {
        const saveButton = screen.getByRole("button", { name: /Save AGENTS.md/ });
        expect(saveButton).not.toBeDisabled();
      });
    });
  });

  describe("Save Flow - Success", () => {
    it("should save content successfully with backup path", async () => {
      vi.mocked(client.getAgents).mockResolvedValue({ content: mockCurrentContent, mtime: mockMtime });
      const backupPath = ".agents_backups/AGENTS.md.2026-06-15T12:00:00Z.bak";
      vi.mocked(client.saveAgents).mockResolvedValue({ success: true, mtime: 1234567900, backupPath });

      render(<EditStep projectDir={mockProjectDir} agent="pi" reviews={mockReviews} />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Save AGENTS.md/ })).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole("button", { name: /Save AGENTS.md/ }));

      await waitFor(() => {
        expect(screen.getByText(/Save Successful/)).toBeInTheDocument();
        expect(screen.getByText(new RegExp(backupPath))).toBeInTheDocument();
      });

      expect(client.saveAgents).toHaveBeenCalledWith(mockProjectDir, mockProposedContent, mockMtime, "pi");
    });
  });

  describe("Conflict Warning Flow", () => {
    it("should show conflict warning with reconcile and force save options", async () => {
      vi.mocked(client.getAgents).mockResolvedValue({ content: mockCurrentContent, mtime: mockMtime });
      const conflictError = "AGENTS.md was modified externally; conflict detected";
      vi.mocked(client.saveAgents).mockResolvedValue({ success: false, error: conflictError, mtime: 1234567950 });

      render(<EditStep projectDir={mockProjectDir} agent="pi" reviews={mockReviews} />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Save AGENTS.md/ })).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole("button", { name: /Save AGENTS.md/ }));

      await waitFor(() => {
        expect(screen.getByText(/Conflict Warning/)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Reconcile & Reload/ })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Force Save/ })).toBeInTheDocument();
      });
    });

    it("should allow force save when conflict occurs", async () => {
      vi.mocked(client.getAgents).mockResolvedValue({ content: mockCurrentContent, mtime: mockMtime });
      vi.mocked(client.saveAgents)
        .mockResolvedValueOnce({ success: false, error: "conflict detected", mtime: 1234567950 })
        .mockResolvedValueOnce({ success: true, mtime: 1234567960, backupPath: ".bak" });

      render(<EditStep projectDir={mockProjectDir} agent="pi" reviews={mockReviews} />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Save AGENTS.md/ })).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole("button", { name: /Save AGENTS.md/ }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Force Save/ })).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole("button", { name: /Force Save/ }));
      await waitFor(() => {
        expect(screen.getByText(/Save Successful/)).toBeInTheDocument();
      });
    });
  });

  describe("Error Handling", () => {
    it("should show error when save fails", async () => {
      vi.mocked(client.getAgents).mockResolvedValue({ content: mockCurrentContent, mtime: mockMtime });
      const errorMessage = "Permission denied";
      vi.mocked(client.saveAgents).mockResolvedValue({ success: false, error: errorMessage });

      render(<EditStep projectDir={mockProjectDir} agent="pi" reviews={mockReviews} />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Save AGENTS.md/ })).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole("button", { name: /Save AGENTS.md/ }));

      await waitFor(() => {
        expect(screen.getByText(/Save Failed/)).toBeInTheDocument();
        expect(screen.getByText(new RegExp(errorMessage))).toBeInTheDocument();
      });
    });
  });
});
