/**
 * PreviewStep - Step 2: Browse sessions, select batch, and preview transcripts
 */

import { useState, useEffect } from "react";
import type { SessionSummary, ParsedSession, AgentType } from "../../shared/types.js";
import { loadSession } from "../api/client.js";
import { SessionList } from "./SessionList.js";
import { TranscriptRenderer } from "./TranscriptRenderer.js";
import "./PreviewStep.css";

interface PreviewStepProps {
  projectDir: string;
  agent: AgentType;
  sessions: SessionSummary[];
  onSelectChange: (selected: Set<string>) => void;
  excludeThinking?: boolean;
  onExcludeThinkingChange?: (value: boolean) => void;
}

export function PreviewStep({
  projectDir,
  agent,
  sessions,
  onSelectChange,
  excludeThinking,
  onExcludeThinkingChange,
}: PreviewStepProps) {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [previewSession, setPreviewSession] = useState<ParsedSession | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Load and preview a session when selected
  useEffect(() => {
    if (!selectedSessionId) {
      setPreviewSession(null);
      setPreviewError(null);
      return;
    }

    setIsLoadingPreview(true);
    setPreviewError(null);

    // Call API to get the full parsed session (dir is required by the backend)
    loadSession(selectedSessionId, projectDir, agent)
      .then((session) => {
        setPreviewSession(session);
        setIsLoadingPreview(false);
      })
      .catch((err) => {
        setPreviewError(err instanceof Error ? err.message : "Unknown error");
        setIsLoadingPreview(false);
      });
  }, [selectedSessionId, projectDir, agent]);

  return (
    <div className="preview-step">
      <div className="preview-split">
        <div className="preview-left">
          <SessionList
            sessions={sessions}
            onSelectChange={onSelectChange}
            excludeThinking={excludeThinking}
            onExcludeThinkingChange={onExcludeThinkingChange}
            onPreview={setSelectedSessionId}
            previewId={selectedSessionId}
          />
        </div>

        <div className="preview-right">
          {!selectedSessionId && (
            <div className="preview-placeholder">
              <p>👈 Click a session to preview its transcript</p>
            </div>
          )}

          {isLoadingPreview && (
            <div className="preview-loading">
              <div className="spinner"></div>
              <p>Loading transcript...</p>
            </div>
          )}

          {previewError && (
            <div className="preview-error">
              <h3>Error Loading Preview</h3>
              <p>{previewError}</p>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setSelectedSessionId(null);
                  setPreviewError(null);
                }}
              >
                Try Again
              </button>
            </div>
          )}

          {previewSession && !isLoadingPreview && (
            <div className="preview-content">
              <TranscriptRenderer
                session={previewSession}
                hideThinking={excludeThinking}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
