import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import fs from "fs";
import path from "path";
import os from "os";
import type {
  HealthResponse,
  ListSessionsResponse,
  GetSessionResponse,
  ApiError,
  AggregateRequest,
  AggregateResponse,
  ProposeAgentsRequest,
  ProposeAgentsResponse,
  GetAgentsResponse,
  SaveAgentsRequest,
  SaveAgentsResponse,
  ReviewRequest,
  ReviewResponse,
  BrowseDirectoryResponse,
  AggregateInsightsRequest,
  AggregateInsightsResponse,
} from "../shared/api.js";
import {
  resolveSessionsDirectory,
  listSessionsInDirectory,
  loadSessionFile,
} from "./sessionLoader.js";
import {
  aggregateLessons,
} from "./aggregator.js";
import { aggregateInsights } from "./insightsAggregator.js";
import {
  AgentsGenerator,
  readCurrentAgents,
  getAgentsMtime,
  saveAgents as saveAgentsFile,
} from "./agentsGenerator.js";
import { ReviewEngine } from "./reviewEngine.js";
import { createLLM } from "./llmFactory.js";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";

const app = express();
const PORT = process.env.PORT || 3001;

// Default model when neither REVIEW_MODEL nor AGENTS_MODEL is set.
const DEFAULT_MODEL = "gpt-5.5";
const REVIEW_MODEL = process.env.REVIEW_MODEL || DEFAULT_MODEL;
const LLM_PROVIDER =
  process.env.LLM_PROVIDER || process.env.REVIEW_PROVIDER || "(auto-detect)";

// LLM for AGENTS.md generation is created lazily on first use so the server
// can start (and serve session browsing / previews) without any provider
// credentials present.
const AGENTS_TEMPERATURE = process.env.AGENTS_TEMPERATURE
  ? parseFloat(process.env.AGENTS_TEMPERATURE)
  : 0.7;

// Lazily-created LLM for the Aggregate step (recurring-issue clustering).
// Uses the same model/provider resolution as the propose step.
let insightsLLM: BaseLanguageModel | null = null;
async function getInsightsLLM(): Promise<BaseLanguageModel> {
  if (insightsLLM) return insightsLLM;
  const model = process.env.AGENTS_MODEL || process.env.REVIEW_MODEL || DEFAULT_MODEL;
  const provider = (process.env.LLM_PROVIDER || process.env.REVIEW_PROVIDER) as
    | "openai"
    | "anthropic"
    | "google"
    | "bedrock"
    | undefined;
  console.log(
    `[insights] LLM config: model=${model} provider=${provider ?? "(auto-detect)"}`
  );
  insightsLLM = await createLLM({
    model,
    provider,
    temperature: AGENTS_TEMPERATURE,
    maxTokens: 8192,
  });
  return insightsLLM;
}

let agentsGenerator: AgentsGenerator | null = null;
async function getAgentsGenerator(): Promise<AgentsGenerator> {
  if (agentsGenerator) return agentsGenerator;
  // Reuse the proven review model/provider when AGENTS_* aren't explicitly set,
  // so the propose step uses the same working LLM config as the review step.
  const model = process.env.AGENTS_MODEL || process.env.REVIEW_MODEL || DEFAULT_MODEL;
  const provider = (process.env.LLM_PROVIDER || process.env.REVIEW_PROVIDER) as
    | "openai"
    | "anthropic"
    | "google"
    | "bedrock"
    | undefined;
  const maxTokens = process.env.AGENTS_MAX_TOKENS
    ? parseInt(process.env.AGENTS_MAX_TOKENS, 10)
    : 32000;
  console.log(
    `[propose] LLM config: model=${model} provider=${provider ?? "(auto-detect)"} maxTokens=${maxTokens}`
  );
  const llm: BaseLanguageModel = await createLLM({
    model,
    provider,
    temperature: AGENTS_TEMPERATURE,
    // The output is a full AGENTS.md (can be hundreds of lines), so allow a
    // large generation budget. Override with AGENTS_MAX_TOKENS.
    maxTokens,
  });
  agentsGenerator = new AgentsGenerator({
    llm,
    temperature: AGENTS_TEMPERATURE,
  });
  return agentsGenerator;
}

// Initialize ReviewEngine
const reviewEngine = new ReviewEngine({
  model: REVIEW_MODEL,
  provider: (process.env.REVIEW_PROVIDER as "openai" | "anthropic" | "google" | "bedrock" | undefined),
  cacheDir: process.env.REVIEW_CACHE_DIR || ".review-cache",
  temperature: process.env.REVIEW_TEMPERATURE
    ? parseFloat(process.env.REVIEW_TEMPERATURE)
    : 0.7,
});

// In-memory store for reviews (in production, this would be a database)
const reviewCache = new Map<string, any>();

// Middleware
app.use(express.json());

// Request logging
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get("/api/health", (_req: Request, res: Response<HealthResponse>) => {
  res.json({
    ok: true,
    timestamp: Date.now(),
  });
});

// GET /api/browse?dir=<path>
// Browse directories to select a project folder
app.get("/api/browse", (req: Request, res: Response<BrowseDirectoryResponse | ApiError>) => {
  try {
    const dirParam = req.query.dir as string | undefined;
    const targetDir = dirParam || os.homedir();

    // Validate that the directory exists and is accessible
    if (!fs.existsSync(targetDir)) {
      return res.json({
        path: targetDir,
        parent: null,
        entries: [],
        error: "Directory does not exist",
      });
    }

    const stats = fs.statSync(targetDir);
    if (!stats.isDirectory()) {
      return res.json({
        path: targetDir,
        parent: null,
        entries: [],
        error: "Path is not a directory",
      });
    }

    // Read directory contents
    const entries = fs.readdirSync(targetDir)
      .map((name) => {
        const fullPath = path.join(targetDir, name);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            return { name, path: fullPath };
          }
          return null;
        } catch (err) {
          // Skip entries that can't be accessed
          return null;
        }
      })
      .filter((entry): entry is { name: string; path: string } => entry !== null)
      .sort((a, b) => a.name.localeCompare(b.name));

    // Calculate parent directory
    const parent = path.dirname(targetDir);
    const isRoot = parent === targetDir;

    return res.json({
      path: targetDir,
      parent: isRoot ? null : parent,
      entries,
    });
  } catch (err) {
    console.error("Error browsing directory:", err);
    return res.json({
      path: req.query.dir as string || os.homedir(),
      parent: null,
      entries: [],
      error: err instanceof Error ? err.message : "Failed to browse directory",
    });
  }
});

// GET /api/sessions?dir=<encoded-path-or-direct-path>
// Lists all sessions for a project directory
app.get("/api/sessions", (req: Request, res: Response<ListSessionsResponse | ApiError>) => {
  const dir = req.query.dir as string | undefined;

  if (!dir) {
    return res.status(400).json({
      error: "Missing 'dir' query parameter",
      code: "MISSING_DIR",
    });
  }

  try {
    const sessionsDirPath = resolveSessionsDirectory(dir);
    const { sessions, warnings } = listSessionsInDirectory(sessionsDirPath);

    return res.json({
      sessions,
      warnings: warnings.length > 0 ? warnings : undefined,
    });
  } catch (err) {
    console.error("Error listing sessions:", err);
    return res.status(500).json({
      error: "Failed to list sessions",
      code: "LIST_SESSIONS_ERROR",
      details: {
        message: err instanceof Error ? err.message : "unknown error",
      },
    });
  }
});

// GET /api/sessions/:id
// Loads and parses a single session file
app.get("/api/sessions/:id", (req: Request, res: Response<GetSessionResponse | ApiError>) => {
  const id = req.params.id as string;
  const dir = req.query.dir as string | undefined;

  if (!id) {
    return res.status(400).json({
      error: "Missing session id",
      code: "MISSING_SESSION_ID",
    });
  }

  try {
    if (!dir) {
      return res.status(400).json({
        error: "Missing 'dir' query parameter needed to locate session",
        code: "MISSING_DIR",
      });
    }

    const sessionsDirPath = resolveSessionsDirectory(dir);
    const { sessions } = listSessionsInDirectory(sessionsDirPath);

    const sessionSummary = sessions.find((s) => s.id === id);

    if (!sessionSummary) {
      return res.status(404).json({
        error: "Session not found",
        code: "SESSION_NOT_FOUND",
      });
    }

    const parsedSession = loadSessionFile(sessionSummary.filePath);

    if (!parsedSession) {
      return res.status(500).json({
        error: "Failed to parse session file",
        code: "PARSE_ERROR",
      });
    }

    return res.json(parsedSession);
  } catch (err) {
    console.error("Error loading session:", err);
    return res.status(500).json({
      error: "Failed to load session",
      code: "LOAD_SESSION_ERROR",
      details: {
        message: err instanceof Error ? err.message : "unknown error",
      },
    });
  }
});

// POST /api/review
// Submit a conversation for LLM review
app.post(
  "/api/review",
  async (req: Request, res: Response<ReviewResponse | ApiError>) => {
    try {
      const { sessionId, forceRefresh, excludeThinking } = req.body as ReviewRequest;

      if (!sessionId) {
        return res.status(400).json({
          error: "sessionId is required",
          code: "MISSING_SESSION_ID",
        });
      }

      // Get the directory from query param or use default
      const dir = (req.query.dir as string | undefined) || process.cwd();

      // Try to get the session and its active branch
      const sessionsDirPath = resolveSessionsDirectory(dir);
      const { sessions } = listSessionsInDirectory(sessionsDirPath);

      const sessionSummary = sessions.find((s) => s.id === sessionId);
      if (!sessionSummary) {
        return res.status(404).json({
          error: "Session not found",
          code: "SESSION_NOT_FOUND",
        });
      }

      const parsedSession = loadSessionFile(sessionSummary.filePath);
      if (!parsedSession || !parsedSession.branches || parsedSession.branches.length === 0) {
        return res.status(400).json({
          error: "Failed to load session or no branches found",
          code: "INVALID_SESSION",
        });
      }

      // Use the first branch (leaf/active branch)
      let activeBranch = parsedSession.branches[0];

      // Optionally drop thinking entries so they are not sent to the LLM.
      // This changes the conversation content hash, so it caches separately.
      if (excludeThinking) {
        activeBranch = {
          ...activeBranch,
          entries: activeBranch.entries.filter((e) => e.kind !== "thinking"),
        };
      }

      // Submit for review
      const result = await reviewEngine.review(
        sessionId,
        activeBranch,
        forceRefresh || false
      );

      // Cache by sessionId so /api/aggregate can fall back to a server-side
      // lookup if the client doesn't send full review objects.
      reviewCache.set(sessionId, result);

      return res.json(result);
    } catch (err) {
      console.error("Error reviewing session:", err);
      return res.status(500).json({
        error: "Failed to review session",
        code: "REVIEW_ERROR",
        details: {
          message: err instanceof Error ? err.message : "unknown error",
        },
      });
    }
  }
);

// POST /api/aggregate
// Aggregate reviews from multiple sessions into project-level lessons
app.post(
  "/api/aggregate",
  async (req: Request, res: Response<AggregateResponse | ApiError>) => {
    try {
      const { sessionIds, reviews: providedReviews, projectId } = req.body as AggregateRequest;

      // Prefer full review objects sent by the client; fall back to the
      // in-memory cache lookup by sessionId for backward compatibility.
      let reviews: any[] = [];
      if (Array.isArray(providedReviews) && providedReviews.length > 0) {
        reviews = providedReviews;
      } else if (Array.isArray(sessionIds)) {
        for (const sessionId of sessionIds) {
          if (reviewCache.has(sessionId)) {
            const reviewResponse = reviewCache.get(sessionId);
            reviews.push(reviewResponse.review || reviewResponse);
          }
        }
      } else {
        return res.status(400).json({
          error: "reviews or sessionIds is required",
          code: "MISSING_REVIEWS",
        });
      }

      if (reviews.length === 0) {
        return res.status(400).json({
          error: "No reviews found for the specified sessions",
          code: "NO_REVIEWS_FOUND",
        });
      }

      // Aggregate lessons
      const aggregated = aggregateLessons(reviews, projectId || "default");

      return res.json({
        aggregated,
      });
    } catch (err) {
      console.error("Error aggregating lessons:", err);
      return res.status(500).json({
        error: "Failed to aggregate lessons",
        code: "AGGREGATION_ERROR",
        details: {
          message: err instanceof Error ? err.message : "unknown error",
        },
      });
    }
  }
);

// POST /api/insights
// LLM-cluster the reviews into recurring issues across sessions.
app.post(
  "/api/insights",
  async (req: Request, res: Response<AggregateInsightsResponse | ApiError>) => {
    try {
      const { reviews, projectId } = req.body as AggregateInsightsRequest;

      if (!Array.isArray(reviews) || reviews.length === 0) {
        return res.status(400).json({
          error: "reviews is required",
          code: "MISSING_REVIEWS",
        });
      }

      const t0 = Date.now();
      console.log(`[insights] start: reviews=${reviews.length}`);
      const llm = await getInsightsLLM();
      const insights = await aggregateInsights(
        reviews,
        llm,
        projectId || "default"
      );
      console.log(
        `[insights] done in ${((Date.now() - t0) / 1000).toFixed(1)}s ` +
          `(${insights.repeatingIssues.length} recurring issues)`
      );

      return res.json({ insights });
    } catch (err) {
      console.error("[insights] FAILED:", err);
      return res.status(500).json({
        error: "Failed to aggregate insights",
        code: "INSIGHTS_ERROR",
        details: {
          message: err instanceof Error ? err.message : "unknown error",
        },
      });
    }
  }
);

// POST /api/agents/propose
// Generate a proposed AGENTS.md from aggregated lessons via meta LLM pass
app.post(
  "/api/agents/propose",
  async (req: Request, res: Response<ProposeAgentsResponse | ApiError>) => {
    try {
      const { aggregatedLessons, currentAgentsContent, insights } =
        req.body as ProposeAgentsRequest;

      if (!aggregatedLessons) {
        return res.status(400).json({
          error: "aggregatedLessons is required",
          code: "MISSING_AGGREGATED_LESSONS",
        });
      }

      // Generate proposal using the meta LLM (lazily initialized)
      const t0 = Date.now();
      console.log(
        `[propose] start: lessons=${aggregatedLessons.lessonsLearned?.length ?? 0} ` +
          `userFixes=${aggregatedLessons.userFixes?.length ?? 0} ` +
          `selfCorrections=${aggregatedLessons.selfCorrections?.length ?? 0} ` +
          `repeatingIssues=${insights?.repeatingIssues?.length ?? 0} ` +
          `currentAgentsChars=${(currentAgentsContent || "").length}`
      );
      const proposal = await (await getAgentsGenerator()).generateProposal(
        aggregatedLessons,
        currentAgentsContent || "",
        insights
      );
      console.log(
        `[propose] done in ${((Date.now() - t0) / 1000).toFixed(1)}s ` +
          `(output ${proposal.after.length} chars)`
      );

      return res.json({
        proposal,
      });
    } catch (err) {
      console.error("[propose] FAILED:", err);
      return res.status(500).json({
        error: "Failed to generate agents proposal",
        code: "PROPOSAL_ERROR",
        details: {
          message: err instanceof Error ? err.message : "unknown error",
        },
      });
    }
  }
);

// GET /api/agents?dir=<path>
// Returns current AGENTS.md content (empty if absent) plus mtime
app.get("/api/agents", (req: Request, res: Response<GetAgentsResponse | ApiError>) => {
  try {
    const dir = req.query.dir as string | undefined;

    if (!dir) {
      return res.status(400).json({
        error: "Missing 'dir' query parameter",
        code: "MISSING_DIR",
      });
    }

    const content = readCurrentAgents(dir);
    const mtime = getAgentsMtime(dir);

    return res.json({
      content: content || undefined,
      mtime: mtime || undefined,
    });
  } catch (err) {
    console.error("Error reading AGENTS.md:", err);
    return res.status(500).json({
      error: "Failed to read AGENTS.md",
      code: "READ_AGENTS_ERROR",
      details: {
        message: err instanceof Error ? err.message : "unknown error",
      },
    });
  }
});

// POST /api/agents/save
// Save proposed AGENTS.md with atomic write and backup
app.post(
  "/api/agents/save",
  (req: Request, res: Response<SaveAgentsResponse | ApiError>) => {
    try {
      const { dir, content, expectedMtime } = req.body as SaveAgentsRequest;

      if (!dir || !content) {
        return res.status(400).json({
          error: "dir and content are required",
          code: "MISSING_REQUIRED_FIELDS",
        });
      }

      const result = saveAgentsFile(dir, content, expectedMtime);

      if (!result.success) {
        return res.status(409).json({
          error: result.error || "Failed to save AGENTS.md",
          code: "SAVE_FAILED",
        });
      }

      return res.json({
        success: true,
        mtime: result.mtime,
        backupPath: result.backupPath,
      });
    } catch (err) {
      console.error("Error saving AGENTS.md:", err);
      return res.status(500).json({
        error: "Failed to save AGENTS.md",
        code: "SAVE_ERROR",
        details: {
          message: err instanceof Error ? err.message : "unknown error",
        },
      });
    }
  }
);

// 404 handler
app.use((_req: Request, res: Response<ApiError>) => {
  res.status(404).json({
    error: "Not found",
  });
});

// Error handler
app.use((err: Error, _req: Request, res: Response<ApiError>) => {
  console.error("Error:", err.message);
  res.status(500).json({
    error: "Internal server error",
    details: { message: err.message },
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Backend server listening on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  console.log(
    `LLM: provider=${LLM_PROVIDER} reviewModel=${REVIEW_MODEL} agentsModel=${
      process.env.AGENTS_MODEL || REVIEW_MODEL
    }`
  );
});
