import { describe, it, expect } from "vitest";
import { AIMessage } from "@langchain/core/messages";
import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import {
  aggregateInsights,
  buildInsightsUserMessage,
} from "./insightsAggregator.js";
import type { ConversationReview } from "../shared/types.js";

function review(id: string, overrides: Partial<ConversationReview> = {}): ConversationReview {
  return {
    sessionId: id,
    summary: `summary for ${id}`,
    userFixes: [],
    selfCorrections: [],
    lessonsLearned: [],
    confidence: 0.9,
    ...overrides,
  };
}

// Minimal mock LLM that returns a fixed clustered JSON (optionally fenced).
class MockLLM {
  constructor(private payload: string) {}
  async invoke(_input: BaseLanguageModelInput): Promise<AIMessage> {
    return new AIMessage({ content: this.payload });
  }
}

const sampleReviews: ConversationReview[] = [
  review("s1", {
    userFixes: [
      {
        description: "Used `any` in committed code",
        category: "style/convention",
        severity: "moderate",
        evidenceEntryIds: ["e1"],
      },
    ],
  }),
  review("s2", {
    userFixes: [
      {
        description: "Used `any` again",
        category: "style/convention",
        severity: "moderate",
        evidenceEntryIds: ["e2"],
      },
    ],
  }),
];

describe("insightsAggregator", () => {
  it("builds a sessionId-tagged user message from findings", () => {
    const msg = buildInsightsUserMessage(sampleReviews);
    expect(msg).toContain("Session s1");
    expect(msg).toContain("Session s2");
    expect(msg).toContain("[user-fix]");
    expect(msg).toContain("Used `any`");
  });

  it("returns empty insights when no findings exist (no LLM call)", async () => {
    const llm = new MockLLM("should not be used") as never;
    const result = await aggregateInsights([review("s1")], llm, "proj");
    expect(result.repeatingIssues).toHaveLength(0);
    expect(result.projectId).toBe("proj");
  });

  it("parses clustered issues from the LLM response", async () => {
    const payload = JSON.stringify({
      summary: "Agent repeatedly uses `any`.",
      repeatingIssues: [
        {
          title: "Avoid `any`",
          description: "Uses `any` in committed code",
          category: "conventions",
          severity: "moderate",
          occurrences: 2,
          sessionIds: ["s1", "s2"],
          suggestedAgentsRule: "Never use `any` in committed code.",
        },
      ],
    });
    const result = await aggregateInsights(sampleReviews, new MockLLM(payload) as never);
    expect(result.repeatingIssues).toHaveLength(1);
    expect(result.repeatingIssues[0].title).toBe("Avoid `any`");
    expect(result.repeatingIssues[0].occurrences).toBe(2);
    expect(result.summary).toContain("any");
  });

  it("tolerates markdown code fences around the JSON", async () => {
    const payload =
      "```json\n" +
      JSON.stringify({
        summary: "x",
        repeatingIssues: [
          { title: "T", description: "d", category: "c", severity: "minor", sessionIds: ["s1"] },
        ],
      }) +
      "\n```";
    const result = await aggregateInsights(sampleReviews, new MockLLM(payload) as never);
    expect(result.repeatingIssues).toHaveLength(1);
    // occurrences falls back to sessionIds.length when omitted
    expect(result.repeatingIssues[0].occurrences).toBe(1);
  });

  it("sorts issues by occurrences (most recurring first)", async () => {
    const payload = JSON.stringify({
      summary: "s",
      repeatingIssues: [
        { title: "rare", description: "d", category: "c", severity: "minor", occurrences: 1, sessionIds: ["s1"] },
        { title: "common", description: "d", category: "c", severity: "major", occurrences: 3, sessionIds: ["s1", "s2", "s3"] },
      ],
    });
    const result = await aggregateInsights(sampleReviews, new MockLLM(payload) as never);
    expect(result.repeatingIssues[0].title).toBe("common");
  });
});
