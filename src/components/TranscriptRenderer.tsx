/**
 * TranscriptRenderer - Renders a ParsedSession as a readable transcript with friction flags
 * Supports collapsible sections, virtualization for performance, and per-entry anchors
 */

import { useMemo, useRef, useEffect, useState } from "react";
import type { ParsedSession, RenderableEntry } from "../../shared/types.js";
import {
  UserMessageEntry,
  AssistantMessageEntry,
  ThinkingBlockEntry,
  ToolCallEntry,
  ToolResultEntry,
  BashExecutionEntry,
} from "./TranscriptEntries.js";
import "./TranscriptRenderer.css";

interface TranscriptRendererProps {
  session: ParsedSession;
  branchIndex?: number;
  onEntryAnchor?: (entryId: string) => void;
  /** Hide thinking entries (they are also excluded from LLM analysis upstream). */
  hideThinking?: boolean;
}

interface RenderedEntryWithFriction extends RenderableEntry {
  hasFriction: boolean;
}

/**
 * Main transcript renderer component
 */
export function TranscriptRenderer({
  session,
  branchIndex = 0,
  onEntryAnchor,
  hideThinking = false,
}: TranscriptRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleEntries, setVisibleEntries] = useState<Set<string> | "all">("all");
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());

  const branch = session.branches?.[branchIndex];

  // Compute friction for each entry
  const entriesWithFriction = useMemo<RenderedEntryWithFriction[]>(() => {
    if (!branch) return [];
    return branch.entries.map((entry) => {
      const hasFriction =
        entry.friction?.isError ||
        (entry.kind === "assistant" && entry.payload.stopReason === "error") ||
        (entry.kind === "bash" && entry.payload.exitCode !== 0);
      return { ...entry, hasFriction };
    });
  }, [branch]);

  // Apply view filters (e.g. hide thinking blocks)
  const displayedEntries = useMemo(
    () =>
      hideThinking
        ? entriesWithFriction.filter((e) => e.kind !== "thinking")
        : entriesWithFriction,
    [entriesWithFriction, hideThinking]
  );

  const thinkingCount = useMemo(
    () => entriesWithFriction.filter((e) => e.kind === "thinking").length,
    [entriesWithFriction]
  );
  // Simple intersection observer for virtualization
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const newVisible = new Set<string>(
          visibleEntries === "all" ? entriesWithFriction.map((e) => e.entryId) : visibleEntries
        );
        entries.forEach((entry) => {
          const entryId = entry.target.getAttribute("data-entry-id");
          if (entryId) {
            if (entry.isIntersecting) {
              newVisible.add(entryId);
            } else {
              newVisible.delete(entryId);
            }
          }
        });
        setVisibleEntries(newVisible);
      },
      { rootMargin: "200px" }
    );

    const entryElements = containerRef.current.querySelectorAll("[data-entry-id]");
    entryElements.forEach((el) => observer.observe(el));

    return () => {
      entryElements.forEach((el) => observer.unobserve(el));
      observer.disconnect();
    };
    // visibleEntries is intentionally read but excluded from deps: re-running
    // on every visibility change would recreate the observer each scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entriesWithFriction]);

  const toggleExpanded = (entryId: string) => {
    const newExpanded = new Set(expandedEntries);
    if (newExpanded.has(entryId)) {
      newExpanded.delete(entryId);
    } else {
      newExpanded.add(entryId);
    }
    setExpandedEntries(newExpanded);
  };

  const scrollToEntry = (entryId: string) => {
    const element = containerRef.current?.querySelector(`[data-entry-id="${entryId}"]`);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
      onEntryAnchor?.(entryId);
    }
  };

  const isVisible = (entryId: string) =>
    visibleEntries === "all" || (visibleEntries instanceof Set && visibleEntries.has(entryId));

  if (!branch) {
    return (
      <div className="transcript-renderer empty-state">
        <p>No transcript data available.</p>
      </div>
    );
  }

  if (entriesWithFriction.length === 0) {
    return (
      <div className="transcript-renderer empty-state">
        <h3>{branch.header.displayName}</h3>
        <p>This conversation has no entries to display.</p>
        {branch.metadata && Object.keys(branch.metadata).length > 0 && (
          <div className="metadata">
            <p className="metadata-label">Metadata:</p>
            <pre>{JSON.stringify(branch.metadata, null, 2)}</pre>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="transcript-renderer" ref={containerRef}>
      <div className="transcript-header">
        <h2>{branch.header.displayName}</h2>
        <div className="transcript-meta">
          <span className="timestamp">{new Date(branch.header.timestamp).toLocaleString()}</span>
          <span className="entry-count">{displayedEntries.length} entries</span>
          {hideThinking && thinkingCount > 0 && (
            <span className="thinking-hidden-note">{thinkingCount} thinking hidden</span>
          )}
          {branch.warnings.length > 0 && (
            <span className="warnings-badge" title={branch.warnings.join("\n")}>
              ⚠ {branch.warnings.length} warnings
            </span>
          )}
        </div>
      </div>

      <div className="entries-container">
        {displayedEntries.map((entry) => (
          <div
            key={entry.entryId}
            data-entry-id={entry.entryId}
            className={`entry-wrapper ${entry.kind} ${entry.hasFriction ? "friction" : ""}`}
            id={`entry-${entry.entryId}`}
          >
            <div className="entry-header">
              {entry.hasFriction && <span className="friction-badge" title="Friction detected">⚠</span>}
              <span className="entry-id-anchor" onClick={() => scrollToEntry(entry.entryId)}>
                #
              </span>
            </div>

            <div className="entry-content">
              {entry.kind === "user" && <UserMessageEntry entry={entry} visible={isVisible(entry.entryId)} />}
              {entry.kind === "assistant" && (
                <AssistantMessageEntry
                  entry={entry}
                  visible={isVisible(entry.entryId)}
                  isExpanded={expandedEntries.has(entry.entryId)}
                  onToggleExpand={() => toggleExpanded(entry.entryId)}
                />
              )}
              {entry.kind === "thinking" && (
                <ThinkingBlockEntry
                  entry={entry}
                  visible={isVisible(entry.entryId)}
                  isExpanded={expandedEntries.has(entry.entryId)}
                  onToggleExpand={() => toggleExpanded(entry.entryId)}
                />
              )}
              {entry.kind === "toolCall" && (
                <ToolCallEntry
                  entry={entry}
                  visible={isVisible(entry.entryId)}
                  isExpanded={expandedEntries.has(entry.entryId)}
                  onToggleExpand={() => toggleExpanded(entry.entryId)}
                />
              )}
              {entry.kind === "toolResult" && (
                <ToolResultEntry
                  entry={entry}
                  visible={isVisible(entry.entryId)}
                  isExpanded={expandedEntries.has(entry.entryId)}
                  onToggleExpand={() => toggleExpanded(entry.entryId)}
                />
              )}
              {entry.kind === "bash" && (
                <BashExecutionEntry
                  entry={entry}
                  visible={isVisible(entry.entryId)}
                  isExpanded={expandedEntries.has(entry.entryId)}
                  onToggleExpand={() => toggleExpanded(entry.entryId)}
                />
              )}
            </div>
          </div>
        ))}
      </div>

      {branch.warnings.length > 0 && (
        <div className="transcript-warnings">
          <h4>Parsing Warnings</h4>
          <ul>
            {branch.warnings.map((warning, idx) => (
              <li key={idx}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

