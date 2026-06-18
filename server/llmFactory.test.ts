import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { detectProvider, createLLM } from "./llmFactory.js";

describe("llmFactory.detectProvider", () => {
  const saved = process.env.LLM_PROVIDER;
  beforeEach(() => {
    delete process.env.LLM_PROVIDER;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = saved;
  });

  it("detects bedrock from inference-profile style model ids", () => {
    expect(
      detectProvider("us.anthropic.claude-sonnet-4-5-20250929-v1:0")
    ).toBe("bedrock");
    expect(
      detectProvider("anthropic.claude-sonnet-4-5-20250929-v1:0")
    ).toBe("bedrock");
  });

  it("detects openai from gpt models", () => {
    expect(detectProvider("gpt-5.5")).toBe("openai");
    expect(detectProvider("gpt-5.5-mini")).toBe("openai");
  });

  it("detects anthropic from plain claude names", () => {
    expect(detectProvider("claude-sonnet-4-5")).toBe("anthropic");
  });

  it("detects google from gemini names", () => {
    expect(detectProvider("gemini-3.1-pro")).toBe("google");
  });

  it("honors explicit LLM_PROVIDER env override", () => {
    process.env.LLM_PROVIDER = "bedrock";
    expect(detectProvider("gpt-5.5")).toBe("bedrock");
  });

  it("defaults to openai for unknown models", () => {
    expect(detectProvider("some-mystery-model")).toBe("openai");
  });
});

describe("llmFactory.createLLM (bedrock)", () => {
  it("constructs a ChatBedrockConverse instance without throwing", async () => {
    const llm = await createLLM({
      provider: "bedrock",
      model: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
      temperature: 0.5,
    });
    expect(llm).toBeDefined();
    expect(llm.constructor.name).toBe("ChatBedrockConverse");
  });
});
