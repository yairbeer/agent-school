/**
 * Shared TypeScript types used across frontend and backend
 */

/**
 * Summary of a pi session file
 */
export interface SessionSummary {
  id: string; // unique session identifier
  filePath: string; // absolute path to the .jsonl file
  displayName: string; // from session_info or first user message
  timestamp: number; // session start time (unix ms)
  messageCount: number; // total entries in session
  models: string[]; // models used in session
  tokenTotal: number; // sum of usage tokens
  costTotal: number; // estimated cost total
  contentTokenTotal?: number; // estimated tokens of transcript content (analysis input)
  thinkingTokenTotal?: number; // estimated tokens attributable to thinking blocks
}

/**
 * A single entry in a conversation branch
 */
export interface RenderableEntry {
  entryId: string;
  parentId: string | null;
  kind: "user" | "assistant" | "thinking" | "toolCall" | "toolResult" | "bash" | "summary";
  payload: Record<string, unknown>; // content varies by kind
  friction?: {
    isError?: boolean;
    signal?: string; // e.g., "tool-error", "nonzero-exit"
  };
}

/**
 * An ordered active branch from leaf to root
 */
export interface ConversationBranch {
  header: {
    sessionId: string;
    timestamp: number;
    displayName: string;
  };
  entries: RenderableEntry[]; // leaf to root order
  metadata: Record<string, unknown>;
  warnings: string[];
}

/**
 * Parsed session with branch reconstruction capability
 */
export interface ParsedSession {
  id: string;
  filePath: string;
  header: Record<string, unknown>;
  branches: ConversationBranch[];
  warnings: string[];
}

/**
 * User fix finding
 */
export interface UserFix {
  description: string;
  whatAgentDidWrong?: string;
  category:
    | "misunderstood-intent"
    | "wrong-tool"
    | "style/convention"
    | "wrong-file/scope"
    | "incorrect-assumption"
    | "missing-context"
    | "other";
  severity: "minor" | "moderate" | "major";
  evidenceEntryIds: string[];
}

/**
 * Self-correction finding
 */
export interface SelfCorrection {
  description: string;
  attempts: number; // >= 2
  rootCause?: string;
  howResolved?: string;
  signal?: "tool-error" | "nonzero-exit" | "test-failure" | "reasoning-revision" | "other";
  evidenceEntryIds: string[];
}

/**
 * Lesson learned finding
 */
export interface LessonLearned {
  lesson: string;
  appliesTo: "this-project" | "general";
  importantSteps?: string[];
  requestedOutput?: string;
  suggestedAgentsRule?: string;
  evidenceEntryIds: string[];
}

/**
 * Full conversation review (mirrors FR-9 schema)
 */
export interface ConversationReview {
  sessionId: string;
  title?: string;
  summary: string;
  taskType?: "coding" | "research" | "debugging" | "ops" | "other";
  userFixes: UserFix[];
  selfCorrections: SelfCorrection[];
  lessonsLearned: LessonLearned[];
  confidence: number; // 0 to 1
}

/**
 * Aggregated lessons from multiple reviews
 */
export interface AggregatedFinding {
  sessionId: string; // source session id
}

export interface AggregatedLessons {
  projectId: string;
  timestamp: number;
  // Every finding from every reviewed session (no clustering / dedup) — we
  // surface all points rather than collapsing by frequency.
  userFixes: (UserFix & AggregatedFinding)[];
  selfCorrections: (SelfCorrection & AggregatedFinding)[];
  lessonsLearned: (LessonLearned & AggregatedFinding)[];
  // Convenience splits of lessonsLearned by scope.
  projectSpecific: (LessonLearned & AggregatedFinding)[];
  general: (LessonLearned & AggregatedFinding)[];
}

/**
 * A recurring theme found by the LLM across multiple sessions' findings.
 * Produced by the Aggregate step (server/insightsAggregator.ts).
 */
export interface RepeatingIssue {
  title: string; // short name of the recurring theme
  description: string; // what the recurring issue is, in plain terms
  category: string; // free-form theme label, e.g. "testing", "conventions"
  severity: "minor" | "moderate" | "major";
  occurrences: number; // how many findings/sessions it spans (>= 1)
  sessionIds: string[]; // sessions where it appeared
  suggestedAgentsRule?: string; // proposed durable rule for AGENTS.md
}

/**
 * LLM-clustered view of the reviews: recurring issues + an overall summary.
 */
export interface AggregatedInsights {
  projectId: string;
  timestamp: number;
  summary: string; // overall recurring-themes summary across sessions
  repeatingIssues: RepeatingIssue[];
}

/**
 * Proposed AGENTS.md changes
 */
export interface AgentsProposal {
  before: string; // current AGENTS.md content
  after: string; // proposed AGENTS.md content
  traceability: {
    entryId: string; // which lesson drove this change
    section: string;
    reasoning: string;
  }[];
  confidence: number; // 0 to 1
  prompt?: {
    system: string; // system prompt sent to the meta LLM
    user: string; // user message sent to the meta LLM
  };
}
