import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { ReviewEngine } from "./reviewEngine.js";

describe("ReviewEngine", () => {
  let testCacheDir: string;
  let engine: ReviewEngine;

  beforeEach(() => {
    testCacheDir = path.join(process.cwd(), ".test-review-cache");
    if (fs.existsSync(testCacheDir)) {
      fs.rmSync(testCacheDir, { recursive: true });
    }

    engine = new ReviewEngine({
      model: "gpt-5.5",
      provider: "openai",
      cacheDir: testCacheDir,
      temperature: 0.7,
      maxRetries: 1,
    });
  });

  afterEach(() => {
    if (fs.existsSync(testCacheDir)) {
      fs.rmSync(testCacheDir, { recursive: true });
    }
  });

  describe("Cache Management", () => {
    it("should create cache directory on initialization", () => {
      expect(fs.existsSync(testCacheDir)).toBe(true);
    });

    it("should save and retrieve cached reviews", () => {
      const mockReview = {
        sessionId: "test-session-1",
        summary: "Test summary",
        userFixes: [],
        selfCorrections: [],
        lessonsLearned: [],
        confidence: 0.8,
      };

      const hash = "test-hash-123";

      (engine as any).cacheReview(hash, mockReview);
      const cached = (engine as any).getCachedReview(hash);
      expect(cached).toEqual(mockReview);
    });

    it("should return null for non-existent cache entries", () => {
      const cached = (engine as any).getCachedReview("non-existent-hash");
      expect(cached).toBeNull();
    });

    it("should invalidate cache entries", () => {
      const mockReview = {
        sessionId: "test-session-2",
        summary: "Test summary",
        userFixes: [],
        selfCorrections: [],
        lessonsLearned: [],
        confidence: 0.8,
      };

      const hash = "test-hash-456";

      (engine as any).cacheReview(hash, mockReview);
      expect((engine as any).getCachedReview(hash)).not.toBeNull();

      engine.invalidateCache(hash);
      expect((engine as any).getCachedReview(hash)).toBeNull();
    });

    it("should persist cache index to disk", () => {
      const mockReview = {
        sessionId: "test-session-3",
        summary: "Test summary",
        userFixes: [],
        selfCorrections: [],
        lessonsLearned: [],
        confidence: 0.8,
      };

      const hash = "test-hash-789";

      (engine as any).cacheReview(hash, mockReview);

      const indexPath = path.join(testCacheDir, "index.json");
      expect(fs.existsSync(indexPath)).toBe(true);

      const index = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
      expect(index[hash]).toBeDefined();
      expect(index[hash].review.sessionId).toBe("test-session-3");
    });

    it("should get cache stats", () => {
      const mockReview = {
        sessionId: "test-session-4",
        summary: "Test summary",
        userFixes: [],
        selfCorrections: [],
        lessonsLearned: [],
        confidence: 0.8,
      };

      (engine as any).cacheReview("hash1", mockReview);
      (engine as any).cacheReview("hash2", mockReview);

      const stats = engine.getCacheStats();
      expect(stats.entries).toBe(2);
      expect(stats.totalBytes).toBeGreaterThan(0);
    });

    it("should clear entire cache", () => {
      const mockReview = {
        sessionId: "test-session-5",
        summary: "Test summary",
        userFixes: [],
        selfCorrections: [],
        lessonsLearned: [],
        confidence: 0.8,
      };

      (engine as any).cacheReview("hash1", mockReview);
      (engine as any).cacheReview("hash2", mockReview);

      let stats = engine.getCacheStats();
      expect(stats.entries).toBe(2);

      engine.clearCache();

      stats = engine.getCacheStats();
      expect(stats.entries).toBe(0);
    });
  });

  describe("Content Hashing", () => {
    it("should generate consistent hashes for same content", () => {
      const sessionId = "test-session";
      const content = "test content";

      const hash1 = (engine as any).generateContentHash(sessionId, content);
      const hash2 = (engine as any).generateContentHash(sessionId, content);

      expect(hash1).toBe(hash2);
    });

    it("should generate different hashes for different content", () => {
      const sessionId = "test-session";
      const content1 = "test content 1";
      const content2 = "test content 2";

      const hash1 = (engine as any).generateContentHash(sessionId, content1);
      const hash2 = (engine as any).generateContentHash(sessionId, content2);

      expect(hash1).not.toBe(hash2);
    });

    it("should include model and provider in hash", () => {
      const customCacheDir = path.join(process.cwd(), ".test-review-cache-2");
      const engine2 = new ReviewEngine({
        model: "claude-opus",
        provider: "anthropic",
        cacheDir: customCacheDir,
      });

      try {
        const sessionId = "test-session";
        const content = "test content";

        const hash1 = (engine as any).generateContentHash(sessionId, content);
        const hash2 = (engine2 as any).generateContentHash(sessionId, content);

        expect(hash1).not.toBe(hash2);
      } finally {
        if (fs.existsSync(customCacheDir)) {
          fs.rmSync(customCacheDir, { recursive: true });
        }
      }
    });
  });

  describe("Schema Validation", () => {
    it("should validate correct review schema", () => {
      const validReview = {
        sessionId: "test-1",
        summary: "Test",
        userFixes: [],
        selfCorrections: [],
        lessonsLearned: [],
        confidence: 0.5,
      };

      const isValid = (engine as any).validateReview(validReview);
      expect(isValid).toBe(true);
    });

    it("should reject invalid review schema - missing sessionId", () => {
      const invalidReview = {
        summary: "Test",
        userFixes: [],
        selfCorrections: [],
        lessonsLearned: [],
        confidence: 0.5,
      };

      const isValid = (engine as any).validateReview(invalidReview);
      expect(isValid).toBe(false);
    });

    it("should reject invalid review schema - missing arrays", () => {
      const invalidReview = {
        sessionId: "test-1",
        summary: "Test",
        userFixes: [],
        selfCorrections: [],
        confidence: 0.5,
      };

      const isValid = (engine as any).validateReview(invalidReview);
      expect(isValid).toBe(false);
    });

    it("should reject invalid review schema - wrong types", () => {
      const invalidReview = {
        sessionId: "test-1",
        summary: "Test",
        userFixes: "not-an-array",
        selfCorrections: [],
        lessonsLearned: [],
        confidence: 0.5,
      };

      const isValid = (engine as any).validateReview(invalidReview);
      expect(isValid).toBe(false);
    });
  });

  describe("Conversation Chunking", () => {
    it("should chunk long conversations", () => {
      const entries = Array.from({ length: 100 }, (_, i) => ({
        entryId: `entry-${i}`,
        content: "x".repeat(100),
      }));

      const chunks = (engine as any).chunkConversation(entries, 500);
      expect(chunks.length).toBeGreaterThan(1);
    });

    it("should not chunk short conversations", () => {
      const entries = Array.from({ length: 5 }, (_, i) => ({
        entryId: `entry-${i}`,
        content: "short",
      }));

      const chunks = (engine as any).chunkConversation(entries, 500);
      expect(chunks.length).toBe(1);
    });

    it("should preserve entry IDs in chunks", () => {
      const entries = Array.from({ length: 50 }, (_, i) => ({
        entryId: `entry-${i}`,
        content: "x".repeat(100),
      }));

      const chunks = (engine as any).chunkConversation(entries, 500);
      const summary = (engine as any).summarizeChunks(chunks);

      expect(summary).toContain("entry-0");
      expect(summary).toContain("entry-49");
    });
  });

  describe("Provider Detection", () => {
    it("should detect OpenAI models", () => {
      const engine1 = new ReviewEngine({ model: "gpt-5.5" });
      expect((engine1 as any).config.provider).toBe("openai");

      const engine2 = new ReviewEngine({ model: "gpt-3.5-turbo" });
      expect((engine2 as any).config.provider).toBe("openai");
    });

    it("should detect Anthropic models", () => {
      const engine = new ReviewEngine({ model: "claude-opus" });
      expect((engine as any).config.provider).toBe("anthropic");
    });

    it("should detect Google models", () => {
      const engine = new ReviewEngine({ model: "gemini-pro" });
      expect((engine as any).config.provider).toBe("google");
    });

    it("should default to OpenAI for unknown models", () => {
      const engine = new ReviewEngine({ model: "unknown-model" });
      expect((engine as any).config.provider).toBe("openai");
    });
  });

  describe("Configuration", () => {
    it("should use default values for optional config", () => {
      const tempDir = path.join(process.cwd(), ".test-config-default");
      const engine = new ReviewEngine({
        model: "gpt-5.5",
        cacheDir: tempDir,
      });

      try {
        expect((engine as any).config.cacheDir).toBe(tempDir);
        expect((engine as any).config.lessonsFile).toBe("lessons.json");
        expect((engine as any).config.temperature).toBe(0.7);
        expect((engine as any).config.maxRetries).toBe(3);
      } finally {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true });
        }
      }
    });

    it("should accept custom configuration", () => {
      const customDir = path.join(process.cwd(), ".test-config-custom");
      const engine = new ReviewEngine({
        model: "gpt-5.5",
        cacheDir: customDir,
        lessonsFile: "custom-lessons.json",
        temperature: 0.5,
        maxRetries: 5,
      });

      try {
        expect((engine as any).config.cacheDir).toBe(customDir);
        expect((engine as any).config.lessonsFile).toBe("custom-lessons.json");
        expect((engine as any).config.temperature).toBe(0.5);
        expect((engine as any).config.maxRetries).toBe(5);
      } finally {
        if (fs.existsSync(customDir)) {
          fs.rmSync(customDir, { recursive: true });
        }
      }
    });
  });
});
