/**
 * BrowseDirectoryModal — Lightweight directory browser modal
 */

import { useState, useEffect } from "react";
import { browseDirectory } from "../api/client.js";
import type { BrowseDirectoryResponse } from "../../shared/api.js";

interface BrowseDirectoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
}

export function BrowseDirectoryModal({
  isOpen,
  onClose,
  onSelect,
  initialPath,
}: BrowseDirectoryModalProps) {
  const [currentPath, setCurrentPath] = useState<string>("");
  const [data, setData] = useState<BrowseDirectoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load initial directory when modal opens
  useEffect(() => {
    if (isOpen && !currentPath) {
      loadDirectory(initialPath);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialPath]);

  const loadDirectory = async (path?: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await browseDirectory(path);
      setData(result);
      setCurrentPath(result.path);
      if (result.error) {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load directory");
    } finally {
      setLoading(false);
    }
  };

  const handleNavigate = (path: string) => {
    loadDirectory(path);
  };

  const handleSelect = () => {
    if (currentPath) {
      onSelect(currentPath);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content browse-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Browse for Project Directory</h3>
          <button className="btn-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="modal-body">
          <div className="current-path">
            <strong>Current: </strong>
            <code>{currentPath || "Loading..."}</code>
          </div>

          {error && (
            <div className="alert alert-error" style={{ marginTop: "0.5rem" }}>
              {error}
            </div>
          )}

          {loading ? (
            <div className="loading-spinner">Loading...</div>
          ) : (
            <div className="directory-list">
              {data?.parent && (
                <button
                  className="directory-item parent-dir"
                  onClick={() => handleNavigate(data.parent!)}
                >
                  📁 .. (parent directory)
                </button>
              )}

              {data?.entries && data.entries.length > 0 ? (
                data.entries.map((entry) => (
                  <button
                    key={entry.path}
                    className="directory-item"
                    onClick={() => handleNavigate(entry.path)}
                  >
                    📁 {entry.name}
                  </button>
                ))
              ) : (
                !error && <div className="no-entries">No subdirectories found</div>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSelect}
            disabled={!currentPath || loading || !!error}
          >
            Use This Folder
          </button>
        </div>
      </div>
    </div>
  );
}
