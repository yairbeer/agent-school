/**
 * Insights aggregator (the "Aggregate" wizard step).
 *
 * Takes every per-session finding and asks an LLM to cluster them into
 * RECURRING issues across sessions — the durable, repeated problems that are
 * worth encoding into AGENTS.md. This is intentionally LLM-driven (semantic
 * clustering) rather than string matching: two sessions rarely phrase the same
 * problem identically.
 */

import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import type {
  ConversationReview,
  AggregatedInsights,
  RepeatingIssue,
} from "../shared/types.js";

const SYSTEM_PROMPT = `You are analyzing findings extracted from multiple coding-agent sessions in a single project. Each finding belongs to a session (identified by its sessionId). Your job is to cluster these findings into RECURRING issues — themes that show up across more than one finding or session — so the team can encode durable rules.

Rules:
- Group semantically-similar findings together even if worded differently.
- Prefer issues that recur across multiple sessions; a one-off can be included only if clearly important.
- For each recurring issue, list the distinct sessionIds it appears in and set "occurrences" to that count.
- Order issues by how strongly they recur (most recurring first).
- "suggestedAgentsRule" should be a single concrete, actionable rule suitable for an AGENTS.md.

Return ONLY a JSON object (no markdown, no code fences) matching exactly:
{
  "summary": "1-3 sentence overview of the recurring themes",
  "repeatingIssues": [
    {
      "title": "short theme name",
      "description": "what the recurring issue is, in plain terms",
      "category": "free-form label e.g. testing | conventions | scope | tooling | correctness",
      "severity": "minor | moderate | major",
      "occurrences": 2,
      "sessionIds": ["..."],
      "suggestedAgentsRule": "a concrete rule for AGENTS.md"
    }
  ]
}`;

/**
 * Build the user message: a compact, sessionId-tagged list of every finding.
 */
export function buildInsightsUserMessage(reviews: ConversationReview[]): string {
  const lines: string[] = [];
  for (const review of reviews) {
    const sid = review.sessionId;
    lines.push(`### Session ${sid}${review.title ? ` — ${review.title}` : ""}`);
    if (review.summary) lines.push(`Summary: ${review.summary}`);
    for (const f of review.userFixes ?? []) {
      lines.push(
        `- [user-fix] (${f.category}, ${f.severity}) ${f.description}${
          f.whatAgentDidWrong ? ` — wrong: ${f.whatAgentDidWrong}` : ""
        }`
      );
    }
    for (const c of review.selfCorrections ?? []) {
      lines.push(
        `- [self-correction] (${c.attempts} attempts${
          c.signal ? `, ${c.signal}` : ""
        }) ${c.description}${c.rootCause ? ` — cause: ${c.rootCause}` : ""}`
      );
    }
    for (const l of review.lessonsLearned ?? []) {
      lines.push(
        `- [lesson] (${l.appliesTo}) ${l.lesson}${
          l.suggestedAgentsRule ? ` — rule: ${l.suggestedAgentsRule}` : ""
        }`
      );
    }
    lines.push("");
  }
  return `Findings from ${reviews.length} session(s):\n\n${lines.join("\n")}`;
}

/**
 * Strip markdown code fences and parse the first JSON object in the text.
 */
function parseInsightsJson(raw: string): {
  summary?: string;
  repeatingIssues?: unknown[];
} {
  let text = raw.trim();
  // Remove ```json ... ``` or ``` ... ``` fences if present.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  // Fall back to the first {...} block.
  if (!text.startsWith("{")) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      text = text.slice(start, end + 1);
    }
  }
  return JSON.parse(text);
}

function normalizeIssue(raw: unknown): RepeatingIssue | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const title = typeof o.title === "string" ? o.title : "";
  const description = typeof o.description === "string" ? o.description : "";
  if (!title && !description) return null;
  const sessionIds = Array.isArray(o.sessionIds)
    ? (o.sessionIds.filter((s) => typeof s === "string") as string[])
    : [];
  const sevRaw = typeof o.severity === "string" ? o.severity : "moderate";
  const severity = (["minor", "moderate", "major"].includes(sevRaw)
    ? sevRaw
    : "moderate") as RepeatingIssue["severity"];
  const occurrences =
    typeof o.occurrences === "number" && o.occurrences > 0
      ? Math.round(o.occurrences)
      : Math.max(sessionIds.length, 1);
  return {
    title: title || description.slice(0, 60),
    description,
    category: typeof o.category === "string" ? o.category : "other",
    severity,
    occurrences,
    sessionIds,
    suggestedAgentsRule:
      typeof o.suggestedAgentsRule === "string"
        ? o.suggestedAgentsRule
        : undefined,
  };
}

const hasFindings = (r: ConversationReview) =>
  (r.userFixes?.length ?? 0) +
    (r.selfCorrections?.length ?? 0) +
    (r.lessonsLearned?.length ?? 0) >
  0;

/**
 * Cluster the reviews into recurring issues via the LLM.
 */
export async function aggregateInsights(
  reviews: ConversationReview[],
  llm: BaseLanguageModel,
  projectId: string = "default"
): Promise<AggregatedInsights> {
  const timestamp = Date.now();
  const reviewsWithFindings = reviews.filter(hasFindings);

  if (reviewsWithFindings.length === 0) {
    return {
      projectId,
      timestamp,
      summary: "No findings were extracted from the reviewed sessions.",
      repeatingIssues: [],
    };
  }

  const userMessage = buildInsightsUserMessage(reviewsWithFindings);

  const response = await llm.invoke([
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage(userMessage),
  ]);

  const content =
    typeof (response as { content?: unknown }).content === "string"
      ? ((response as { content: string }).content)
      : Array.isArray((response as { content?: unknown }).content)
        ? ((response as { content: Array<{ text?: string }> }).content
            .map((b) => (typeof b?.text === "string" ? b.text : ""))
            .join(""))
        : String((response as { content?: unknown }).content ?? "");

  let parsed: { summary?: string; repeatingIssues?: unknown[] };
  try {
    parsed = parseInsightsJson(content);
  } catch (err) {
    throw new Error(
      `Failed to parse insights JSON from LLM: ${
        err instanceof Error ? err.message : "unknown error"
      }`
    );
  }

  const repeatingIssues = (parsed.repeatingIssues ?? [])
    .map(normalizeIssue)
    .filter((i): i is RepeatingIssue => i !== null)
    .sort((a, b) => b.occurrences - a.occurrences);

  return {
    projectId,
    timestamp,
    summary:
      typeof parsed.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim()
        : `Found ${repeatingIssues.length} recurring issue(s) across ${reviewsWithFindings.length} session(s).`,
    repeatingIssues,
  };
}
