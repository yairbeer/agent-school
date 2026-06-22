/**
 * Offline demo fixtures.
 *
 * The "Try the demo" flow (project sentinel `__demo__`) must run the FULL
 * pipeline — review, aggregate (recurring issues) and propose — without ever
 * calling a real LLM, so it works instantly with no provider configured.
 *
 * Reviews are keyed by the demo session's stable file basename (the frontend
 * session id is a hash of an absolute path, which is machine-dependent). The
 * insights and proposal are derived deterministically from the reviews.
 */

import path from "path";

import type {
  ConversationReview,
  AggregatedInsights,
  AgentsProposal,
  RepeatingIssue,
} from "../shared/types.js";
import { DEMO_DIR } from "./sessionLoader.js";

/** True when a request targets the bundled demo project. */
export function isDemoDir(dir: string | undefined): boolean {
  return dir === DEMO_DIR;
}

/** True when an insights/propose request is flagged as the demo run. */
export function isDemoProject(projectId: string | undefined): boolean {
  return projectId === DEMO_DIR;
}

/**
 * Canned per-session reviews, keyed by file basename. `sessionId` is filled in
 * at request time with the caller's actual (hashed) session id.
 */
const DEMO_REVIEWS: Record<string, Omit<ConversationReview, "sessionId">> = {
  "2026-06-10T10-00-00-000Z_demo-users-pagination.jsonl": {
    title: "Add pagination to GET /api/users",
    summary:
      "Added page/pageSize pagination. The user corrected a wrong default " +
      "(50 vs. the requested 20) and a 0-based vs. 1-based page assumption; a " +
      "follow-up test failure then exposed off-by-one offset math, which the " +
      "agent fixed.",
    taskType: "coding",
    userFixes: [
      {
        description: "Used the wrong default page size (50) instead of the requested 20.",
        whatAgentDidWrong: "Ignored the explicit '20 per page' default stated in the request.",
        category: "incorrect-assumption",
        severity: "moderate",
        evidenceEntryIds: [
          "demo-0001-users-pagination-e004",
          "demo-0001-users-pagination-e005",
        ],
      },
      {
        description: "Treated pages as 0-based; the API expects 1-based pages.",
        whatAgentDidWrong: "Assumed 0-based indexing without confirming the convention.",
        category: "incorrect-assumption",
        severity: "moderate",
        evidenceEntryIds: ["demo-0001-users-pagination-e005", "demo-0001-users-pagination-e006"],
      },
    ],
    selfCorrections: [
      {
        description: "Offset math returned 0 items for page=1; fixed after the test failed.",
        attempts: 2,
        rootCause: "Off-by-one in the offset calculation for 1-based pages.",
        howResolved: "Corrected offset to (page - 1) * pageSize and re-ran the suite to green.",
        signal: "test-failure",
        evidenceEntryIds: [
          "demo-0001-users-pagination-e009",
          "demo-0001-users-pagination-e010",
          "demo-0001-users-pagination-e011",
          "demo-0001-users-pagination-e013",
        ],
      },
    ],
    lessonsLearned: [
      {
        lesson:
          "Honor explicit defaults from the request (page size 20) and confirm 1-based vs. " +
          "0-based pagination before implementing.",
        appliesTo: "this-project",
        suggestedAgentsRule: "Pagination: pages are 1-based and default to 20 items per page.",
        evidenceEntryIds: ["demo-0001-users-pagination-e005"],
      },
    ],
    confidence: 0.86,
  },

  "2026-06-09T14-30-00-000Z_demo-flaky-ci-test.jsonl": {
    title: "Fix flaky auth.spec.ts",
    summary:
      "Diagnosed a time-dependent flake (a 1s token TTL asserted against the " +
      "real clock) and fixed it with fake timers. The user reminded the agent " +
      "to restore real timers in afterEach so they don't leak into other tests.",
    taskType: "debugging",
    userFixes: [
      {
        description: "Did not restore real timers; fake timers would leak into other tests.",
        whatAgentDidWrong:
          "Enabled vi.useFakeTimers() without a matching afterEach(vi.useRealTimers()).",
        category: "missing-context",
        severity: "moderate",
        evidenceEntryIds: ["demo-0002-flaky-ci-test-e008", "demo-0002-flaky-ci-test-e009"],
      },
    ],
    selfCorrections: [
      {
        description:
          "Reproduced the intermittent failure in a loop, identified the real-clock " +
          "dependency, and switched to deterministic fake timers.",
        attempts: 2,
        rootCause: "Test asserted against a 1s-TTL token using the real clock (Date.now mismatch).",
        howResolved: "Used vi.useFakeTimers() and advanced time deterministically; 20/20 passed.",
        signal: "test-failure",
        evidenceEntryIds: [
          "demo-0002-flaky-ci-test-e003",
          "demo-0002-flaky-ci-test-e004",
          "demo-0002-flaky-ci-test-e006",
          "demo-0002-flaky-ci-test-e007",
        ],
      },
    ],
    lessonsLearned: [
      {
        lesson:
          "When using fake timers, always restore real timers in afterEach so they don't leak " +
          "into sibling tests.",
        appliesTo: "general",
        importantSteps: [
          "Reproduce flakes in a loop",
          "Eliminate real-clock dependencies with fake timers",
          "Restore real timers after each test",
        ],
        suggestedAgentsRule:
          "Tests: if you call vi.useFakeTimers(), restore with vi.useRealTimers() in afterEach.",
        evidenceEntryIds: ["demo-0002-flaky-ci-test-e008"],
      },
    ],
    confidence: 0.9,
  },

  "2026-06-11T09-00-00-000Z_demo-export-endpoint.jsonl": {
    title: "Add CSV export endpoint",
    summary:
      "Added GET /api/users/export returning CSV. The user rejected the use of " +
      "`any` in committed code; the agent replaced it with the User type and " +
      "tests passed.",
    taskType: "coding",
    userFixes: [
      {
        description: "Used `any` in committed code for the CSV row mapper.",
        whatAgentDidWrong: "Typed the row callback as (u: any) instead of the domain User type.",
        category: "style/convention",
        severity: "moderate",
        evidenceEntryIds: ["demo-0003-export-endpoint-e004", "demo-0003-export-endpoint-e005"],
      },
    ],
    selfCorrections: [],
    lessonsLearned: [
      {
        lesson: "Do not use `any` in committed code; use the domain type (User).",
        appliesTo: "this-project",
        suggestedAgentsRule:
          "TypeScript: never use `any` in committed code — use explicit/domain types.",
        evidenceEntryIds: ["demo-0003-export-endpoint-e005"],
      },
    ],
    confidence: 0.88,
  },

  "2026-06-12T11-00-00-000Z_demo-config-loader.jsonl": {
    title: "Refactor config loader for nested keys",
    summary:
      "Refactored the config loader to support nested keys. The user again " +
      "rejected `any` (Record<string, any>); the agent introduced a recursive " +
      "ConfigValue type and tests passed.",
    taskType: "coding",
    userFixes: [
      {
        description: "Used `Record<string, any>` for the nested config structure.",
        whatAgentDidWrong: "Reached for `any` instead of a proper recursive type.",
        category: "style/convention",
        severity: "moderate",
        evidenceEntryIds: ["demo-0004-config-loader-e004", "demo-0004-config-loader-e005"],
      },
    ],
    selfCorrections: [],
    lessonsLearned: [
      {
        lesson: "Avoid `any`; model nested data with a proper recursive type (e.g. ConfigValue).",
        appliesTo: "this-project",
        suggestedAgentsRule:
          "TypeScript: model nested/dynamic data with explicit recursive types rather than `any`.",
        evidenceEntryIds: ["demo-0004-config-loader-e005"],
      },
    ],
    confidence: 0.87,
  },
};

/**
 * Return the canned review for a demo session file, with `sessionId` set to the
 * caller's id. Returns null for unknown files (so the caller can fall back).
 */
export function getDemoReview(
  filePath: string,
  sessionId: string
): ConversationReview | null {
  const template = DEMO_REVIEWS[path.basename(filePath)];
  if (!template) return null;
  return { ...template, sessionId };
}

/** Concatenate all text in a review so we can keyword-match it deterministically. */
function reviewText(r: ConversationReview): string {
  const parts: string[] = [r.title ?? "", r.summary ?? ""];
  for (const f of r.userFixes ?? []) parts.push(f.description, f.whatAgentDidWrong ?? "");
  for (const c of r.selfCorrections ?? []) parts.push(c.description, c.rootCause ?? "");
  for (const l of r.lessonsLearned ?? []) parts.push(l.lesson);
  return parts.join(" ").toLowerCase();
}

/**
 * Build the demo "recurring issues" deterministically from the supplied
 * reviews (no LLM). Occurrences/sessionIds reflect which of the selected
 * sessions actually exhibit each theme, so the view stays consistent with the
 * subset the user chose.
 */
export function getDemoInsights(
  reviews: ConversationReview[],
  projectId: string
): AggregatedInsights {
  const texts = reviews.map((r) => ({ id: r.sessionId, text: reviewText(r) }));
  const matching = (kw: RegExp) => texts.filter((t) => kw.test(t.text)).map((t) => t.id);

  const candidates: Array<Omit<RepeatingIssue, "occurrences" | "sessionIds"> & { match: RegExp }> = [
    {
      title: "`any` used in committed code",
      description:
        "The agent reached for `any` (including `Record<string, any>`) and the user had to ask " +
        "for proper types. This recurred across multiple sessions.",
      category: "conventions",
      severity: "moderate",
      suggestedAgentsRule:
        "Never use `any` in committed code — use explicit/domain types, and recursive types for " +
        "nested data.",
      match: /\bany\b/,
    },
    {
      title: "API conventions not confirmed up front",
      description:
        "Pagination shipped with the wrong default page size and 0-based pages, requiring user " +
        "correction.",
      category: "correctness",
      severity: "moderate",
      suggestedAgentsRule:
        "Confirm explicit API conventions (defaults, 1-based pagination) before implementing.",
      match: /pagination|\bpage\b/,
    },
    {
      title: "Fake timers not restored",
      description:
        "Fake timers were enabled without an afterEach restore, risking leakage into other tests.",
      category: "testing",
      severity: "minor",
      suggestedAgentsRule:
        "Restore real timers (vi.useRealTimers()) in afterEach whenever fake timers are used.",
      match: /timer/,
    },
  ];

  const repeatingIssues: RepeatingIssue[] = candidates
    .map(({ match, ...rest }) => {
      const sessionIds = matching(match);
      return { ...rest, occurrences: sessionIds.length, sessionIds };
    })
    .filter((issue) => issue.occurrences > 0)
    .sort((a, b) => b.occurrences - a.occurrences);

  return {
    projectId,
    timestamp: Date.now(),
    summary:
      "Across the reviewed sessions, the most repeated friction was reaching for `any` in " +
      "committed code (corrected by the user more than once). Other recurring themes: respecting " +
      "explicit API conventions (pagination defaults and 1-based pages) and disciplined test " +
      "isolation (restoring real timers after fake timers).",
    repeatingIssues,
  };
}

/** The improved AGENTS.md the demo proposes (integrated into the existing structure). */
const DEMO_AGENTS_AFTER = `# AGENTS.md

Guidance for agents working in this demo project (a small TypeScript web app).

## What This Is

A minimal Express + TypeScript service with a React front-end. This file is a
sample "current" AGENTS.md used by the AgentSchool demo — run the
wizard against the bundled demo sessions to see how findings get merged in.

## Build & Test

\`\`\`bash
npm install
npm test       # vitest
npm run build
\`\`\`

## Conventions

- TypeScript strict mode; **never use \`any\` in committed code** — use explicit
  or domain types (e.g. \`User\`), and model nested/dynamic data with proper
  recursive types (e.g. \`ConfigValue\`) rather than \`Record<string, any>\`.
- Keep API handlers in \`src/\` and colocate \`*.test.ts\` next to the code.

## Testing

- Reproduce intermittent failures in a loop before attempting a fix.
- Remove real-clock dependencies with fake timers; whenever you call
  \`vi.useFakeTimers()\`, restore with \`vi.useRealTimers()\` in \`afterEach\` so
  they don't leak into other tests.

## API

- \`GET /api/users\` returns the list of users.
- **Pagination:** pages are **1-based** and default to **20 items per page**
  (\`pageSize\`). Confirm such conventions before implementing.
- \`GET /api/users/export\` returns all users as CSV (rows typed as \`User\`).
`;

/**
 * Build the demo proposal. `before` is the current AGENTS.md content supplied
 * by the caller; `after` is the canned improved version.
 */
export function getDemoProposal(currentAgentsContent: string): AgentsProposal {
  return {
    before: currentAgentsContent,
    after: DEMO_AGENTS_AFTER,
    traceability: [
      {
        entryId: "demo-0003-export-endpoint-e005",
        section: "Conventions",
        reasoning: "User rejected `any`; strengthened the no-`any` rule with concrete guidance.",
      },
      {
        entryId: "demo-0004-config-loader-e005",
        section: "Conventions",
        reasoning: "Nested config used `Record<string, any>`; added recursive-type guidance.",
      },
      {
        entryId: "demo-0001-users-pagination-e005",
        section: "API",
        reasoning: "Documented 1-based pagination and the 20-item default to prevent re-work.",
      },
      {
        entryId: "demo-0002-flaky-ci-test-e008",
        section: "Testing",
        reasoning: "Added a fake-timer restore rule after the leaked-timers fix.",
      },
    ],
    confidence: 0.82,
    prompt: {
      system:
        "[demo] This proposal was produced from bundled fixtures, not a live LLM call, so the " +
        "demo works offline. With a real provider configured, this is where the meta prompt " +
        "would be shown.",
      user: "[demo] Integrate the recurring issues into the existing AGENTS.md structure.",
    },
  };
}
