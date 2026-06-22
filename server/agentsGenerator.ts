/**
 * AGENTS.md Generator: FR-16 & FR-17
 * Generate proposed AGENTS.md via a single meta LLM pass
 */

import fs from "fs";
import path from "path";
import { resolveProjectDir } from "./sessionLoader.js";
import { BaseLanguageModel } from "@langchain/core/language_models/base";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import type {
  AggregatedLessons,
  AggregatedInsights,
  AgentsProposal,
  AgentType,
} from "../shared/types.js";

/**
 * Configuration for the agents generator
 */
export interface AgentsGeneratorConfig {
  llm: BaseLanguageModel;
  temperature?: number;
  maxRetries?: number;
}

/**
 * Format all collected findings for the LLM prompt. Lessons are indexed
 * ([LESSON-N]) for traceability; mistakes and self-corrections are included
 * as context so the proposal can prevent recurring problems.
 */
function formatLessonsForPrompt(aggregated: AggregatedLessons): string {
  let formatted = "# Findings from reviewed sessions\n\n";

  formatted += "## Lessons learned (each indexed for traceability)\n";
  if (aggregated.lessonsLearned.length === 0) {
    formatted += "*(none)\n";
  } else {
    aggregated.lessonsLearned.forEach((lesson, idx) => {
      formatted += `- [LESSON-${idx}] (${lesson.appliesTo}, source: ${lesson.sessionId}) ${lesson.lesson}\n`;
      if (lesson.suggestedAgentsRule) {
        formatted += `  Suggested rule: ${lesson.suggestedAgentsRule}\n`;
      }
    });
  }

  formatted += "\n## Recurring mistakes / user corrections to prevent\n";
  if (aggregated.userFixes.length === 0) {
    formatted += "*(none)\n";
  } else {
    aggregated.userFixes.forEach((fix) => {
      formatted += `- (${fix.category}, ${fix.severity}, source: ${fix.sessionId}) ${fix.description}\n`;
    });
  }

  formatted += "\n## Self-corrections (where the agent struggled)\n";
  if (aggregated.selfCorrections.length === 0) {
    formatted += "*(none)\n";
  } else {
    aggregated.selfCorrections.forEach((c) => {
      formatted += `- (${c.attempts} attempts, source: ${c.sessionId}) ${c.description}\n`;
    });
  }

  return formatted;
}

/**
 * System prompt: the role, task and output rules (independent of session data).
 */
function buildSystemPrompt(): string {
  return `You are an expert AGENTS.md author. You are given a project's CURRENT AGENTS.md and a set of findings (lessons learned, recurring user corrections, and self-corrections) mined from recent agent sessions. Produce an improved, complete AGENTS.md.

## How to integrate the findings

- Treat the CURRENT AGENTS.md as the source of truth for structure, tone, and section ordering. Keep its existing headings and overall shape.
- Weave each finding into the MOST RELEVANT existing section, as if it had always been part of the document. Prefer editing or extending an existing bullet/paragraph over adding a new one.
- Only create a new section when a finding genuinely does not fit any existing section, and place it where it logically belongs in the document — never as a trailing dump.
- Do NOT append a "Lessons", "Do's and Don'ts", "Findings", or summary section that just lists the findings at the end. The result must read as one coherent, hand-written document.
- Do NOT include any traceability markers such as [LESSON-N], "(source: ...)", severity labels, or attempt counts in the output. The final file must be clean and production-ready.
- Merge duplicates and resolve conflicts. If a finding contradicts existing guidance, prefer the finding and update the text in place.
- Preserve all still-valid existing guidance, code blocks, tables, and examples unless a finding requires changing them.

## Output

Return ONLY the complete AGENTS.md as markdown — no preamble, no explanation, and no code fences wrapping the whole document.

Be specific and actionable. Do not add generic advice that isn't grounded in the findings or already present in the document.`;
}

/**
 * Format the LLM-clustered recurring issues so they are prioritized in the
 * proposal. These come from the Aggregate step and represent the durable,
 * repeated problems most worth encoding.
 */
function formatInsightsForPrompt(insights: AggregatedInsights): string {
  if (!insights.repeatingIssues?.length) return "";
  let out = "# Recurring issues (clustered across sessions — prioritize these)\n";
  if (insights.summary) out += `${insights.summary}\n`;
  insights.repeatingIssues.forEach((issue, idx) => {
    out += `\n${idx + 1}. ${issue.title} (${issue.category}, ${issue.severity}, seen in ${issue.occurrences} session(s))\n`;
    out += `   ${issue.description}\n`;
    if (issue.suggestedAgentsRule) {
      out += `   Suggested rule: ${issue.suggestedAgentsRule}\n`;
    }
  });
  return out;
}

/**
 * User message: the concrete inputs (current AGENTS.md + the findings).
 */
function buildUserMessage(
  existingAgents: string,
  aggregated: AggregatedLessons,
  insights?: AggregatedInsights
): string {
  const lessonsFormatted = formatLessonsForPrompt(aggregated);
  const insightsFormatted = insights ? formatInsightsForPrompt(insights) : "";

  return `CURRENT AGENTS.md:
${existingAgents || "*(no existing AGENTS.md - starting fresh)"}

---
${insightsFormatted ? `\n${insightsFormatted}\n---\n` : ""}
${lessonsFormatted}`;
}


/**
 * Parse LLM response to extract agents content and traceability
 */
interface ParsedProposal {
  content: string;
  traceability: Array<{
    section: string;
    lessonIndices: number[];
    reasoning: string;
  }>;
}

function parseAgentsResponse(
  llmResponse: string,
  aggregated: AggregatedLessons
): ParsedProposal {
  const content = llmResponse;
  const lessonCount = aggregated.lessonsLearned.length;

  // Find all '## Section' headers, then for each section slice up to the next
  // header and collect the [LESSON-N] references inside it. Uses matchAll so
  // there is no shared/zero lastIndex regex state (the previous version reset
  // a regex literal every iteration and looped forever).
  const headers = [...content.matchAll(/^## (.+)$/gm)];
  const traceability: ParsedProposal["traceability"] = [];

  for (let i = 0; i < headers.length; i++) {
    const header = headers[i];
    const start = (header.index ?? 0) + header[0].length;
    const end =
      i + 1 < headers.length ? headers[i + 1].index ?? content.length : content.length;
    const sectionContent = content.slice(start, end);

    const indices = new Set<number>();
    for (const m of sectionContent.matchAll(/\[LESSON-(\d+)\]/g)) {
      const index = parseInt(m[1], 10);
      if (index < lessonCount) indices.add(index);
    }

    if (indices.size > 0) {
      traceability.push({
        section: header[1],
        lessonIndices: Array.from(indices),
        reasoning: "Based on referenced lessons",
      });
    }
  }

  return {
    content,
    traceability,
  };
}

/**
 * Main agents generator
 */
export class AgentsGenerator {
  private config: Required<AgentsGeneratorConfig>;

  constructor(config: AgentsGeneratorConfig) {
    this.config = {
      llm: config.llm,
      temperature: config.temperature ?? 0.7,
      maxRetries: config.maxRetries ?? 2,
    };
  }

  /**
   * Generate a proposed AGENTS.md from aggregated lessons
   */
  async generateProposal(
    aggregated: AggregatedLessons,
    existingAgents: string = "",
    insights?: AggregatedInsights
  ): Promise<AgentsProposal> {
    const systemPrompt = buildSystemPrompt();
    const userMessage = buildUserMessage(existingAgents, aggregated, insights);
    console.log(
      `[propose] prompt sizes: system=${systemPrompt.length} chars, user=${userMessage.length} chars (~${Math.round((systemPrompt.length + userMessage.length) / 4)} tokens)`
    );

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        // Bound the call so a stuck/slow model fails fast instead of hanging.
        console.log(`[propose] invoking LLM (attempt ${attempt + 1}/${this.config.maxRetries})...`);
        const invokeStart = Date.now();
        const message = await this.config.llm.invoke(
          [new SystemMessage(systemPrompt), new HumanMessage(userMessage)],
          {
            signal: AbortSignal.timeout(300_000),
          } as Record<string, unknown>
        );
        console.log(
          `[propose] LLM responded in ${((Date.now() - invokeStart) / 1000).toFixed(1)}s`
        );
        const responseContent =
          typeof message.content === "string"
            ? message.content
            : JSON.stringify(message.content);

        const parsed = parseAgentsResponse(responseContent, aggregated);

        const traceabilityArray = [];
        for (const trace of parsed.traceability) {
          for (const idx of trace.lessonIndices) {
            traceabilityArray.push({
              entryId: `LESSON-${idx}`,
              section: trace.section,
              reasoning: trace.reasoning,
            });
          }
        }

        const proposal: AgentsProposal = {
          before: existingAgents,
          after: parsed.content,
          traceability: traceabilityArray,
          confidence: 0.9,
          prompt: { system: systemPrompt, user: userMessage },
        };

        return proposal;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (attempt < this.config.maxRetries - 1) {
          console.log(
            `Agents generation attempt ${attempt + 1} failed, retrying: ${lastError.message}`
          );
        }
      }
    }

    throw new Error(
      `Failed to generate agents proposal after ${this.config.maxRetries} attempts: ${lastError?.message}`
    );
  }
}

/**
 * Conventions filename for a given agent. pi reads/writes AGENTS.md; Claude
 * Code uses CLAUDE.md. Defaults to AGENTS.md to preserve existing behavior.
 */
export function agentsFileName(agent: AgentType = "pi"): string {
  return agent === "claude-code" ? "CLAUDE.md" : "AGENTS.md";
}

/**
 * Read current conventions file (AGENTS.md / CLAUDE.md) from a project dir
 */
export function readCurrentAgents(projectDir: string, agent: AgentType = "pi"): string {
  const agentsPath = path.join(resolveProjectDir(projectDir), agentsFileName(agent));

  if (!fs.existsSync(agentsPath)) {
    return "";
  }

  try {
    return fs.readFileSync(agentsPath, "utf-8");
  } catch (err) {
    console.error(`Failed to read ${agentsFileName(agent)}: ${err}`);
    return "";
  }
}

/**
 * Get modification time of the conventions file
 */
export function getAgentsMtime(projectDir: string, agent: AgentType = "pi"): number | null {
  const agentsPath = path.join(resolveProjectDir(projectDir), agentsFileName(agent));

  if (!fs.existsSync(agentsPath)) {
    return null;
  }

  try {
    const stats = fs.statSync(agentsPath);
    return stats.mtimeMs;
  } catch (err) {
    console.error(`Failed to get ${agentsFileName(agent)} mtime: ${err}`);
    return null;
  }
}

/**
 * Save the conventions file with atomic write and backup
 */
export function saveAgents(
  projectDir: string,
  content: string,
  expectedMtime?: number,
  agent: AgentType = "pi"
): {
  success: boolean;
  mtime: number;
  backupPath?: string;
  error?: string;
} {
  try {
    const resolvedDir = resolveProjectDir(projectDir);
    const fileName = agentsFileName(agent);
    const agentsPath = path.join(resolvedDir, fileName);
    const backupDir = path.join(resolvedDir, ".agents_backups");

    if (expectedMtime !== undefined) {
      const currentMtime = getAgentsMtime(projectDir, agent);
      if (currentMtime !== null && currentMtime !== expectedMtime) {
        return {
          success: false,
          mtime: 0,
          error: `${fileName} was modified externally; conflict detected`,
        };
      }
    }

    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    let backupPath: string | undefined;

    if (fs.existsSync(agentsPath)) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      backupPath = path.join(backupDir, `${fileName}.${timestamp}.bak`);

      const existingContent = fs.readFileSync(agentsPath, "utf-8");
      fs.writeFileSync(backupPath, existingContent);
    }

    const tempPath = path.join(resolvedDir, `.${fileName}.tmp.${Date.now()}`);
    fs.writeFileSync(tempPath, content);
    fs.renameSync(tempPath, agentsPath);

    const stats = fs.statSync(agentsPath);
    const newMtime = stats.mtimeMs;

    return {
      success: true,
      mtime: newMtime,
      backupPath,
    };
  } catch (err) {
    return {
      success: false,
      mtime: 0,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
