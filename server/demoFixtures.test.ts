/**
 * Tests for the offline demo fixtures used by the "Try the demo" flow.
 */

import { describe, it, expect } from "vitest";

import {
  isDemoDir,
  isDemoProject,
  getDemoReview,
  getDemoInsights,
  getDemoProposal,
} from "./demoFixtures";
import type { ConversationReview } from "../shared/types.js";

describe("demoFixtures", () => {
  it("recognizes the demo sentinel", () => {
    expect(isDemoDir("__demo__")).toBe(true);
    expect(isDemoDir("/Users/alice/app")).toBe(false);
    expect(isDemoProject("__demo__")).toBe(true);
    expect(isDemoProject("default")).toBe(false);
  });

  it("returns a canned review keyed by file basename, with the caller's sessionId", () => {
    const review = getDemoReview(
      "/some/abs/path/demo/sessions/2026-06-10T10-00-00-000Z_demo-users-pagination.jsonl",
      "hashed-id-123"
    );
    expect(review).not.toBeNull();
    expect(review!.sessionId).toBe("hashed-id-123");
    expect(review!.title).toMatch(/pagination/i);
    expect(review!.userFixes.length).toBeGreaterThan(0);
    expect(review!.selfCorrections.length).toBeGreaterThan(0);
    // Evidence ids reference real transcript entries so the UI links resolve.
    expect(review!.userFixes[0].evidenceEntryIds[0]).toMatch(/^demo-0001-users-pagination-e/);
  });

  it("returns null for unknown session files", () => {
    expect(getDemoReview("/x/unknown.jsonl", "id")).toBeNull();
  });

  it("derives recurring issues from the supplied reviews (no LLM)", () => {
    const reviews: ConversationReview[] = [
      getDemoReview("a/2026-06-11T09-00-00-000Z_demo-export-endpoint.jsonl", "s-export")!,
      getDemoReview("a/2026-06-12T11-00-00-000Z_demo-config-loader.jsonl", "s-config")!,
      getDemoReview("a/2026-06-10T10-00-00-000Z_demo-users-pagination.jsonl", "s-page")!,
    ];

    const insights = getDemoInsights(reviews, "__demo__");
    expect(insights.projectId).toBe("__demo__");
    expect(insights.repeatingIssues.length).toBeGreaterThan(0);

    // The `any` theme should span both export + config sessions and rank first.
    const anyIssue = insights.repeatingIssues.find((i) => /any/i.test(i.title));
    expect(anyIssue).toBeDefined();
    expect(anyIssue!.occurrences).toBe(2);
    expect(anyIssue!.sessionIds.sort()).toEqual(["s-config", "s-export"]);

    // The pagination theme appears once and references that session.
    const pageIssue = insights.repeatingIssues.find((i) => /api conventions/i.test(i.title));
    expect(pageIssue?.sessionIds).toContain("s-page");

    // A theme that doesn't apply to the selected reviews is omitted.
    const timerIssue = insights.repeatingIssues.find((i) => /timer/i.test(i.title));
    expect(timerIssue).toBeUndefined();
  });

  it("builds a proposal using the supplied current content as `before`", () => {
    const before = "# AGENTS.md\n\noriginal content\n";
    const proposal = getDemoProposal(before);
    expect(proposal.before).toBe(before);
    expect(proposal.after).toContain("never use `any` in committed code");
    expect(proposal.after).toContain("1-based");
    expect(proposal.after).toContain("vi.useRealTimers()");
    expect(proposal.traceability.length).toBeGreaterThan(0);
    expect(proposal.prompt?.system).toMatch(/demo/i);
  });
});
