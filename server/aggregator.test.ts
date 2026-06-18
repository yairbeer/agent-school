/**
 * Vitest tests for aggregator and agentsGenerator
 * Tests: all-points collection, project-vs-general split, traceability links
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { aggregateLessons, getLessonsForAgents } from "./aggregator.js";
import {
  AgentsGenerator,
  readCurrentAgents,
  saveAgents,
  getAgentsMtime,
} from "./agentsGenerator.js";
import type {
  ConversationReview,
  AggregatedLessons,
} from "../shared/types.js";
import { BaseLanguageModel } from "@langchain/core/language_models/base";
import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import { AIMessage } from "@langchain/core/messages";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * Mock LLM for testing
 */
class MockLLM extends BaseLanguageModel {
  constructor() {
    super({ callbacks: [], tags: [] });
  }

  async _generate() {
    return { generations: [] };
  }

  async invoke(_input: BaseLanguageModelInput): Promise<AIMessage> {
    // Uses real '## ' sections containing [LESSON-N] refs so parseAgentsResponse
    // section parsing is exercised (a previous bug looped forever on this).
    const proposal = `# Project AGENTS.md

## Build & Test

- [LESSON-0] Always run tests before committing

## Conventions

- [LESSON-1] Use TypeScript strict mode for type safety
- Follow the project's naming conventions`;

    return new AIMessage({ content: proposal });
  }
}

/**
 * Test data: sample review
 */
const createSampleReview = (
  sessionId: string,
  overrides?: Partial<ConversationReview>
): ConversationReview => {
  return {
    sessionId,
    title: `Session ${sessionId}`,
    summary: `Review of session ${sessionId}`,
    taskType: "coding",
    userFixes: [
      {
        description: "User had to fix the build script",
        category: "wrong-tool",
        severity: "moderate",
        evidenceEntryIds: ["entry-1", "entry-2"],
      },
    ],
    selfCorrections: [
      {
        description: "LLM retried after test failure",
        attempts: 2,
        signal: "test-failure",
        evidenceEntryIds: ["entry-3"],
      },
    ],
    lessonsLearned: [
      {
        lesson: "Always run tests before committing",
        appliesTo: "this-project",
        evidenceEntryIds: ["entry-4"],
      },
      {
        lesson: "Use TypeScript strict mode for type safety",
        appliesTo: "general",
        evidenceEntryIds: ["entry-5"],
      },
    ],
    confidence: 0.95,
    ...overrides,
  };
};

describe("Aggregator", () => {
  describe("aggregateLessons", () => {
    it("collects ALL points from every review (no clustering/dedup)", () => {
      const review1 = createSampleReview("session-1", {
        userFixes: [
          { description: "Fix A", category: "wrong-tool", severity: "major", evidenceEntryIds: ["e1"] },
        ],
        selfCorrections: [
          { description: "Retry A", attempts: 2, evidenceEntryIds: ["e2"] },
        ],
        lessonsLearned: [
          { lesson: "Always run tests before committing", appliesTo: "this-project", evidenceEntryIds: ["e3"] },
        ],
      });

      const review2 = createSampleReview("session-2", {
        userFixes: [
          { description: "Fix B", category: "missing-context", severity: "minor", evidenceEntryIds: ["e4"] },
        ],
        selfCorrections: [],
        lessonsLearned: [
          // identical text to review1 — must NOT be merged
          { lesson: "Always run tests before committing", appliesTo: "this-project", evidenceEntryIds: ["e5"] },
        ],
      });

      const aggregated = aggregateLessons([review1, review2], "project-1");

      expect(aggregated.projectId).toBe("project-1");
      // All points kept, even duplicate lesson text
      expect(aggregated.userFixes.length).toBe(2);
      expect(aggregated.selfCorrections.length).toBe(1);
      expect(aggregated.lessonsLearned.length).toBe(2);
    });

    it("tags each finding with its source session", () => {
      const aggregated = aggregateLessons([
        createSampleReview("session-1"),
        createSampleReview("session-2"),
      ]);

      const sources = new Set(aggregated.lessonsLearned.map((l) => l.sessionId));
      expect(sources.has("session-1")).toBe(true);
      expect(sources.has("session-2")).toBe(true);
      expect(aggregated.userFixes.every((f) => typeof f.sessionId === "string")).toBe(true);
    });

    it("splits project-specific vs general lessons", () => {
      const review = createSampleReview("session-1", {
        lessonsLearned: [
          { lesson: "Project-specific: Use this build tool", appliesTo: "this-project", evidenceEntryIds: ["e1"] },
          { lesson: "General: Always use version control", appliesTo: "general", evidenceEntryIds: ["e2"] },
        ],
      });

      const aggregated = aggregateLessons([review]);

      expect(aggregated.projectSpecific.some((l) => l.lesson.includes("build tool"))).toBe(true);
      expect(aggregated.general.some((l) => l.lesson.includes("version control"))).toBe(true);
    });

    it("handles empty reviews", () => {
      const aggregated = aggregateLessons([]);
      expect(aggregated.projectId).toBeDefined();
      expect(aggregated.userFixes.length).toBe(0);
      expect(aggregated.selfCorrections.length).toBe(0);
      expect(aggregated.lessonsLearned.length).toBe(0);
      expect(aggregated.projectSpecific.length).toBe(0);
      expect(aggregated.general.length).toBe(0);
    });

    it("is deterministic for the same input", () => {
      const make = () => [createSampleReview("s1"), createSampleReview("s2")];
      const a = aggregateLessons(make());
      const b = aggregateLessons(make());
      expect(a.lessonsLearned.length).toBe(b.lessonsLearned.length);
      expect(a.userFixes.length).toBe(b.userFixes.length);
    });
  });

  describe("getLessonsForAgents", () => {
    it("returns all lessons learned", () => {
      const aggregated = aggregateLessons([
        createSampleReview("s1"),
        createSampleReview("s2"),
      ]);
      const lessons = getLessonsForAgents(aggregated);
      expect(lessons.length).toBe(aggregated.lessonsLearned.length);
      expect(lessons.length).toBe(4); // 2 reviews × 2 lessons
    });
  });
});

describe("AgentsGenerator", () => {
  let mockLLM: MockLLM;
  let agentsGenerator: AgentsGenerator;

  beforeAll(() => {
    mockLLM = new MockLLM();
    agentsGenerator = new AgentsGenerator({ llm: mockLLM });
  });

  const sampleAggregated = (): AggregatedLessons =>
    aggregateLessons([createSampleReview("s1")], "test");

  describe("generateProposal", () => {
    it("generates a proposal from aggregated findings", async () => {
      const proposal = await agentsGenerator.generateProposal(sampleAggregated(), "");
      expect(proposal).toBeDefined();
      expect(proposal.before).toBeDefined();
      expect(proposal.after).toBeDefined();
      expect(proposal.confidence).toBeGreaterThan(0);
      expect(proposal.confidence).toBeLessThanOrEqual(1);
    });

    it("preserves existing AGENTS.md content as 'before'", async () => {
      const existingAgents = "# Existing Guidelines\n\nSome existing rules here";
      const empty: AggregatedLessons = {
        projectId: "test",
        timestamp: Date.now(),
        userFixes: [],
        selfCorrections: [],
        lessonsLearned: [],
        projectSpecific: [],
        general: [],
      };
      const proposal = await agentsGenerator.generateProposal(empty, existingAgents);
      expect(proposal.before).toBe(existingAgents);
    });

    it("includes traceability links to lessons (and parses sections without hanging)", async () => {
      const proposal = await agentsGenerator.generateProposal(sampleAggregated(), "");
      expect(proposal.traceability).toBeDefined();
      expect(Array.isArray(proposal.traceability)).toBe(true);
      // The mock output references [LESSON-0] and [LESSON-1] under ## sections.
      expect(proposal.traceability.length).toBeGreaterThan(0);
      const sections = proposal.traceability.map((t) => t.section);
      expect(sections).toContain("Build & Test");
    });
  });

  describe("File operations", () => {
    let tempDir: string;

    beforeAll(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-test-"));
    });

    it("should read and write AGENTS.md", () => {
      const agentsPath = path.join(tempDir, "AGENTS.md");
      const content = "# Test AGENTS.md\n\nTest content";
      fs.writeFileSync(agentsPath, content);
      const read = readCurrentAgents(tempDir);
      expect(read).toBe(content);
    });

    it("should return empty string if AGENTS.md doesn't exist", () => {
      const nonexistentDir = path.join(tempDir, "nonexistent");
      const read = readCurrentAgents(nonexistentDir);
      expect(read).toBe("");
    });

    it("should save AGENTS.md with atomic write", () => {
      const content = "# New AGENTS.md";
      const result = saveAgents(tempDir, content);
      expect(result.success).toBe(true);
      expect(result.mtime).toBeGreaterThan(0);
      const written = fs.readFileSync(path.join(tempDir, "AGENTS.md"), "utf-8");
      expect(written).toBe(content);
    });

    it("should create backup when overwriting existing AGENTS.md", () => {
      const original = "# Original AGENTS.md";
      const agentsPath = path.join(tempDir, "AGENTS.md");
      fs.writeFileSync(agentsPath, original);
      const newContent = "# Updated AGENTS.md";
      const result = saveAgents(tempDir, newContent);
      expect(result.success).toBe(true);
      expect(result.backupPath).toBeDefined();
      if (result.backupPath) {
        const backup = fs.readFileSync(result.backupPath, "utf-8");
        expect(backup).toBe(original);
      }
      const current = fs.readFileSync(agentsPath, "utf-8");
      expect(current).toBe(newContent);
    });

    afterAll(() => {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true });
      }
    });
  });
});
