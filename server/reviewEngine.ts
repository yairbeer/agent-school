import fs from "fs";
import path from "path";
import crypto from "crypto";
import { BaseLanguageModel } from "@langchain/core/language_models/base";
import {
  createLLM,
  detectProvider as detectLLMProvider,
  type LLMProvider,
} from "./llmFactory.js";
import { z } from "zod";
import type {
  ConversationReview,
  ConversationBranch,
} from "../shared/types.js";

/**
 * Configuration for the review engine
 */
export interface ReviewEngineConfig {
  model: string;
  provider?: "openai" | "anthropic" | "google" | "bedrock";
  cacheDir?: string;
  lessonsFile?: string;
  temperature?: number;
  maxRetries?: number;
}

/**
 * Cache entry structure
 */
interface CacheEntry {
  hash: string;
  timestamp: number;
  model: string;
  provider: string;
  promptVersion: string;
  review: ConversationReview;
}

/**
 * Insights artifact structure
 */
interface InsightsArtifact {
  timestamp: number;
  importantSteps: string[];
  requestedOutput: string;
  sources: string[];
}

/**
 * Extract plain text from a renderable entry payload, handling pi's
 * content-block arrays. Used to build a compact transcript for the LLM
 * (instead of sending the full raw JSON, which carries usage/model/ids).
 */
function extractEntryText(entry: any): string {
  const p = entry?.payload ?? {};

  const fromContent = (v: unknown): string => {
    if (typeof v === "string") return v;
    if (Array.isArray(v)) {
      return v
        .map((b) => {
          if (typeof b === "string") return b;
          if (b && typeof b === "object") {
            const o = b as Record<string, unknown>;
            if (typeof o.text === "string") return o.text;
            if (typeof o.thinking === "string") return o.thinking;
            if (o.type === "tool_use" || o.type === "toolUse") {
              return `tool_use ${(o.name as string) ?? ""}(${JSON.stringify(o.input ?? {})})`;
            }
          }
          return "";
        })
        .filter(Boolean)
        .join("\n");
    }
    return "";
  };

  if (entry?.kind === "thinking") {
    return typeof p.thinking === "string" ? p.thinking : fromContent(p.content);
  }
  if (entry?.kind === "bash") {
    const cmd = typeof p.command === "string" ? `$ ${p.command}\n` : "";
    const out = typeof p.output === "string" ? p.output : fromContent(p.content);
    const exit = p.exitCode != null ? ` (exit ${p.exitCode})` : "";
    return `${cmd}${out}${exit}`;
  }
  let text = fromContent(p.content ?? p.text ?? p.output);
  if ((entry?.kind === "toolCall" || entry?.kind === "toolResult") && p.toolName) {
    text = `${p.toolName}: ${text}`;
  }
  return text;
}

// Cap each entry so a single huge tool/bash output can't blow up the cost.
const MAX_ENTRY_CHARS = 2000;

/**
 * Truncate the MIDDLE of long text, keeping the start and end so the model
 * still sees the command/context and the final result/error.
 */
function truncateMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.ceil(max / 2);
  const tail = Math.floor(max / 2);
  const removed = text.length - max;
  return (
    text.slice(0, head) +
    `\n…[truncated ${removed} chars]…\n` +
    text.slice(text.length - tail)
  );
}

/**
 * Build a compact, token-cheap transcript: one line per entry with its
 * entryId (for evidence references), kind, friction flag and text only.
 */
function entriesToTranscript(entries: any[]): string {
  return entries
    .map((e) => {
      const text = truncateMiddle(extractEntryText(e).trim(), MAX_ENTRY_CHARS);
      const flag = e?.friction?.isError ? " [ERROR]" : "";
      return `[${e.entryId}] ${e.kind}${flag}: ${text}`;
    })
    .join("\n\n");
}

/**
 * LangChain-based review engine
 */
export class ReviewEngine {
  private config: Required<ReviewEngineConfig>;
  private llm: BaseLanguageModel | null = null;
  private cacheIndex: Map<string, CacheEntry> = new Map();
  private readonly PROMPT_VERSION = "1.2";

  constructor(config: ReviewEngineConfig) {
    this.config = {
      model: config.model,
      provider: config.provider || this.detectProvider(config.model),
      cacheDir: config.cacheDir || ".review-cache",
      lessonsFile: config.lessonsFile || "lessons.json",
      temperature: config.temperature ?? 0.7,
      maxRetries: config.maxRetries ?? 3,
    };

    if (!fs.existsSync(this.config.cacheDir)) {
      fs.mkdirSync(this.config.cacheDir, { recursive: true });
    }

    this.loadCacheIndex();
  }

  /**
   * Auto-detect provider from model string
   */
  private detectProvider(model: string): LLMProvider {
    return detectLLMProvider(model);
  }

  /**
   * Initialize LLM based on configuration (lazy, via shared factory)
   */
  private async initializeLLM(): Promise<BaseLanguageModel> {
    if (this.llm) return this.llm;
    try {
      this.llm = await createLLM({
        model: this.config.model,
        provider: this.config.provider,
        temperature: this.config.temperature,
      });
    } catch (e) {
      throw new Error(`Failed to initialize LLM: ${e}`);
    }
    return this.llm;
  }

  /**
   * Generate content hash for cache keying
   */
  private generateContentHash(
    sessionId: string,
    conversationContent: string
  ): string {
    const key = `${sessionId}:${conversationContent}:${this.config.model}:${this.config.provider}:${this.PROMPT_VERSION}`;
    return crypto.createHash("sha256").update(key).digest("hex");
  }

  /**
   * Load cache index from disk
   */
  private loadCacheIndex(): void {
    const indexPath = path.join(this.config.cacheDir, "index.json");
    try {
      if (fs.existsSync(indexPath)) {
        const data = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
        this.cacheIndex = new Map(
          Object.entries(data).map(([k, v]) => [
            k,
            v as CacheEntry,
          ])
        );
      }
    } catch (e) {
      console.warn(`Failed to load cache index: ${e}`);
    }
  }

  /**
   * Save cache index to disk
   */
  private saveCacheIndex(): void {
    const indexPath = path.join(this.config.cacheDir, "index.json");
    const data = Object.fromEntries(this.cacheIndex);
    fs.writeFileSync(indexPath, JSON.stringify(data, null, 2));
  }

  /**
   * Get cached review if available and valid
   */
  private getCachedReview(hash: string): ConversationReview | null {
    const entry = this.cacheIndex.get(hash);
    if (!entry) return null;

    const filePath = path.join(this.config.cacheDir, `${hash}.json`);
    if (!fs.existsSync(filePath)) {
      this.cacheIndex.delete(hash);
      this.saveCacheIndex();
      return null;
    }

    return entry.review;
  }

  /**
   * Save review to cache
   */
  private cacheReview(
    hash: string,
    review: ConversationReview
  ): void {
    const entry: CacheEntry = {
      hash,
      timestamp: Date.now(),
      model: this.config.model,
      provider: this.config.provider,
      promptVersion: this.PROMPT_VERSION,
      review,
    };

    this.cacheIndex.set(hash, entry);
    const filePath = path.join(this.config.cacheDir, `${hash}.json`);
    fs.writeFileSync(filePath, JSON.stringify(review, null, 2));
    this.saveCacheIndex();
  }

  /**
   * Chunk long conversations to avoid context limits
   */
  private chunkConversation(entries: unknown[], maxChunkSize = 5000): unknown[][] {
    const chunks: unknown[][] = [];
    let currentChunk: unknown[] = [];
    let currentSize = 0;

    for (const entry of entries) {
      const entrySize = JSON.stringify(entry).length;
      if (currentSize + entrySize > maxChunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentSize = 0;
      }
      currentChunk.push(entry);
      currentSize += entrySize;
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  /**
   * Summarize conversation chunks with entry ID preservation
   */
  private summarizeChunks(chunks: unknown[][]): string {
    const summaries: string[] = [];

    for (const chunk of chunks) {
      const entryIds = chunk
        .map((entry: any) => entry.entryId)
        .filter(Boolean);
      summaries.push(`[Entries: ${entryIds.join(", ")}]\n${entriesToTranscript(chunk as any[])}`);
    }

    return summaries.join("\n\n---CHUNK BREAK---\n\n");
  }

  /**
   * Validate review against schema
   */
  private validateReview(review: unknown): review is ConversationReview {
    if (!review || typeof review !== "object") return false;
    const r = review as Record<string, unknown>;
    return (
      typeof r.sessionId === "string" &&
      typeof r.summary === "string" &&
      Array.isArray(r.userFixes) &&
      Array.isArray(r.selfCorrections) &&
      Array.isArray(r.lessonsLearned) &&
      typeof r.confidence === "number"
    );
  }

  /**
   * Call LLM with structured output and retry on invalid response
   */
  private async callLLMWithStructuredOutput(
    prompt: string,
    conversationContent: string
  ): Promise<ConversationReview> {
    const llm = await this.initializeLLM();

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        const fullPrompt = `${prompt}\n\nProvide ONLY a valid JSON response with no additional text. The JSON must have these fields: sessionId (string), summary (string), userFixes (array), selfCorrections (array), lessonsLearned (array), confidence (number 0-1).\n\nConversation to review:\n${conversationContent}`;

        const message = await llm.invoke(fullPrompt);
        const content =
          typeof message.content === "string"
            ? message.content
            : JSON.stringify(message.content);

        try {
          const parsed = JSON.parse(content);
          if (this.validateReview(parsed)) {
            return parsed;
          }
        } catch {
          // Fall through to extraction logic
        }

        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            if (this.validateReview(parsed)) {
              return parsed;
            }
          } catch (e) {
            // Continue to next attempt
          }
        }

        lastError = new Error(
          `Invalid response format (attempt ${attempt + 1}/${this.config.maxRetries})`
        );
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (attempt < this.config.maxRetries - 1) {
          console.log(
            `Review attempt ${attempt + 1} failed, retrying: ${lastError.message}`
          );
        }
      }
    }

    throw new Error(
      `Failed to get valid review after ${this.config.maxRetries} attempts: ${lastError?.message}`
    );
  }

  /**
   * Main review method
   */
  async review(
    sessionId: string,
    branch: ConversationBranch,
    forceRefresh = false
  ): Promise<{ review: ConversationReview; cached: boolean }> {
    const conversationContent = entriesToTranscript(branch.entries);
    const hash = this.generateContentHash(sessionId, conversationContent);

    if (!forceRefresh) {
      const cached = this.getCachedReview(hash);
      if (cached) {
        console.log(`Using cached review for session ${sessionId}`);
        return { review: cached, cached: true };
      }
    }

    let reviewContent = conversationContent;
    const chunks = this.chunkConversation(branch.entries);
    if (chunks.length > 1) {
      console.log(
        `Conversation chunked into ${chunks.length} parts for processing`
      );
      reviewContent = this.summarizeChunks(chunks);
    }

    const reviewPrompt = `You are an expert code and workflow reviewer. Analyze the following conversation and provide a structured review with three categories of findings:

1. **User Fixes (a)**: Things the user had to fix or correct or redirect the agent about
2. **Self-Corrections (b)**: Where the LLM took more than one try and fixed itself  
3. **Lessons Learned (c)**: Generalizable knowledge that could improve future sessions

For each finding, reference the entry IDs where the evidence appears. Be thorough and precise.

Each array MUST contain objects with EXACTLY these fields (use these exact key names; omit optional fields only if unknown):

userFixes[] objects:
  - description (string, required): what the user had to fix/redirect
  - whatAgentDidWrong (string, optional)
  - category (string, required): one of "misunderstood-intent", "wrong-tool", "style/convention", "wrong-file/scope", "incorrect-assumption", "missing-context", "other"
  - severity (string, required): one of "minor", "moderate", "major"
  - evidenceEntryIds (string[], required)

selfCorrections[] objects:
  - description (string, required): what the agent corrected on its own
  - attempts (number, required, >= 2)
  - rootCause (string, optional)
  - howResolved (string, optional)
  - signal (string, optional): one of "tool-error", "nonzero-exit", "test-failure", "reasoning-revision", "other"
  - evidenceEntryIds (string[], required)

lessonsLearned[] objects:
  - lesson (string, required): the generalizable lesson
  - appliesTo (string, required): one of "this-project", "general"
  - importantSteps (string[], optional)
  - requestedOutput (string, optional)
  - suggestedAgentsRule (string, optional): a concrete rule for AGENTS.md
  - evidenceEntryIds (string[], required)

Return empty arrays when a category has no findings. Do NOT invent alternative field names.

Session ID: ${sessionId}
Branch Title: ${branch.header.displayName}`;

    const review = await this.callLLMWithStructuredOutput(
      reviewPrompt,
      reviewContent
    );

    this.cacheReview(hash, review);

    if (review.taskType === "research" && review.lessonsLearned.length > 0) {
      await this.persistInsights(review, sessionId);
    }

    return { review, cached: false };
  }

  /**
   * Persist research insights to durable artifact
   */
  private async persistInsights(
    review: ConversationReview,
    sessionId: string
  ): Promise<void> {
    const lessonsFile = path.join(
      process.cwd(),
      this.config.lessonsFile
    );

    const insights: InsightsArtifact = {
      timestamp: Date.now(),
      importantSteps: [],
      requestedOutput: "",
      sources: [sessionId],
    };

    for (const lesson of review.lessonsLearned) {
      if (lesson.importantSteps && lesson.importantSteps.length > 0) {
        insights.importantSteps.push(...lesson.importantSteps);
      }
      if (lesson.requestedOutput) {
        insights.requestedOutput = lesson.requestedOutput;
      }
    }

    let allLessons: InsightsArtifact[] = [];
    if (fs.existsSync(lessonsFile)) {
      try {
        allLessons = JSON.parse(fs.readFileSync(lessonsFile, "utf-8"));
      } catch (e) {
        console.warn(`Failed to load existing lessons: ${e}`);
      }
    }

    allLessons.push(insights);

    fs.writeFileSync(lessonsFile, JSON.stringify(allLessons, null, 2));
    console.log(`Persisted insights for session ${sessionId} to ${lessonsFile}`);
  }

  /**
   * Invalidate cache for a session
   */
  invalidateCache(hash: string): void {
    const filePath = path.join(this.config.cacheDir, `${hash}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    this.cacheIndex.delete(hash);
    this.saveCacheIndex();
  }

  /**
   * Clear entire cache
   */
  clearCache(): void {
    const files = fs.readdirSync(this.config.cacheDir);
    for (const file of files) {
      if (file !== "index.json" && file.endsWith(".json")) {
        fs.unlinkSync(path.join(this.config.cacheDir, file));
      }
    }
    this.cacheIndex.clear();
    this.saveCacheIndex();
  }

  /**
   * Get cache stats
   */
  getCacheStats(): {
    size: number;
    entries: number;
    totalBytes: number;
  } {
    let totalBytes = 0;
    const files = fs.readdirSync(this.config.cacheDir);
    for (const file of files) {
      if (file.endsWith(".json")) {
        const filePath = path.join(this.config.cacheDir, file);
        const stats = fs.statSync(filePath);
        totalBytes += stats.size;
      }
    }

    return {
      size: this.cacheIndex.size,
      entries: this.cacheIndex.size,
      totalBytes,
    };
  }
}
