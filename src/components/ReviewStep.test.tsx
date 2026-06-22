/**
 * ReviewStep component tests
 * Tests findings rendering, evidence-link navigation, and categorization
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ReviewStep } from "./ReviewStep.js";
import type { SessionSummary, ConversationReview } from "../../shared/types.js";

// Mock the API client
vi.mock("../api/client.js", () => ({
  reviewSession: vi.fn(),
}));

import * as clientModule from "../api/client.js";

const mockReviewSession = vi.mocked(clientModule.reviewSession);

describe("ReviewStep", () => {
  const mockSessions: SessionSummary[] = [
    {
      id: "session-1",
      filePath: "/path/to/session-1.jsonl",
      displayName: "Test Session 1",
      timestamp: Date.now(),
      messageCount: 10,
      models: ["gpt-5.5"],
      tokenTotal: 1000,
      costTotal: 0.1,
    },
  ];

  const mockReview: ConversationReview = {
    sessionId: "session-1",
    summary: "This was a test session",
    taskType: "coding",
    userFixes: [
      {
        description: "User had to fix the import path",
        whatAgentDidWrong: "Used wrong import path",
        category: "wrong-file/scope",
        severity: "moderate",
        evidenceEntryIds: ["entry-1", "entry-2"],
      },
    ],
    selfCorrections: [
      {
        description: "Agent retried the command after error",
        attempts: 2,
        rootCause: "Initial command had typo",
        howResolved: "Corrected the typo",
        signal: "tool-error",
        evidenceEntryIds: ["entry-3"],
      },
    ],
    lessonsLearned: [
      {
        lesson: "Always check file paths before importing",
        appliesTo: "this-project",
        importantSteps: ["Check path exists", "Verify permissions"],
        evidenceEntryIds: ["entry-1"],
      },
    ],
    confidence: 0.95,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockReviewSession.mockResolvedValue({
      review: mockReview,
      cached: false,
    });
  });

  it("renders the review step with controls", () => {
    render(
      <ReviewStep
        sessions={mockSessions}
        projectDir="/test/project" agent="pi"
        onReviewsComplete={vi.fn()}
      />
    );

    expect(screen.getByText(/Review 1 session/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Force re-review/)).toBeInTheDocument();
  });

  it("displays empty state when no sessions selected", () => {
    render(
      <ReviewStep sessions={[]} projectDir="/test/project" agent="pi" onReviewsComplete={vi.fn()} />
    );

    expect(
      screen.getByText(/No sessions selected for review/)
    ).toBeInTheDocument();
  });

  it("calls onReviewsComplete when reviews are loaded", async () => {
    const onComplete = vi.fn();

    render(
      <ReviewStep
        sessions={mockSessions}
        projectDir="/test/project" agent="pi"
        onReviewsComplete={onComplete}
      />
    );

    const reviewButton = screen.getByText(/Review 1 session/);
    fireEvent.click(reviewButton);

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith([mockReview]);
    });
  });

  it("renders userFixes with severity and category badges", async () => {
    render(
      <ReviewStep
        sessions={mockSessions}
        projectDir="/test/project" agent="pi"
        onReviewsComplete={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText(/Review 1 session/));

    await waitFor(() => {
      expect(screen.getByText(/User Fixes/)).toBeInTheDocument();
      expect(screen.getByText(/wrong-file\/scope/)).toBeInTheDocument();
      expect(screen.getByText(/moderate/)).toBeInTheDocument();
      expect(screen.getByText(/User had to fix the import path/)).toBeInTheDocument();
    });
  });

  it("renders selfCorrections with attempts and signal", async () => {
    render(
      <ReviewStep
        sessions={mockSessions}
        projectDir="/test/project" agent="pi"
        onReviewsComplete={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText(/Review 1 session/));

    await waitFor(() => {
      expect(screen.getByText(/Self Corrections/)).toBeInTheDocument();
      expect(screen.getByText(/Attempts: 2/)).toBeInTheDocument();
      expect(screen.getByText(/tool-error/)).toBeInTheDocument();
    });
  });

  it("renders lessonsLearned with appliesTo category", async () => {
    render(
      <ReviewStep
        sessions={mockSessions}
        projectDir="/test/project" agent="pi"
        onReviewsComplete={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText(/Review 1 session/));

    await waitFor(() => {
      expect(screen.getByText(/Lessons Learned/)).toBeInTheDocument();
      expect(screen.getByText(/Always check file paths/)).toBeInTheDocument();
      expect(screen.getByText(/this-project/)).toBeInTheDocument();
    });
  });

  it("renders evidence links as clickable buttons", async () => {
    render(
      <ReviewStep
        sessions={mockSessions}
        projectDir="/test/project" agent="pi"
        onReviewsComplete={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText(/Review 1 session/));

    await waitFor(() => {
      const evidenceLinks = screen.getAllByText(/#entry-1/);
      expect(evidenceLinks.length).toBeGreaterThan(0);
      evidenceLinks.forEach((link) => {
        expect(link.closest("button")).toBeInTheDocument();
      });
    });
  });

  it("displays no findings message when sections are empty", async () => {
    const emptyReview: ConversationReview = {
      ...mockReview,
      userFixes: [],
      selfCorrections: [],
      lessonsLearned: [],
    };

    mockReviewSession.mockResolvedValue({
      review: emptyReview,
      cached: false,
    });

    render(
      <ReviewStep
        sessions={mockSessions}
        projectDir="/test/project" agent="pi"
        onReviewsComplete={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText(/Review 1 session/));

    await waitFor(() => {
      expect(screen.getAllByText(/No .* detected/)).toBeTruthy();
    });
  });

  it("respects forceRefresh toggle", async () => {
    render(
      <ReviewStep
        sessions={mockSessions}
        projectDir="/test/project" agent="pi"
        onReviewsComplete={vi.fn()}
      />
    );

    const forceRefreshCheckbox = screen.getByLabelText(/Force re-review/);
    fireEvent.click(forceRefreshCheckbox);
    expect(forceRefreshCheckbox).toBeChecked();

    fireEvent.click(screen.getByText(/Review 1 session/));

    await waitFor(() => {
      expect(mockReviewSession).toHaveBeenCalledWith("session-1", true, "/test/project", undefined, "pi");
    });
  });

  it("displays review summary with task type", async () => {
    render(
      <ReviewStep
        sessions={mockSessions}
        projectDir="/test/project" agent="pi"
        onReviewsComplete={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText(/Review 1 session/));

    await waitFor(() => {
      expect(screen.getByText(/This was a test session/)).toBeInTheDocument();
      expect(screen.getByText(/coding/)).toBeInTheDocument();
    });
  });

  it("shows confidence score", async () => {
    render(
      <ReviewStep
        sessions={mockSessions}
        projectDir="/test/project" agent="pi"
        onReviewsComplete={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText(/Review 1 session/));

    await waitFor(() => {
      expect(screen.getByText(/Confidence: 95%/)).toBeInTheDocument();
    });
  });
});
