/**
 * Aggregate step - LLM clusters per-session findings into recurring issues.
 * Sits between Review and Propose & Save.
 */

import { useEffect, useRef, useState } from "react";
import type {
  ConversationReview,
  AggregatedInsights,
  RepeatingIssue,
} from "../../shared/types.js";
import { aggregateInsights } from "../api/client.js";
import "./AggregateStep.css";

interface AggregateStepProps {
  reviews: ConversationReview[];
  onInsightsReady: (insights: AggregatedInsights) => void;
  // True for the bundled demo project — the server returns mock recurring
  // issues instead of calling the LLM.
  demo?: boolean;
}

export function AggregateStep({ reviews, onInsightsReady, demo }: AggregateStepProps) {
  const [insights, setInsights] = useState<AggregatedInsights | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);
  const mountedRef = useRef(true);

  const run = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const { insights: result } = await aggregateInsights(
        reviews,
        demo ? "__demo__" : undefined,
        demo
      );
      if (!mountedRef.current) return;
      setInsights(result);
      onInsightsReady(result);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  };

  // Run once on mount (guarded against React StrictMode double-invoke).
  useEffect(() => {
    mountedRef.current = true;
    if (!startedRef.current) {
      startedRef.current = true;
      run();
    }
    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="aggregate-step">
      <div className="aggregate-header">
        <h2>Recurring Issues</h2>
        <p>
          The LLM clustered the findings from {reviews.length} reviewed session(s)
          into the recurring themes below. These are prioritized when proposing
          your AGENTS.md.
        </p>
      </div>

      {isLoading && (
        <div className="aggregate-loading">
          <div className="spinner" />
          <p>Clustering findings into recurring issues…</p>
        </div>
      )}

      {error && (
        <div className="aggregate-error">
          <h3>Aggregation failed</h3>
          <p>{error}</p>
          <button
            className="btn btn-secondary"
            onClick={() => {
              startedRef.current = true;
              run();
            }}
          >
            Try again
          </button>
        </div>
      )}

      {insights && !isLoading && (
        <div className="aggregate-content">
          {insights.summary && <p className="aggregate-summary">{insights.summary}</p>}

          {insights.repeatingIssues.length === 0 ? (
            <p className="no-issues">
              No recurring issues were found across these sessions.
            </p>
          ) : (
            <ol className="issues-list">
              {insights.repeatingIssues.map((issue, idx) => (
                <IssueCard key={idx} issue={issue} />
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

function IssueCard({ issue }: { issue: RepeatingIssue }) {
  return (
    <li className={`issue-card severity-${issue.severity}`}>
      <div className="issue-head">
        <span className="issue-title">{issue.title}</span>
        <span className="issue-badges">
          <span className="badge occurrences" title="Sessions this recurred in">
            ×{issue.occurrences}
          </span>
          <span className="badge category">{issue.category}</span>
          <span className={`badge severity ${issue.severity}`}>{issue.severity}</span>
        </span>
      </div>
      <p className="issue-description">{issue.description}</p>
      {issue.suggestedAgentsRule && (
        <p className="issue-rule">
          <strong>Suggested rule:</strong> {issue.suggestedAgentsRule}
        </p>
      )}
      {issue.sessionIds.length > 0 && (
        <p className="issue-sessions">
          <strong>Seen in:</strong> {issue.sessionIds.join(", ")}
        </p>
      )}
    </li>
  );
}
