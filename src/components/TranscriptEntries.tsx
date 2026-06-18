/**
 * Individual entry component renderers for TranscriptRenderer
 */

import type { RenderableEntry } from "../../shared/types.js";
import "./TranscriptEntries.css";

interface EntryProps {
  entry: RenderableEntry;
  visible: boolean;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

/**
 * Extract displayable plain text from a pi payload value.
 * Handles raw strings and content-block arrays ([{type:'text',text},
 * {type:'thinking',thinking}, {type:'tool_use',...}]) so we never try to
 * render an object as a React child (which crashes the app).
 */
function extractText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((block) => {
        if (typeof block === "string") return block;
        if (block && typeof block === "object") {
          const b = block as Record<string, unknown>;
          if (typeof b.text === "string") return b.text;
          if (typeof b.thinking === "string") return b.thinking;
          if (b.type === "tool_use" || b.type === "toolUse") {
            const name = (b.name as string) ?? "tool";
            return `🔧 ${name}(${JSON.stringify(b.input ?? {})})`;
          }
          return "";
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (typeof value === "object") {
    const b = value as Record<string, unknown>;
    if (typeof b.text === "string") return b.text;
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

/**
 * User message entry
 */
export function UserMessageEntry({ entry, visible = true }: EntryProps) {
  if (visible === false) {
    return <div className="entry-user placeholder" />;
  }

  const text = extractText(entry.payload.text ?? entry.payload.content);

  return (
    <div className="entry-user">
      <div className="role-label">👤 User</div>
      <div className="message-content">
        <p>{text}</p>
      </div>
    </div>
  );
}

/**
 * Assistant message entry
 */
export function AssistantMessageEntry({ entry, visible = true, isExpanded, onToggleExpand }: EntryProps) {
  if (visible === false) {
    return <div className="entry-assistant placeholder" />;
  }

  const text = extractText(entry.payload.text ?? entry.payload.content);
  const stopReason = entry.payload.stopReason as string | undefined;
  const isError = stopReason === "error";

  const isLong = text.length > 500;
  const displayText = !isExpanded && isLong ? text.slice(0, 500) + "..." : text;

  return (
    <div className={`entry-assistant ${isError ? "error" : ""}`}>
      <div className="role-label">
        🤖 Assistant
        {stopReason && <span className={`stop-reason ${isError ? "error" : ""}`}>{stopReason}</span>}
      </div>
      <div className="message-content">
        <p>{displayText}</p>
        {isLong && (
          <button className="expand-btn" onClick={onToggleExpand}>
            {isExpanded ? "▼ Show less" : "▶ Show more"}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Thinking block entry (collapsible)
 */
export function ThinkingBlockEntry({ entry, visible = true, isExpanded, onToggleExpand }: EntryProps) {
  if (visible === false) {
    return <div className="entry-thinking placeholder" />;
  }

  const text =
    (entry.payload.thinking as string) ||
    extractText(entry.payload.text ?? entry.payload.content);
  const isLong = text.length > 300;
  const displayText = !isExpanded && isLong ? text.slice(0, 300) + "..." : text;

  return (
    <div className="entry-thinking">
      <button className="thinking-toggle" onClick={onToggleExpand}>
        <span className="toggle-icon">{isExpanded ? "▼" : "▶"}</span>
        <span className="thinking-label">💭 Thinking</span>
      </button>
      {isExpanded && (
        <div className="thinking-content">
          <p>{displayText}</p>
          {isLong && (
            <button className="expand-btn" onClick={onToggleExpand}>
              ▲ Collapse
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Tool call entry
 */
export function ToolCallEntry({ entry, visible = true, isExpanded, onToggleExpand }: EntryProps) {
  if (visible === false) {
    return <div className="entry-tool-call placeholder" />;
  }

  const toolName = (entry.payload.toolName ||
    entry.payload.customType) as string | undefined;
  const rawInput =
    entry.payload.toolInput ?? entry.payload.content ?? {};
  const inputJson =
    typeof rawInput === "string"
      ? rawInput
      : JSON.stringify(rawInput, null, 2);
  const isLong = inputJson.length > 400;
  const displayJson = !isExpanded && isLong ? inputJson.slice(0, 400) + "..." : inputJson;

  return (
    <div className="entry-tool-call">
      <div className="role-label">🔧 Tool Call: {toolName}</div>
      <div className="tool-content">
        <pre className="tool-args">{displayJson}</pre>
        {isLong && (
          <button className="expand-btn" onClick={onToggleExpand}>
            {isExpanded ? "▼ Show less" : "▶ Show full args"}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Tool result entry (truncated with expand option, handles fullOutputPath)
 */
export function ToolResultEntry({ entry, visible = true, isExpanded, onToggleExpand }: EntryProps) {
  if (visible === false) {
    return <div className="entry-tool-result placeholder" />;
  }

  const output =
    extractText(entry.payload.content) ||
    ((entry.payload.output as string) || "");
  const fullOutputPath = entry.payload.fullOutputPath as string | undefined;
  const isError =
    (entry.payload.isError as boolean | undefined) ?? entry.friction?.isError;

  const maxLength = 400;
  const displayText = !isExpanded && output.length > maxLength ? output.slice(0, maxLength) + "..." : output;

  return (
    <div className={`entry-tool-result ${isError ? "error" : ""}`}>
      <div className="role-label">
        📤 Tool Result
        {isError && <span className="error-badge">ERROR</span>}
      </div>
      <div className="result-content">
        <pre className="result-text">{displayText}</pre>
        {fullOutputPath && <p className="full-path">Full output: {fullOutputPath}</p>}
        {output.length > maxLength && (
          <button className="expand-btn" onClick={onToggleExpand}>
            {isExpanded ? "▼ Show less" : "▶ Show full output"}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Bash execution entry
 */
export function BashExecutionEntry({ entry, visible = true, isExpanded, onToggleExpand }: EntryProps) {
  if (visible === false) {
    return <div className="entry-bash placeholder" />;
  }

  const command = entry.payload.command as string | undefined;
  const output = (entry.payload.output || "") as string;
  const exitCode = entry.payload.exitCode as number | undefined;
  const isError = exitCode !== 0;

  const maxLength = 400;
  const displayOutput = !isExpanded && output.length > maxLength ? output.slice(0, maxLength) + "..." : output;

  return (
    <div className={`entry-bash ${isError ? "error" : ""}`}>
      <div className="role-label">
        💻 Bash
        {exitCode !== undefined && (
          <span className={`exit-code ${isError ? "error" : "success"}`}>
            exit {exitCode}
          </span>
        )}
      </div>
      {command && <div className="bash-command">$ {command}</div>}
      <div className="bash-output">
        <pre>{displayOutput}</pre>
        {output.length > maxLength && (
          <button className="expand-btn" onClick={onToggleExpand}>
            {isExpanded ? "▼ Show less" : "▶ Show full output"}
          </button>
        )}
      </div>
    </div>
  );
}
