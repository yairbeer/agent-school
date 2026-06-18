/**
 * Aggregator: FR-13 & FR-14
 *
 * Collect every finding (user fixes / mistakes, self-corrections and lessons
 * learned) from all per-conversation reviews into a single project-level set.
 *
 * We intentionally do NOT cluster or rank by frequency: two sessions rarely
 * produce the exact same lesson, and collapsing them hides individual points.
 * Instead we surface all points, each tagged with its source session.
 */

import type {
  ConversationReview,
  AggregatedLessons,
} from "../shared/types.js";

/**
 * Merge all findings from the given reviews. Order is preserved
 * (review order, then finding order within each review).
 */
export function aggregateLessons(
  reviews: ConversationReview[],
  projectId: string = "default"
): AggregatedLessons {
  const timestamp = Date.now();

  const userFixes: AggregatedLessons["userFixes"] = [];
  const selfCorrections: AggregatedLessons["selfCorrections"] = [];
  const lessonsLearned: AggregatedLessons["lessonsLearned"] = [];

  for (const review of reviews) {
    const sessionId = review.sessionId;
    for (const f of review.userFixes ?? []) {
      userFixes.push({ ...f, sessionId });
    }
    for (const c of review.selfCorrections ?? []) {
      selfCorrections.push({ ...c, sessionId });
    }
    for (const l of review.lessonsLearned ?? []) {
      lessonsLearned.push({ ...l, sessionId });
    }
  }

  const projectSpecific = lessonsLearned.filter(
    (l) => l.appliesTo === "this-project"
  );
  const general = lessonsLearned.filter((l) => l.appliesTo === "general");

  return {
    projectId,
    timestamp,
    userFixes,
    selfCorrections,
    lessonsLearned,
    projectSpecific,
    general,
  };
}

/**
 * Lessons that feed the AGENTS.md proposal. All lessons are eligible
 * (no frequency threshold).
 */
export function getLessonsForAgents(
  aggregated: AggregatedLessons
): AggregatedLessons["lessonsLearned"] {
  return aggregated.lessonsLearned;
}
