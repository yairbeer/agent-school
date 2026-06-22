/**
 * Typed API client for frontend consumption
 * Strongly typed against shared/api.ts contracts
 */

import type {
  HealthResponse,
  ListSessionsResponse,
  GetSessionResponse,
  ApiError,
  ReviewRequest,
  ReviewResponse,
  AggregateRequest,
  AggregateResponse,
  AggregateInsightsRequest,
  AggregateInsightsResponse,
  GetAgentsResponse,
  ProposeAgentsRequest,
  ProposeAgentsResponse,
  SaveAgentsRequest,
  SaveAgentsResponse,
  BrowseDirectoryResponse,
} from "../../shared/api.js";
import type {
  SessionSummary,
  AggregatedLessons,
  AggregatedInsights,
  ConversationReview,
  AgentType,
} from "../../shared/types.js";

// Use the current page origin in the browser so requests go through the Vite
// dev proxy (and work in production where frontend + backend share an origin).
// Fall back to the dev backend port outside a browser (e.g. unit tests / SSR).
const API_BASE =
  typeof window !== "undefined" && window.location?.origin
    ? window.location.origin
    : "http://localhost:3001";

class ApiError extends Error {
  constructor(
    public code: string,
    public statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Parse a JSON response robustly. Surfaces the real backend error (including
 * details.message) instead of throwing a cryptic "Unexpected end of JSON
 * input" when the body is empty or non-JSON (e.g. the backend crashed or the
 * proxy dropped the connection).
 */
interface JsonErrorBody {
  error?: string;
  code?: string;
  details?: { message?: string };
}

async function readJson<T>(res: Response, fallbackCode: string): Promise<T> {
  const text = await res.text();
  let body: JsonErrorBody | null = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      // non-JSON body (HTML error page, proxy error, etc.)
    }
  }

  if (!res.ok) {
    const detail = body?.details?.message ? ` — ${body.details.message}` : "";
    const message =
      (body?.error ? `${body.error}${detail}` : "") ||
      (text ? text.slice(0, 300) : "") ||
      `HTTP ${res.status} ${res.statusText || "error"}`;
    throw new ApiError(body?.code || fallbackCode, res.status, message);
  }

  if (body == null) {
    throw new ApiError(
      fallbackCode,
      res.status,
      `Empty or non-JSON response from server (HTTP ${res.status})`
    );
  }
  return body as unknown as T;
}

/**
 * Health check — verify backend is running
 */
export async function checkHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE}/api/health`);
  if (!res.ok) throw new ApiError("HEALTH_CHECK_FAILED", res.status, "Backend health check failed");
  return res.json();
}

/**
 * List all sessions for a project directory
 * @param dir - pi-encoded path (--path-to-project--) or direct path
 * @param agent - which agent produced the sessions ("pi" | "claude-code")
 */
export async function listSessions(
  dir: string,
  agent: AgentType = "pi"
): Promise<SessionSummary[]> {
  const url = new URL(`${API_BASE}/api/sessions`);
  url.searchParams.set("dir", dir);
  url.searchParams.set("agent", agent);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const err: ApiError = await res.json();
    throw new ApiError(
      err.code || "LIST_SESSIONS_FAILED",
      res.status,
      err.error || "Failed to list sessions"
    );
  }

  const data: ListSessionsResponse = await res.json();
  return data.sessions;
}

/**
 * Load and parse a single session
 * @param id - session identifier (from SessionSummary)
 * @param dir - project directory for session lookup
 * @param agent - which agent produced the session
 */
export async function loadSession(
  id: string,
  dir: string,
  agent: AgentType = "pi"
): Promise<GetSessionResponse> {
  const url = new URL(`${API_BASE}/api/sessions/${id}`);
  url.searchParams.set("dir", dir);
  url.searchParams.set("agent", agent);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const err: ApiError = await res.json();
    throw new ApiError(
      err.code || "LOAD_SESSION_FAILED",
      res.status,
      err.error || "Failed to load session"
    );
  }

  return res.json();
}

export class SessionApiClient {
  /**
   * List sessions for a directory with error handling
   */
  static async listSessions(
    dir: string,
    agent: AgentType = "pi"
  ): Promise<{ sessions: SessionSummary[]; error?: string }> {
    try {
      const sessions = await listSessions(dir, agent);
      return { sessions };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Unknown error";
      return { sessions: [], error };
    }
  }

  /**
   * Load a specific session
   */
  static async loadSession(
    id: string,
    dir: string,
    agent: AgentType = "pi"
  ): Promise<{ data?: GetSessionResponse; error?: string }> {
    try {
      const data = await loadSession(id, dir, agent);
      return { data };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Unknown error";
      return { data: undefined, error };
    }
  }
}

/**
 * Review a single session
 * @param sessionId - session identifier
 * @param forceRefresh - ignore cache and re-run LLM
 * @param dir - project directory for context
 */
export async function reviewSession(
  sessionId: string,
  forceRefresh?: boolean,
  dir?: string,
  excludeThinking?: boolean,
  agent: AgentType = "pi"
): Promise<ReviewResponse> {
  const url = new URL(`${API_BASE}/api/review`);
  if (dir) {
    url.searchParams.set("dir", dir);
  }
  url.searchParams.set("agent", agent);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      forceRefresh: forceRefresh || false,
      excludeThinking: excludeThinking || false,
    } as ReviewRequest),
  });

  if (!res.ok) {
    const err: ApiError = await res.json();
    throw new ApiError(
      err.code || "REVIEW_FAILED",
      res.status,
      err.error || "Failed to review session"
    );
  }

  return res.json();
}

/**
 * Aggregate lessons from multiple session reviews
 * @param sessionIds - list of session IDs to aggregate
 */
export async function aggregateSessions(
  reviews: ConversationReview[],
  projectId?: string
): Promise<AggregateResponse> {
  const url = new URL(`${API_BASE}/api/aggregate`);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reviews,
      sessionIds: reviews.map((r) => r.sessionId),
      projectId,
    } as AggregateRequest),
  });

  if (!res.ok) {
    const err: ApiError = await res.json();
    throw new ApiError(
      err.code || "AGGREGATE_FAILED",
      res.status,
      err.error || "Failed to aggregate sessions"
    );
  }

  return res.json();
}

/**
 * Get current AGENTS.md file
 * @param dir - project directory
 * @param agent - which agent's conventions file to read (AGENTS.md vs CLAUDE.md)
 */
export async function getAgents(dir: string, agent: AgentType = "pi"): Promise<GetAgentsResponse> {
  const url = new URL(`${API_BASE}/api/agents`);
  url.searchParams.set("dir", dir);
  url.searchParams.set("agent", agent);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const err: ApiError = await res.json();
    throw new ApiError(
      err.code || "GET_AGENTS_FAILED",
      res.status,
      err.error || "Failed to get AGENTS.md"
    );
  }

  return res.json();
}

/**
 * LLM-cluster reviews into recurring issues (the Aggregate step).
 */
export async function aggregateInsights(
  reviews: ConversationReview[],
  projectId?: string,
  demo?: boolean
): Promise<AggregateInsightsResponse> {
  const url = new URL(`${API_BASE}/api/insights`);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reviews, projectId, demo } as AggregateInsightsRequest),
  });

  return readJson<AggregateInsightsResponse>(res, "INSIGHTS_FAILED");
}

/**
 * Propose new AGENTS.md from aggregated lessons
 * @param aggregatedLessons - aggregated lessons from all reviews
 * @param currentAgentsContent - current AGENTS.md content (optional)
 * @param insights - LLM-clustered recurring issues (optional, prioritized)
 */
export async function proposeAgents(
  aggregatedLessons: AggregatedLessons,
  currentAgentsContent?: string,
  insights?: AggregatedInsights,
  demo?: boolean
): Promise<ProposeAgentsResponse> {
  const url = new URL(`${API_BASE}/api/agents/propose`);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      aggregatedLessons,
      insights,
      currentAgentsContent,
      demo,
    } as ProposeAgentsRequest),
  });

  return readJson<ProposeAgentsResponse>(res, "PROPOSE_FAILED");
}

/**
 * Save AGENTS.md file with backup
 * @param dir - project directory
 * @param content - new content to save
 * @param expectedMtime - expected mtime for conflict detection
 */
export async function saveAgents(
  dir: string,
  content: string,
  expectedMtime?: number,
  agent: AgentType = "pi"
): Promise<SaveAgentsResponse> {
  const url = new URL(`${API_BASE}/api/agents/save`);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dir,
      content,
      expectedMtime,
      agent,
    } as SaveAgentsRequest),
  });

  if (!res.ok) {
    const err: ApiError = await res.json();
    throw new ApiError(
      err.code || "SAVE_FAILED",
      res.status,
      err.error || "Failed to save AGENTS.md"
    );
  }

  return res.json();
}

/**
 * Browse directories
 * @param dir - optional directory path to list (defaults to home directory)
 */
export async function browseDirectory(dir?: string): Promise<BrowseDirectoryResponse> {
  const url = new URL(`${API_BASE}/api/browse`);
  if (dir) {
    url.searchParams.set("dir", dir);
  }

  const res = await fetch(url.toString());
  if (!res.ok) {
    const err: ApiError = await res.json();
    throw new ApiError(
      err.code || "BROWSE_FAILED",
      res.status,
      err.error || "Failed to browse directory"
    );
  }

  return res.json();
}

