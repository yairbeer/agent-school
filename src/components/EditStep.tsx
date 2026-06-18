/**
 * Edit & Save step (Step 6) - Monaco diff editor with save flow
 * FR-18..FR-21: Side-by-side diff, editable right pane, save with backup & conflict handling
 */

import { useEffect, useRef, useState } from "react";
import type { editor } from "monaco-editor";
import { DiffEditor, type Monaco } from "@monaco-editor/react";
import { getAgents, saveAgents, aggregateSessions, proposeAgents } from "../api/client.js";
import type { ConversationReview } from "../../shared/types.js";

// IntelliJ "Darcula" palette for the Monaco diff editor.
function defineDarcula(monaco: Monaco) {
  monaco.editor.defineTheme("darcula", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "", foreground: "a9b7c6", background: "2b2b2b" },
      { token: "comment", foreground: "808080", fontStyle: "italic" },
      { token: "keyword", foreground: "cc7832" },
      { token: "string", foreground: "6a8759" },
      { token: "number", foreground: "6897bb" },
      { token: "type", foreground: "ffc66d" },
    ],
    colors: {
      "editor.background": "#2b2b2b",
      "editor.foreground": "#a9b7c6",
      "editorLineNumber.foreground": "#606366",
      "editor.selectionBackground": "#214283",
      "editor.lineHighlightBackground": "#323232",
      "editorCursor.foreground": "#a9b7c6",
      "editorGutter.background": "#313335",
      "diffEditor.insertedTextBackground": "#34433366",
      "diffEditor.removedTextBackground": "#43333366",
    },
  });
}

interface EditStepProps {
  projectDir: string;
  reviews: ConversationReview[];
}

interface SaveResult {
  success: boolean;
  backupPath?: string;
  error?: string;
}

interface ConflictWarning {
  message: string;
  currentMtime?: number;
  proposedMtime?: number;
}

export function EditStep({ projectDir, reviews }: EditStepProps) {
  const [currentContent, setCurrentContent] = useState<string>("");
  const [editedContent, setEditedContent] = useState<string>("");
  const [currentMtime, setCurrentMtime] = useState<number | null>(null);
  const [promptUsed, setPromptUsed] = useState<{ system: string; user: string } | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<string>("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<SaveResult | null>(null);
  const [conflictWarning, setConflictWarning] = useState<ConflictWarning | null>(null);
  const diffEditorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  // Guard so the (expensive) generate runs exactly once, even under React
  // StrictMode which double-invokes effects in dev.
  const startedRef = useRef(false);
  const mountedRef = useRef(true);

  // On mount: aggregate the reviews, load the current AGENTS.md, and generate
  // the proposed AGENTS.md, then show it in the diff editor.
  useEffect(() => {
    mountedRef.current = true;
    const generate = async () => {
      try {
        setIsLoading(true);
        setLoadError(null);

        setLoadingStage("Loading current AGENTS.md...");
        const agentsResponse = await getAgents(projectDir);
        const content = agentsResponse.content || "";
        const mtime = agentsResponse.mtime || null;

        setLoadingStage("Collecting findings from reviews...");
        const aggregateResponse = await aggregateSessions(reviews);

        setLoadingStage("Generating proposed AGENTS.md... (this can take 1-2 minutes)");
        const proposeResponse = await proposeAgents(
          aggregateResponse.aggregated,
          content
        );
        const proposed = proposeResponse.proposal.after;

        if (!mountedRef.current) return;
        setCurrentContent(content);
        setCurrentMtime(mtime);
        setEditedContent(proposed);
        setPromptUsed(proposeResponse.proposal.prompt ?? null);
      } catch (err) {
        if (!mountedRef.current) return;
        const message = err instanceof Error ? err.message : "Unknown error";
        setLoadError(`Failed to generate proposal: ${message}`);
      } finally {
        if (mountedRef.current) setIsLoading(false);
      }
    };

    if (!startedRef.current) {
      startedRef.current = true;
      generate();
    }
    return () => {
      mountedRef.current = false;
    };
  }, [projectDir, reviews]);

  const handleSave = async () => {
    if (!editedContent.trim()) {
      setSaveResult({
        success: false,
        error: "Cannot save empty AGENTS.md",
      });
      return;
    }

    try {
      setIsSaving(true);
      setSaveResult(null);
      setConflictWarning(null);

      const response = await saveAgents(projectDir, editedContent, currentMtime || undefined);

      if (response.success) {
        setSaveResult({
          success: true,
          backupPath: response.backupPath,
        });
        // Update the current content to reflect what was saved
        setCurrentContent(editedContent);
        setCurrentMtime(response.mtime || null);
      } else {
        // Check for mtime conflict
        if (response.error && response.error.includes("conflict")) {
          setConflictWarning({
            message: response.error,
            currentMtime: response.mtime,
            proposedMtime: currentMtime || undefined,
          });
          // Don't set save result when showing conflict warning
        } else {
          setSaveResult({
            success: false,
            error: response.error || "Failed to save AGENTS.md",
          });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setSaveResult({
        success: false,
        error: `Save failed: ${message}`,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleReconcile = async () => {
    // Reload the current AGENTS.md to reconcile
    try {
      setIsLoading(true);
      const response = await getAgents(projectDir);
      const content = response.content || "";
      const mtime = response.mtime || null;

      setCurrentContent(content);
      setCurrentMtime(mtime);
      setConflictWarning(null);
      // Set the edited content to the newly loaded content for reconciliation
      setEditedContent(content);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setLoadError(`Failed to reconcile: ${message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEditorMount = (editor: editor.IStandaloneDiffEditor) => {
    diffEditorRef.current = editor;
    // Capture edits made to the (editable) modified/right pane.
    const modified = editor.getModifiedEditor();
    modified.onDidChangeModelContent(() => {
      setEditedContent(modified.getValue());
    });
  };

  if (isLoading) {
    return (
      <div className="edit-step">
        <div className="loading">
          <p>{loadingStage || "Loading..."}</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="edit-step">
        <div className="error-box">
          <h3>Error Loading AGENTS.md</h3>
          <p>{loadError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="edit-step">
      <div className="edit-header">
        <div className="edit-header-text">
          <h2>Propose &amp; Save AGENTS.md</h2>
          <p>
            A proposed AGENTS.md was generated from your reviews. The left side shows the current
            AGENTS.md (read-only); the right side is your editable proposal. Make any changes before
            saving.
          </p>
        </div>
        <div className="edit-header-actions">
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={isSaving || !editedContent.trim()}
          >
            {isSaving ? "Saving..." : "Save AGENTS.md"}
          </button>
          <p className="save-info">
            {currentContent
              ? "A backup of the current AGENTS.md is created before saving."
              : "This will create a new AGENTS.md for the first time."}
          </p>
        </div>
      </div>

      {promptUsed && (
        <div className="prompt-review">
          <button
            type="button"
            className="prompt-toggle"
            onClick={() => setShowPrompt((v) => !v)}
            aria-expanded={showPrompt}
          >
            {showPrompt ? "▼" : "▶"} Review the prompt sent to the model
          </button>
          {showPrompt && (
            <div className="prompt-content">
              <h4>System prompt</h4>
              <pre className="prompt-block">{promptUsed.system}</pre>
              <h4>User message</h4>
              <pre className="prompt-block">{promptUsed.user}</pre>
            </div>
          )}
        </div>
      )}

      <div className="diff-container">
        <DiffEditor
          height="100%"
          language="markdown"
          original={currentContent}
          modified={editedContent}
          beforeMount={defineDarcula}
          onMount={handleEditorMount}
          theme="darcula"
          options={{
            originalEditable: false,
            readOnly: false,
            renderSideBySide: true,
            wordWrap: "on",
            minimap: { enabled: false },
          }}
        />
      </div>

      {saveResult && (
        <div className={`result-box ${saveResult.success ? "success" : "error"}`}>
          {saveResult.success ? (
            <>
              <h3>✓ Save Successful</h3>
              <p>AGENTS.md has been saved successfully.</p>
              {saveResult.backupPath && (
                <p className="backup-info">
                  Backup created at: <code>{saveResult.backupPath}</code>
                </p>
              )}
            </>
          ) : (
            <>
              <h3>✗ Save Failed</h3>
              <p>{saveResult.error}</p>
            </>
          )}
        </div>
      )}

      {conflictWarning && (
        <div className="conflict-box">
          <h3>⚠ Conflict Warning</h3>
          <p>
            The AGENTS.md file has been modified since you started editing. This is likely because
            another process or session modified it.
          </p>
          <p className="conflict-details">{conflictWarning.message}</p>
          <p>You have two options:</p>
          <ul>
            <li>
              <strong>Reconcile:</strong> Reload the latest version and start editing again
            </li>
            <li>
              <strong>Force Save:</strong> Overwrite with your changes (may lose external
              modifications)
            </li>
          </ul>
          <div className="conflict-actions">
            <button
              className="btn btn-primary"
              onClick={handleReconcile}
              disabled={isLoading}
            >
              Reconcile & Reload
            </button>
            <button
              className="btn btn-secondary"
              onClick={async () => {
                setConflictWarning(null);
                // Force save by clearing expectedMtime
                await handleSave();
              }}
              disabled={isSaving}
            >
              Force Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
