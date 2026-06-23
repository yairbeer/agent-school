/**
 * SessionList — Step 2: Browse and select sessions for review batch
 */

import { useState, useMemo, useEffect } from "react";
import type { SessionSummary } from "../../shared/types.js";

interface SessionListProps {
  sessions: SessionSummary[];
  onSelectChange: (selected: Set<string>) => void;
  excludeThinking?: boolean;
  onExcludeThinkingChange?: (value: boolean) => void;
  onPreview?: (id: string) => void;
  previewId?: string | null;
}

export function SessionList({
  sessions,
  onSelectChange,
  excludeThinking = false,
  onExcludeThinkingChange,
  onPreview,
  previewId,
}: SessionListProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<"name" | "timestamp" | "cost">("timestamp");
  const [filterText, setFilterText] = useState("");

  // Select all sessions by default so the user can go straight to Review;
  // they can deselect any they don't want. Re-runs when the session set
  // changes (e.g. switching projects or loading the demo).
  useEffect(() => {
    const all = new Set(sessions.map((s) => s.id));
    setSelected(all);
    onSelectChange(all);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions]);

  const sorted = useMemo(() => {
    const filtered = sessions.filter(
      (s) =>
        s.displayName.toLowerCase().includes(filterText.toLowerCase()) ||
        s.id.toLowerCase().includes(filterText.toLowerCase())
    );

    return [...filtered].sort((a, b) => {
      switch (sortBy) {
        case "name":
          return a.displayName.localeCompare(b.displayName);
        case "timestamp":
          return b.timestamp - a.timestamp;
        case "cost":
          return b.costTotal - a.costTotal;
        default:
          return 0;
      }
    });
  }, [sessions, sortBy, filterText]);

  const handleSelectAll = (checked: boolean) => {
    const next = checked
      ? new Set(sorted.map((s) => s.id))
      : new Set<string>();
    setSelected(next);
    onSelectChange(next);
  };

  const handleSelectSession = (id: string, checked: boolean) => {
    const newSelected = new Set(selected);
    if (checked) {
      newSelected.add(id);
    } else {
      newSelected.delete(id);
    }
    setSelected(newSelected);
    onSelectChange(newSelected);
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatModels = (models: string[]) => {
    if (models.length === 0) return "—";
    return models.length === 1 ? models[0] : `${models[0]} +${models.length - 1}`;
  };

  const formatCost = (cost: number) => {
    if (cost < 0.01) return "< $0.01";
    return `$${cost.toFixed(2)}`;
  };

  // Token/cost adjusted for excluded thinking blocks (estimate).
  // Basis is the transcript content size (the analysis input), so excluding
  // thinking visibly reduces both tokens and the cost estimate.
  const baseTokens = (s: SessionSummary) => s.contentTokenTotal ?? s.tokenTotal;

  const effectiveTokens = (s: SessionSummary) =>
    excludeThinking
      ? Math.max(0, baseTokens(s) - (s.thinkingTokenTotal ?? 0))
      : baseTokens(s);

  // Estimate the cost of SENDING this conversation to the analysis LLM once
  // (input tokens only), not the session's historical spend. Rough default
  // rate ~ $3 per 1M input tokens (Claude Sonnet-class).
  const REVIEW_INPUT_PRICE_PER_1M = 3;
  const effectiveCost = (s: SessionSummary) =>
    (effectiveTokens(s) / 1_000_000) * REVIEW_INPUT_PRICE_PER_1M;

  return (
    <div className="session-list">
      <h2>Preview & Select Sessions</h2>
      <p className="instructions">
        Review the sessions below and select which ones to include in your review batch. Multi-select
        to analyze patterns across conversations.
      </p>

      <div className="list-controls">
        <input
          type="text"
          placeholder="Filter sessions..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="input input-search"
        />

        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as "name" | "timestamp" | "cost")} className="input input-select">
          <option value="timestamp">Sort by: Recent</option>
          <option value="name">Sort by: Name</option>
          <option value="cost">Sort by: Cost</option>
        </select>

        <label className="exclude-thinking-toggle" title="Thinking blocks are excluded from the LLM analysis and from the cost estimate below">
          <input
            type="checkbox"
            checked={excludeThinking}
            onChange={(e) => onExcludeThinkingChange?.(e.target.checked)}
            className="checkbox"
          />
          Exclude thinking from analysis
        </label>

        <div className="selection-info">
          {selected.size > 0 ? (
            <span className="badge">{selected.size} selected</span>
          ) : (
            <span className="text-muted">No sessions selected</span>
          )}
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="empty-state">
          <p>No sessions match your filter.</p>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="sessions-table">
            <thead>
              <tr>
                <th className="checkbox-col">
                  <input
                    type="checkbox"
                    checked={selected.size === sorted.length && sorted.length > 0}
                    ref={(el) => {
                      if (el) {
                        el.indeterminate = selected.size > 0 && selected.size < sorted.length;
                      }
                    }}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    className="checkbox"
                  />
                </th>
                <th className="name-col">Name</th>
                <th className="date-col">Timestamp</th>
                <th className="messages-col">Messages</th>
                <th className="models-col">Model(s)</th>
                <th className="tokens-col">Input Tokens</th>
                <th className="cost-col" title="Estimated cost to send this conversation to the analysis LLM (~$3/1M input tokens)">Est. Analysis Cost</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((session) => (
                <tr
                  key={session.id}
                  className={`session-row ${selected.has(session.id) ? "selected" : ""} ${
                    previewId === session.id ? "previewing" : ""
                  }`}
                  onClick={() => onPreview?.(session.id)}
                >
                  <td className="checkbox-col" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(session.id)}
                      onChange={(e) => handleSelectSession(session.id, e.target.checked)}
                      className="checkbox"
                    />
                  </td>
                  <td className="name-col">
                    <span className="session-name" title={session.displayName}>
                      {session.displayName}
                    </span>
                  </td>
                  <td className="date-col">{formatDate(session.timestamp)}</td>
                  <td className="messages-col">{session.messageCount}</td>
                  <td className="models-col">
                    <code className="model-tag">{formatModels(session.models)}</code>
                  </td>
                  <td className="tokens-col">{effectiveTokens(session).toLocaleString()}</td>
                  <td className="cost-col">{formatCost(effectiveCost(session))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="list-summary">
        <div className="stats">
          <div className="stat">
            <strong>Total Sessions:</strong> {sessions.length}
          </div>
          <div className="stat">
            <strong>Selected:</strong> {selected.size}
          </div>
          {selected.size > 0 && (
            <>
              <div className="stat">
                <strong>Combined Messages:</strong>{" "}
                {Array.from(selected)
                  .map((id) => sessions.find((s) => s.id === id)?.messageCount || 0)
                  .reduce((a, b) => a + b, 0)}
              </div>
              <div className="stat">
                <strong>Est. Analysis Cost:</strong>{" "}
                {formatCost(
                  Array.from(selected)
                    .map((id) => {
                      const s = sessions.find((x) => x.id === id);
                      return s ? effectiveCost(s) : 0;
                    })
                    .reduce((a, b) => a + b, 0)
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="privacy-banner">
        <h4>⚠️ Privacy Notice</h4>
        <p>
          Selected sessions will be analyzed by the LLM to extract lessons. Ensure you trust your
          configured model provider with this conversation data.
        </p>
      </div>
    </div>
  );
}
