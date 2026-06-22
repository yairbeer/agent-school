/**
 * REST API contract between frontend and backend
 */

import {
  SessionSummary,
  ParsedSession,
  ConversationReview,
  AggregatedLessons,
  AggregatedInsights,
  AgentsProposal,
  AgentType,
} from "./types.js";

/**
 * GET /api/health
 * Health check endpoint
 * Response: { ok: boolean, timestamp: number }
 */
export interface HealthResponse {
  ok: boolean;
  timestamp: number;
}

/**
 * GET /api/sessions?dir=<encoded-path>
 * List all sessions for a project directory
 * Query params:
 *   - dir: pi-encoded path (e.g., --path-to-project--) or regular path
 * Response: { sessions: SessionSummary[], warnings?: string[] }
 */
export interface ListSessionsResponse {
  sessions: SessionSummary[];
  warnings?: string[];
}

/**
 * GET /api/sessions/:id
 * Load and parse a single session with active branch reconstruction
 * URL params:
 *   - id: session file hash or identifier
 * Response: ParsedSession
 */
export type GetSessionResponse = ParsedSession;

/**
 * POST /api/review
 * Submit a conversation for LLM review
 * Request: { sessionId: string, conversationBranch: ConversationBranch }
 * Response: { review: ConversationReview, cached: boolean }
 */
export interface ReviewRequest {
  sessionId: string;
  forceRefresh?: boolean; // ignore cache, re-run LLM
  excludeThinking?: boolean; // drop thinking entries before sending to the LLM
}

export interface ReviewResponse {
  review: ConversationReview;
  cached: boolean;
}

/**
 * POST /api/aggregate
 * Aggregate reviews from multiple sessions
 * Request: { sessionIds: string[] }
 * Response: { aggregated: AggregatedLessons }
 */
export interface AggregateRequest {
  sessionIds?: string[];
  reviews?: ConversationReview[]; // full review objects (preferred; avoids server-side lookup)
  projectId?: string;
}

export interface AggregateResponse {
  aggregated: AggregatedLessons;
}

/**
 * POST /api/insights
 * LLM-cluster the reviews into recurring issues across sessions.
 * Request: { reviews: ConversationReview[], projectId?: string }
 * Response: { insights: AggregatedInsights }
 */
export interface AggregateInsightsRequest {
  reviews: ConversationReview[];
  projectId?: string;
  // When true (the bundled __demo__ project), the server returns mock
  // recurring issues instead of calling the LLM.
  demo?: boolean;
}

export interface AggregateInsightsResponse {
  insights: AggregatedInsights;
}

/**
 * POST /api/agents/propose
 * Generate a proposed AGENTS.md from aggregated lessons
 * Request: { aggregatedLessons: AggregatedLessons, currentAgentsContent?: string }
 * Response: { proposal: AgentsProposal }
 */
export interface ProposeAgentsRequest {
  aggregatedLessons: AggregatedLessons;
  currentAgentsContent?: string;
  // Optional LLM-clustered recurring issues from the Aggregate step; when
  // present they are prioritized in the proposal prompt.
  insights?: AggregatedInsights;
  // When true (the bundled __demo__ project), the server returns a mock
  // proposal instead of calling the LLM.
  demo?: boolean;
}

export interface ProposeAgentsResponse {
  proposal: AgentsProposal;
}

/**
 * GET /api/agents?dir=<path>
 * Fetch current AGENTS.md for a project
 * Query params:
 *   - dir: project directory path
 * Response: { content: string, mtime: number } | { error: string }
 */
export interface GetAgentsResponse {
  content?: string;
  mtime?: number;
  error?: string;
}

/**
 * POST /api/agents/save
 * Save proposed AGENTS.md with atomic write and backup
 * Request: {
 *   dir: string,
 *   content: string,
 *   expectedMtime?: number (for conflict detection)
 * }
 * Response: { success: boolean, mtime: number, backupPath?: string, error?: string }
 */
export interface SaveAgentsRequest {
  dir: string;
  content: string;
  expectedMtime?: number;
  // Which agent's conventions file to write (AGENTS.md vs CLAUDE.md).
  agent?: AgentType;
}

export interface SaveAgentsResponse {
  success: boolean;
  mtime?: number;
  backupPath?: string;
  error?: string;
}

/**
 * GET /api/browse?dir=<path>
 * Browse directories to select a project folder
 * Query params:
 *   - dir: optional directory path to list (defaults to home directory)
 * Response: { path: string, parent: string | null, entries: Array<{ name: string, path: string }> }
 */
export interface BrowseDirectoryRequest {
  dir?: string;
}

export interface BrowseDirectoryEntry {
  name: string;
  path: string;
}

export interface BrowseDirectoryResponse {
  path: string;
  parent: string | null;
  entries: BrowseDirectoryEntry[];
  error?: string;
}

/**
 * API Error Response (all endpoints on error)
 */
export interface ApiError {
  error: string;
  code?: string;
  details?: Record<string, unknown>;
}
