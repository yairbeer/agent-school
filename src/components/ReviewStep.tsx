/**
 * Review Step - Display conversation findings from LLM review
 * Shows userFixes, selfCorrections, and lessonsLearned with evidence links
 */

import { useState } from "react";
import type { SessionSummary, ConversationReview, UserFix, SelfCorrection, LessonLearned } from "../../shared/types.js";
import { reviewSession } from "../api/client.js";
import "./ReviewStep.css";

interface ReviewStepProps {
  sessions: SessionSummary[];
  projectDir: string;
  excludeThinking?: boolean;
  onReviewsComplete?: (reviews: ConversationReview[]) => void;
}

interface ReviewState {
  sessionId: string;
  status: "idle" | "loading" | "success" | "error";
  review?: ConversationReview;
  error?: string;
}

export function ReviewStep({ sessions, projectDir, excludeThinking, onReviewsComplete }: ReviewStepProps) {
  const [reviews, setReviews] = useState<Map<string, ConversationReview>>(new Map());
  const [reviewStates, setReviewStates] = useState<Map<string, ReviewState>>(new Map());
  const [forceRefresh, setForceRefresh] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  const handleRunReviews = async () => {
    setIsRunning(true);
    const newReviews = new Map(reviews);
    const newStates = new Map<string, ReviewState>();

    for (const session of sessions) {
      newStates.set(session.id, {
        sessionId: session.id,
        status: "loading",
      });
    }
    setReviewStates(newStates);

    for (const session of sessions) {
      try {
        const response = await reviewSession(session.id, forceRefresh, projectDir, excludeThinking);
        const review = response.review;

        newReviews.set(session.id, review);
        newStates.set(session.id, {
          sessionId: session.id,
          status: "success",
          review,
        });
      } catch (err) {
        const error = err instanceof Error ? err.message : "Unknown error";
        newStates.set(session.id, {
          sessionId: session.id,
          status: "error",
          error,
        });
      }
    }

    setReviews(newReviews);
    setReviewStates(newStates);
    setIsRunning(false);

    if (onReviewsComplete && newReviews.size > 0) {
      onReviewsComplete(Array.from(newReviews.values()));
    }
  };

  const handleEvidenceClick = (entryId: string) => {
    // Scroll to transcript anchor
    const element = document.querySelector(`[data-entry-id="${entryId}"]`);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
      element.classList.add("highlight");
      setTimeout(() => element.classList.remove("highlight"), 2000);
    } else {
      console.warn(`Entry anchor not found: ${entryId}`);
    }
  };

  return (
    <div className="review-step">
      <div className="review-controls">
        <div className="control-group">
          <label>
            <input
              type="checkbox"
              checked={forceRefresh}
              onChange={(e) => setForceRefresh(e.target.checked)}
              disabled={isRunning}
            />
            Force re-review (ignore cache)
          </label>
        </div>

        <button
          className="btn btn-primary"
          onClick={handleRunReviews}
          disabled={isRunning || sessions.length === 0}
        >
          {isRunning ? "Running reviews..." : `Review ${sessions.length} session(s)`}
        </button>
      </div>

      {sessions.length === 0 && (
        <div className="empty-state">
          <p>No sessions selected for review. Go back to preview and select sessions to review.</p>
        </div>
      )}

      <div className="reviews-container">
        {sessions.map((session) => {
          const state = reviewStates.get(session.id);
          const review = reviews.get(session.id);

          return (
            <div key={session.id} className="review-panel">
              <div className="review-header">
                <h3>{session.displayName}</h3>
                <div className="review-status">
                  {state?.status === "loading" && <span className="status-badge loading">⟳ Loading</span>}
                  {state?.status === "success" && <span className="status-badge success">✓ Reviewed</span>}
                  {state?.status === "error" && <span className="status-badge error">✗ Error</span>}
                  {!state && <span className="status-badge idle">Pending</span>}
                </div>
              </div>

              {state?.error && (
                <div className="review-error">
                  <p>Error: {state.error}</p>
                </div>
              )}

              {review && (
                <div className="review-content">
                  <div className="review-summary">
                    <p>{review.summary}</p>
                    {review.taskType && <span className="task-type-badge">{review.taskType}</span>}
                  </div>

                  {/* User Fixes Section */}
                  <div className="findings-section">
                    <h4 className="section-title">(a) User Fixes</h4>
                    {review.userFixes.length > 0 ? (
                      <div className="findings-list">
                        {review.userFixes.map((fix, idx) => (
                          <FindingItem
                            key={idx}
                            finding={fix}
                            type="userFix"
                            onEvidenceClick={handleEvidenceClick}
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="no-findings">No user fixes detected.</p>
                    )}
                  </div>

                  {/* Self Corrections Section */}
                  <div className="findings-section">
                    <h4 className="section-title">(b) Self Corrections</h4>
                    {review.selfCorrections.length > 0 ? (
                      <div className="findings-list">
                        {review.selfCorrections.map((correction, idx) => (
                          <FindingItem
                            key={idx}
                            finding={correction}
                            type="selfCorrection"
                            onEvidenceClick={handleEvidenceClick}
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="no-findings">No self corrections detected.</p>
                    )}
                  </div>

                  {/* Lessons Learned Section */}
                  <div className="findings-section">
                    <h4 className="section-title">(c) Lessons Learned</h4>
                    {review.lessonsLearned.length > 0 ? (
                      <div className="findings-list">
                        {review.lessonsLearned.map((lesson, idx) => (
                          <FindingItem
                            key={idx}
                            finding={lesson}
                            type="lesson"
                            onEvidenceClick={handleEvidenceClick}
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="no-findings">No lessons learned detected.</p>
                    )}
                  </div>

                  <div className="review-confidence">
                    <span>Confidence: {(review.confidence * 100).toFixed(0)}%</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface FindingItemProps {
  finding: UserFix | SelfCorrection | LessonLearned;
  type: "userFix" | "selfCorrection" | "lesson";
  onEvidenceClick: (entryId: string) => void;
}

function FindingItem({ finding, type, onEvidenceClick }: FindingItemProps) {
  // Render based on the known `type` rather than fragile field-presence
  // heuristics (optional fields like `signal` may be absent, which used to
  // leave the box empty).
  const userFix = type === "userFix" ? (finding as UserFix) : null;
  const selfCorrection =
    type === "selfCorrection" ? (finding as SelfCorrection) : null;
  const lesson = type === "lesson" ? (finding as LessonLearned) : null;

  return (
    <div className={`finding-item finding-${type}`}>
      {userFix && (
        <>
          <div className="finding-meta">
            {userFix.category && (
              <span className={`badge category ${userFix.category}`}>{userFix.category}</span>
            )}
            {userFix.severity && (
              <span className={`badge severity ${userFix.severity}`}>{userFix.severity}</span>
            )}
          </div>
          <p className="finding-description">{userFix.description}</p>
          {userFix.whatAgentDidWrong && (
            <p className="finding-detail">
              <strong>What went wrong:</strong> {userFix.whatAgentDidWrong}
            </p>
          )}
        </>
      )}

      {selfCorrection && (
        <>
          <div className="finding-meta">
            {selfCorrection.attempts != null && (
              <span className="badge attempts">Attempts: {selfCorrection.attempts}</span>
            )}
            {selfCorrection.signal && (
              <span className={`badge signal ${selfCorrection.signal}`}>{selfCorrection.signal}</span>
            )}
          </div>
          <p className="finding-description">{selfCorrection.description}</p>
          {selfCorrection.rootCause && (
            <p className="finding-detail">
              <strong>Root cause:</strong> {selfCorrection.rootCause}
            </p>
          )}
          {selfCorrection.howResolved && (
            <p className="finding-detail">
              <strong>Resolution:</strong> {selfCorrection.howResolved}
            </p>
          )}
        </>
      )}

      {lesson && (
        <>
          <div className="finding-meta">
            {lesson.appliesTo && (
              <span className={`badge applies-to ${lesson.appliesTo}`}>{lesson.appliesTo}</span>
            )}
          </div>
          <p className="finding-description">{lesson.lesson}</p>
          {lesson.importantSteps && lesson.importantSteps.length > 0 && (
            <div className="finding-detail">
              <strong>Important steps:</strong>
              <ol>
                {lesson.importantSteps.map((step, idx) => (
                  <li key={idx}>{step}</li>
                ))}
              </ol>
            </div>
          )}
          {lesson.requestedOutput && (
            <p className="finding-detail">
              <strong>Requested output:</strong> {lesson.requestedOutput}
            </p>
          )}
          {lesson.suggestedAgentsRule && (
            <p className="finding-detail">
              <strong>For AGENTS.md:</strong> {lesson.suggestedAgentsRule}
            </p>
          )}
        </>
      )}

      {finding.evidenceEntryIds && finding.evidenceEntryIds.length > 0 && (
        <div className="evidence-links">
          <strong>Evidence:</strong>
          <div className="entry-links">
            {finding.evidenceEntryIds.map((entryId, idx) => (
              <button
                key={idx}
                className="evidence-link"
                onClick={() => onEvidenceClick(entryId)}
                title={`Jump to entry ${entryId}`}
              >
                #{entryId}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
