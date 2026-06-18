/**
 * Tests for server/agentsWriter.ts
 * Covers FR-15, FR-20, FR-21 functionality
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  readAgentsMd,
  saveAgentsMdAtomic,
  createBackup,
  validateProjectPath,
  getAgentsMdPath,
  getBackupsDirPath,
  listBackups,
  restoreFromBackup,
} from "./agentsWriter.ts";

// Create a temporary directory for testing
function createTestDir(): string {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentsWriter-test-"));
  return testDir;
}

// Clean up test directory
function cleanupTestDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("agentsWriter", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    cleanupTestDir(testDir);
  });

  describe("readAgentsMd (FR-15)", () => {
    it("should return empty content and undefined mtime when file doesn't exist", () => {
      const result = readAgentsMd(testDir);
      expect(result.content).toBe("");
      expect(result.mtime).toBeUndefined();
    });

    it("should read existing AGENTS.md with correct content", () => {
      const agentsMdPath = getAgentsMdPath(testDir);
      const testContent = "# My Project Agents\nBuild: use TypeScript";
      fs.writeFileSync(agentsMdPath, testContent, "utf-8");

      const result = readAgentsMd(testDir);
      expect(result.content).toBe(testContent);
      expect(typeof result.mtime).toBe("number");
      expect(result.mtime).toBeGreaterThan(0);
    });
  });

  describe("createBackup (FR-20)", () => {
    it("should return null when AGENTS.md doesn't exist", () => {
      const result = createBackup(testDir);
      expect(result).toBeNull();
    });

    it("should create timestamped backup when AGENTS.md exists", () => {
      const agentsMdPath = getAgentsMdPath(testDir);
      const testContent = "# Backup Test";
      fs.writeFileSync(agentsMdPath, testContent, "utf-8");

      const backupPath = createBackup(testDir);

      expect(backupPath).not.toBeNull();
      expect(fs.existsSync(backupPath!)).toBe(true);
      expect(fs.readFileSync(backupPath!, "utf-8")).toBe(testContent);

      // Check filename format: AGENTS.md.<ISO-timestamp>.bak
      const filename = path.basename(backupPath!);
      expect(filename).toMatch(/^AGENTS\.md\.\d{4}-\d{2}-\d{2}T/);
      expect(filename).toMatch(/\.bak$/);
    });

    it("should never overwrite prior backups", () => {
      const agentsMdPath = getAgentsMdPath(testDir);
      fs.writeFileSync(agentsMdPath, "v1", "utf-8");

      const backup1 = createBackup(testDir);
      const backup1Content = fs.readFileSync(backup1!, "utf-8");

      // Update and backup again
      fs.writeFileSync(agentsMdPath, "v2", "utf-8");
      const backup2 = createBackup(testDir);

      // Both backups should exist
      expect(fs.existsSync(backup1!)).toBe(true);
      expect(fs.existsSync(backup2!)).toBe(true);

      // First backup should still have original content
      expect(fs.readFileSync(backup1!, "utf-8")).toBe(backup1Content);

      // Second backup should have updated content
      expect(fs.readFileSync(backup2!, "utf-8")).toBe("v2");
    });

    it("should create .agents_backups directory if needed", () => {
      const agentsMdPath = getAgentsMdPath(testDir);
      fs.writeFileSync(agentsMdPath, "content", "utf-8");

      const backupDir = getBackupsDirPath(testDir);
      expect(fs.existsSync(backupDir)).toBe(false);

      createBackup(testDir);

      expect(fs.existsSync(backupDir)).toBe(true);
      expect(fs.statSync(backupDir).isDirectory()).toBe(true);
    });
  });

  describe("saveAgentsMdAtomic (FR-21, FR-20)", () => {
    it("should save new AGENTS.md when file doesn't exist", () => {
      const newContent = "# New Agents";
      const result = saveAgentsMdAtomic(testDir, newContent);

      expect(result.success).toBe(true);
      expect(result.mtime).toBeGreaterThan(0);
      expect(result.backupPath).toBeNull(); // No prior file to backup

      const agentsMdPath = getAgentsMdPath(testDir);
      expect(fs.readFileSync(agentsMdPath, "utf-8")).toBe(newContent);
    });

    it("should create backup before overwriting existing file", () => {
      const agentsMdPath = getAgentsMdPath(testDir);
      const originalContent = "# Original";
      fs.writeFileSync(agentsMdPath, originalContent, "utf-8");

      const newContent = "# Updated";
      const result = saveAgentsMdAtomic(testDir, newContent);

      expect(result.success).toBe(true);
      expect(result.backupPath).not.toBeNull();
      expect(fs.existsSync(result.backupPath!)).toBe(true);

      // Check backup has original content
      expect(fs.readFileSync(result.backupPath!, "utf-8")).toBe(originalContent);

      // Check AGENTS.md has new content
      expect(fs.readFileSync(agentsMdPath, "utf-8")).toBe(newContent);
    });

    it("should be atomic (use write-temp + rename)", () => {
      const newContent = "# Atomic Test";

      const result = saveAgentsMdAtomic(testDir, newContent);

      const endFiles = fs.readdirSync(testDir);

      // Should not have any leftover temp files
      const tempFiles = endFiles.filter((f) => f.includes(".tmp."));
      expect(tempFiles).toHaveLength(0);

      // Save should succeed
      expect(result.success).toBe(true);

      // AGENTS.md should have the new content
      const agentsMdPath = getAgentsMdPath(testDir);
      expect(fs.readFileSync(agentsMdPath, "utf-8")).toBe(newContent);
    });

    it("should detect mtime conflicts (external concurrent edits)", () => {
      const agentsMdPath = getAgentsMdPath(testDir);
      const v1 = "# Version 1";
      fs.writeFileSync(agentsMdPath, v1, "utf-8");

      // Get initial mtime
      const stats1 = fs.statSync(agentsMdPath);
      const originalMtime = stats1.mtimeMs;

      // Simulate external edit
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          fs.writeFileSync(agentsMdPath, "# External Edit", "utf-8");

          // Try to save with old mtime
          const result = saveAgentsMdAtomic(testDir, "# My Edit", originalMtime);

          expect(result.success).toBe(false);
          expect(result.error).toContain("Conflict");
          expect(result.mtime).toBeGreaterThan(originalMtime);

          // File should still have external edit
          expect(fs.readFileSync(agentsMdPath, "utf-8")).toBe("# External Edit");

          resolve();
        }, 100);
      });
    });

    it("should not create backup on mtime conflict", () => {
      const agentsMdPath = getAgentsMdPath(testDir);
      const v1 = "# Version 1";
      fs.writeFileSync(agentsMdPath, v1, "utf-8");

      const stats1 = fs.statSync(agentsMdPath);
      const originalMtime = stats1.mtimeMs;

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          // External edit
          fs.writeFileSync(agentsMdPath, "# External", "utf-8");

          // Try to save with old mtime
          const result = saveAgentsMdAtomic(testDir, "# My Edit", originalMtime);

          expect(result.success).toBe(false);
          expect(result.backupPath).toBeNull();

          const backupDir = getBackupsDirPath(testDir);
          const backupExists = fs.existsSync(backupDir);
          expect(backupExists).toBe(false);

          resolve();
        }, 100);
      });
    });
  });

  describe("listBackups", () => {
    it("should return empty array when no backups exist", () => {
      const result = listBackups(testDir);
      expect(result).toEqual([]);
    });

    it("should list all backup files sorted by timestamp descending", () => {
      const agentsMdPath = getAgentsMdPath(testDir);

      // Create multiple backups
      fs.writeFileSync(agentsMdPath, "v1", "utf-8");
      const backup1 = createBackup(testDir)!;

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          fs.writeFileSync(agentsMdPath, "v2", "utf-8");
          const backup2 = createBackup(testDir)!;

          const result = listBackups(testDir);
          expect(result).toHaveLength(2);

          // Should be sorted by timestamp descending (newest first)
          expect(result[0].filename).toBe(path.basename(backup2));
          expect(result[1].filename).toBe(path.basename(backup1));

          resolve();
        }, 100);
      });
    });
  });

  describe("restoreFromBackup", () => {
    it("should restore a backup file", () => {
      const agentsMdPath = getAgentsMdPath(testDir);

      // Create initial version
      fs.writeFileSync(agentsMdPath, "Original Content", "utf-8");
      const backup = createBackup(testDir)!;

      // Update file
      fs.writeFileSync(agentsMdPath, "Updated Content", "utf-8");

      // Restore from backup
      const result = restoreFromBackup(testDir, path.basename(backup));

      expect(result.success).toBe(true);
      expect(result.mtime).toBeGreaterThan(0);

      // File should have original content
      expect(fs.readFileSync(agentsMdPath, "utf-8")).toBe("Original Content");
    });

    it("should return error for non-existent backup", () => {
      const result = restoreFromBackup(testDir, "nonexistent.bak");

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("Integration: Full workflow", () => {
    it("should handle a complete save/backup/restore workflow", () => {
      // Start with no file
      let result = readAgentsMd(testDir);
      expect(result.content).toBe("");

      // Save initial version
      let saveResult = saveAgentsMdAtomic(testDir, "# Build\nUse TypeScript");
      expect(saveResult.success).toBe(true);
      const mtime1 = saveResult.mtime;

      // Verify content
      result = readAgentsMd(testDir);
      expect(result.content).toContain("TypeScript");
      expect(result.mtime).toBe(mtime1);

      // Update with expected mtime
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          saveResult = saveAgentsMdAtomic(
            testDir,
            "# Build\nUse TypeScript\n\n# Test\nUse Vitest",
            mtime1
          );
          expect(saveResult.success).toBe(true);
          expect(saveResult.backupPath).not.toBeNull();

          const mtime2 = saveResult.mtime!;
          expect(mtime2).toBeGreaterThan(mtime1);

          // Verify both versions exist
          result = readAgentsMd(testDir);
          expect(result.content).toContain("Vitest");

          const backupContent = fs.readFileSync(saveResult.backupPath!, "utf-8");
          expect(backupContent).toContain("TypeScript");
          expect(backupContent).not.toContain("Vitest");

          // List backups
          const backups = listBackups(testDir);
          expect(backups).toHaveLength(1);

          resolve();
        }, 100);
      });
    });
  });
});
