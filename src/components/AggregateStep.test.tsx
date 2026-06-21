import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AggregateStep } from "./AggregateStep.js";
import type { ConversationReview, AggregatedInsights } from "../../shared/types.js";

vi.mock("../api/client.js", () => ({
  aggregateInsights: vi.fn(),
}));

import { aggregateInsights } from "../api/client.js";

const reviews: ConversationReview[] = [
  {
    sessionId: "s1",
    summary: "x",
    userFixes: [],
    selfCorrections: [],
    lessonsLearned: [],
    confidence: 0.9,
  },
];

const insights: AggregatedInsights = {
  projectId: "demo",
  timestamp: 1,
  summary: "Agent repeatedly uses `any`.",
  repeatingIssues: [
    {
      title: "Avoid `any`",
      description: "Uses any in committed code",
      category: "conventions",
      severity: "moderate",
      occurrences: 2,
      sessionIds: ["s1", "s2"],
      suggestedAgentsRule: "Never use `any`.",
    },
  ],
};

describe("AggregateStep", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders recurring issues and reports them via onInsightsReady", async () => {
    (aggregateInsights as ReturnType<typeof vi.fn>).mockResolvedValue({ insights });
    const onReady = vi.fn();

    render(<AggregateStep reviews={reviews} onInsightsReady={onReady} />);

    await waitFor(() => {
      expect(screen.getByText("Avoid `any`")).toBeInTheDocument();
    });
    expect(screen.getByText(/repeatedly uses/)).toBeInTheDocument();
    expect(screen.getByText("Never use `any`.")).toBeInTheDocument();
    expect(onReady).toHaveBeenCalledWith(insights);
  });

  it("shows an error when aggregation fails", async () => {
    (aggregateInsights as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
    render(<AggregateStep reviews={reviews} onInsightsReady={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Aggregation failed")).toBeInTheDocument();
    });
    expect(screen.getByText("boom")).toBeInTheDocument();
  });
});
