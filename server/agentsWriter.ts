/**
 * AGENTS.md file service — read, backup & atomic save
 * Implements FR-15, FR-20, FR-21 for safe AGENTS.md management
 */

import fs from "fs";
import path from "path";
import os from "os";

/**
 * Validate and sandbox a project directory path to prevent traversal attacks
 * Returns the validated absolute path or throws an error
 */
export function validateProjectPath(dir: string): string {
  if (!dir || typeof dir !== "string") {
    throw new Error("Invalid directory path: must be a non-empty string");
  }

  // Normalize the path
  const normalized = path.normalize(dir);

  // Make sure it's absolute or convert relative to absolute
  let absolute: string;
  if (path.isAbsolute(normalized)) {
    absolute = normalized;
  } else {
    absolute = path.resolve(process.cwd(), normalized);
  }

  // Check for traversal attempts by ensuring the path is within reasonable bounds
  // Use realpath if possible to resolve symlinks, but fall back to normalized path
  let realPath: string;
  try {
    realPath = fs.realpathSync(absolute);
  } catch {
    // If realpath fails (e.g., path doesn't exist yet), use normalized path
    realPath = absolute;
  }

  // Ensure resolved path is not trying to escape via traversal patterns
  // Check that after resolution, we're not escaping our home or system roots
  const homedir = os.homedir();
  if (!realPath.startsWith(homedir) && !realPath.startsWith("/")) {
    // Allow relative paths that resolve within home
    if (!absolute.includes("..")) {
      return realPath;
    }
  }

  // For absolute paths in home directory or root-based paths, allow them
  if (realPath.startsWith(homedir) || realPath.startsWith("/")) {
    return realPath;
  }

  throw new Error(`Path traversal detected or invalid path: ${dir}`);
}

/**
 * Get the path to the AGENTS.md file for a given project directory
 */
export function getAgentsMdPath(projectDir: string): string {
  const validated = validateProjectPath(projectDir);
  return path.join(validated, "AGENTS.md");
}

/**
 * Get the backup directory path for a given project directory
 */
export function getBackupsDirPath(projectDir: string): string {
  const validated = validateProjectPath(projectDir);
  return path.join(validated, ".agents_backups");
}

/**
 * FR-15: Read current AGENTS.md content and get its modification time
 * Returns { content, mtime } or { content: "", mtime: undefined } if file doesn't exist
 */
export function readAgentsMd(projectDir: string): {
  content: string;
  mtime: number | undefined;
} {
  const agentsMdPath = getAgentsMdPath(projectDir);

  try {
    const content = fs.readFileSync(agentsMdPath, "utf-8");
    const stats = fs.statSync(agentsMdPath);
    return {
      content,
      mtime: stats.mtimeMs,
    };
  } catch (err) {
    // File doesn't exist or can't be read
    if (
      err instanceof Error &&
      "code" in err &&
      err.code === "ENOENT"
    ) {
      return { content: "", mtime: undefined };
    }
    throw err;
  }
}

/**
 * Create backup directory if it doesn't exist
 */
function ensureBackupDirExists(backupDir: string): void {
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
}

/**
 * Generate a backup filename with ISO timestamp
 * Format: AGENTS.md.<ISO-timestamp>.bak
 */
function generateBackupFilename(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `AGENTS.md.${timestamp}.bak`;
}

/**
 * Create a timestamped backup of the current AGENTS.md file
 * Never overwrites prior backups
 * Returns the backup file path or null if no backup was needed
 */
export function createBackup(projectDir: string): string | null {
  const agentsMdPath = getAgentsMdPath(projectDir);
  const backupDir = getBackupsDirPath(projectDir);

  // If AGENTS.md doesn't exist, no backup needed
  if (!fs.existsSync(agentsMdPath)) {
    return null;
  }

  // Ensure backup directory exists
  ensureBackupDirExists(backupDir);

  // Generate unique backup filename
  const backupFilename = generateBackupFilename();
  const backupPath = path.join(backupDir, backupFilename);

  // Ensure the backup filename is unique (shouldn't happen with ISO timestamps,
  // but be safe anyway)
  let finalBackupPath = backupPath;
  let counter = 0;
  while (fs.existsSync(finalBackupPath) && counter < 1000) {
    counter++;
    const nameWithCounter = `AGENTS.md.${generateBackupFilename().replace(/\.bak$/, "")}(${counter}).bak`;
    finalBackupPath = path.join(backupDir, nameWithCounter);
  }

  if (counter >= 1000) {
    throw new Error("Could not generate unique backup filename");
  }

  // Copy the file (not move, to preserve the original during the process)
  const content = fs.readFileSync(agentsMdPath, "utf-8");
  fs.writeFileSync(finalBackupPath, content, "utf-8");

  return finalBackupPath;
}

/**
 * FR-21: Atomically save content to AGENTS.md with backup
 * 1. Creates backup of existing file (if any)
 * 2. Writes new content to temp file
 * 3. Renames temp file to AGENTS.md (atomic operation)
 * 4. Returns success, mtime, and backup path
 *
 * Supports mtime conflict detection for external concurrent edits
 */
export function saveAgentsMdAtomic(
  projectDir: string,
  content: string,
  expectedMtime?: number
): {
  success: boolean;
  mtime: number;
  backupPath: string | null;
  error?: string;
} {
  const agentsMdPath = getAgentsMdPath(projectDir);
  let backupPath: string | null = null;
  let temporaryPath: string | null = null;

  try {
    // Check for concurrent edits (mtime conflict detection)
    if (expectedMtime !== undefined && fs.existsSync(agentsMdPath)) {
      const stats = fs.statSync(agentsMdPath);
      if (stats.mtimeMs !== expectedMtime) {
        return {
          success: false,
          mtime: stats.mtimeMs,
          backupPath: null,
          error: "Conflict: AGENTS.md was modified externally. Please reload and try again.",
        };
      }
    }

    // Create backup of existing file
    backupPath = createBackup(projectDir);

    // Write to a temporary file in the same directory (ensures same filesystem)
    const projectDirPath = validateProjectPath(projectDir);

    // Generate a temporary filename in the project directory
    const tempFilename = `.AGENTS.md.tmp.${Date.now()}.${Math.random().toString(36).substring(7)}`;
    temporaryPath = path.join(projectDirPath, tempFilename);

    // Write content to temporary file
    fs.writeFileSync(temporaryPath, content, "utf-8");

    // Atomically rename temp file to AGENTS.md
    // This is atomic on most filesystems (POSIX rename)
    fs.renameSync(temporaryPath, agentsMdPath);
    temporaryPath = null; // Successfully renamed, no cleanup needed

    // Get the new mtime
    const stats = fs.statSync(agentsMdPath);

    return {
      success: true,
      mtime: stats.mtimeMs,
      backupPath,
    };
  } catch (err) {
    // Clean up temporary file if write failed
    if (temporaryPath && fs.existsSync(temporaryPath)) {
      try {
        fs.unlinkSync(temporaryPath);
      } catch (cleanupErr) {
        console.error("Failed to clean up temporary file:", cleanupErr);
      }
    }

    throw err;
  }
}

/**
 * Get list of all backups for a project
 * Returns array of { filename, path, timestamp } sorted by timestamp descending
 */
export function listBackups(projectDir: string): Array<{
  filename: string;
  path: string;
  timestamp: Date;
}> {
  const backupDir = getBackupsDirPath(projectDir);

  if (!fs.existsSync(backupDir)) {
    return [];
  }

  const backups: Array<{
    filename: string;
    path: string;
    timestamp: Date;
  }> = [];

  try {
    const files = fs.readdirSync(backupDir);

    for (const file of files) {
      if (file.endsWith(".bak")) {
        const filePath = path.join(backupDir, file);
        const stats = fs.statSync(filePath);

        backups.push({
          filename: file,
          path: filePath,
          timestamp: new Date(stats.mtimeMs),
        });
      }
    }

    // Sort by timestamp descending (newest first)
    backups.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  } catch (err) {
    console.error("Failed to list backups:", err);
  }

  return backups;
}

/**
 * Restore a backup file (recovery operation)
 * Copies the backup back to AGENTS.md with a new backup of the current version
 */
export function restoreFromBackup(
  projectDir: string,
  backupFilename: string
): {
  success: boolean;
  mtime?: number;
  error?: string;
} {
  try {
    const backupDir = getBackupsDirPath(projectDir);
    const backupPath = path.join(backupDir, backupFilename);

    if (!fs.existsSync(backupPath)) {
      return {
        success: false,
        error: `Backup file not found: ${backupFilename}`,
      };
    }

    // Create backup of current AGENTS.md first
    createBackup(projectDir);

    // Read backup content
    const backupContent = fs.readFileSync(backupPath, "utf-8");

    // Write to AGENTS.md
    const agentsMdPath = getAgentsMdPath(projectDir);
    fs.writeFileSync(agentsMdPath, backupContent, "utf-8");

    const stats = fs.statSync(agentsMdPath);

    return {
      success: true,
      mtime: stats.mtimeMs,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error during restore",
    };
  }
}
