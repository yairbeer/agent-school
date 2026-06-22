/**
 * ProjectPicker — Step 1: Select project directory
 */

import { useState, FormEvent } from "react";
import { SessionApiClient } from "../api/client.js";
import { BrowseDirectoryModal } from "./BrowseDirectoryModal.js";
import type { SessionSummary, AgentType } from "../../shared/types.js";

interface ProjectPickerProps {
  onProjectSelected: (dir: string, agent: AgentType, sessions: SessionSummary[]) => void;
  isLoading?: boolean;
}

export function ProjectPicker({ onProjectSelected, isLoading = false }: ProjectPickerProps) {
  const [dir, setDir] = useState("");
  const [agent, setAgent] = useState<AgentType>("pi");
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [showSessions, setShowSessions] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showBrowseModal, setShowBrowseModal] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSessions([]);
    setShowSessions(false);

    if (!dir.trim()) {
      setError("Please enter a project directory path");
      return;
    }

    setLoading(true);
    try {
      const { sessions: loadedSessions, error: apiError } = await SessionApiClient.listSessions(
        dir,
        agent
      );

      if (apiError) {
        setError(apiError);
        setSessions([]);
      } else if (loadedSessions.length === 0) {
        setError("No sessions found in this directory");
        setSessions([]);
      } else {
        setSessions(loadedSessions);
        setShowSessions(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = () => {
    if (sessions.length > 0) {
      onProjectSelected(dir, agent, sessions);
    }
  };

  const handleBrowseSelect = (selectedPath: string) => {
    setDir(selectedPath);
    setShowBrowseModal(false);
  };

  // Load the bundled demo sessions so the tool can be tried without any real
  // pi sessions on disk.
  const handleLoadDemo = async () => {
    setError(null);
    setShowSessions(false);
    setLoading(true);
    try {
      const { sessions: loadedSessions, error: apiError } =
        await SessionApiClient.listSessions("__demo__", "pi");
      if (apiError) {
        setError(apiError);
        setSessions([]);
      } else {
        setDir("__demo__");
        setAgent("pi");
        setSessions(loadedSessions);
        setShowSessions(true);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="project-picker">
      <h2>Pick Project</h2>
      <p className="instructions">
        Enter a project directory to discover agent sessions. Choose which coding agent produced
        them — pi or Claude Code — then search.
        {" "}
        <button
          type="button"
          className="demo-link"
          onClick={handleLoadDemo}
          disabled={loading || isLoading}
          title="Load bundled example sessions — no sessions of your own required"
        >
          Just exploring? Try the demo →
        </button>
      </p>

      <form onSubmit={handleSubmit} className="picker-form">
        <div className="form-group">
          <label htmlFor="agent-select">Coding Agent</label>
          <select
            id="agent-select"
            className="input"
            value={agent}
            onChange={(e) => setAgent(e.target.value as AgentType)}
            disabled={loading || isLoading}
          >
            <option value="pi">pi (~/.pi/agent/sessions)</option>
            <option value="claude-code">Claude Code (~/.claude/projects)</option>
          </select>
          <small className="hint">
            Determines where sessions are read from and whether the proposal targets AGENTS.md (pi)
            or CLAUDE.md (Claude Code).
          </small>
        </div>
        <div className="form-group">
          <label htmlFor="dir-input">Project Directory Path</label>
          <div className="input-with-button">
            <input
              id="dir-input"
              type="text"
              value={dir}
              onChange={(e) => setDir(e.target.value)}
              placeholder="e.g., /path/to/your/project or --path-to-your-project--"
              disabled={loading || isLoading}
              className="input"
            />
            <button
              type="button"
              className="btn btn-secondary browse-btn"
              onClick={() => setShowBrowseModal(true)}
              disabled={loading || isLoading}
            >
              Browse...
            </button>
          </div>
          <small className="hint">
            Supports both direct paths and pi-encoded paths (--path--encoding--)
          </small>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <button
          type="submit"
          className="btn btn-primary"
          disabled={!dir.trim() || loading || isLoading}
        >
          {loading ? "Searching..." : "Search for Sessions"}
        </button>
      </form>

      {showSessions && sessions.length > 0 && (
        <div className="sessions-preview">
          <h3>Found {sessions.length} Session(s)</h3>
          <div className="sessions-list">
            {sessions.slice(0, 5).map((session) => (
              <div key={session.id} className="session-item">
                <strong>{session.displayName}</strong>
                <small>{new Date(session.timestamp).toLocaleString()}</small>
              </div>
            ))}
            {sessions.length > 5 && <div className="more-sessions">+ {sessions.length - 5} more</div>}
          </div>

          <button
            type="button"
            className="btn btn-primary"
            onClick={handleConfirm}
            disabled={isLoading}
          >
            Continue with these sessions →
          </button>
        </div>
      )}

      <div className="privacy-banner">
        <h4>⚠️ Privacy Notice</h4>
        <p>
          Sessions may contain sensitive information (API keys, credentials, URLs). This information
          will be sent to the LLM for analysis. Ensure you trust your configured model provider.
        </p>
      </div>

      <BrowseDirectoryModal
        isOpen={showBrowseModal}
        onClose={() => setShowBrowseModal(false)}
        onSelect={handleBrowseSelect}
        initialPath={dir}
      />
    </div>
  );
}
