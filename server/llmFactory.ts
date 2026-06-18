/**
 * Shared LLM factory.
 *
 * Builds a LangChain chat model for the configured provider. Supports
 * OpenAI, Anthropic, Google Gemini and AWS Bedrock (Claude via Bedrock).
 *
 * All construction is lazy (dynamic import) so the server can start without
 * any provider SDK credentials present — only the chosen provider is loaded
 * when an LLM-backed endpoint is actually invoked.
 */

import type { BaseLanguageModel } from "@langchain/core/language_models/base";

export type LLMProvider =
  | "openai"
  | "anthropic"
  | "google"
  | "bedrock";

export interface LLMFactoryConfig {
  model: string;
  provider?: LLMProvider;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Auto-detect provider from environment and/or model string.
 *
 * Priority:
 *   1. Explicit LLM_PROVIDER env var
 *   2. Heuristics on the model string
 */
export function detectProvider(model: string): LLMProvider {
  const envProvider = process.env.LLM_PROVIDER?.toLowerCase();
  if (
    envProvider === "openai" ||
    envProvider === "anthropic" ||
    envProvider === "google" ||
    envProvider === "bedrock"
  ) {
    return envProvider;
  }

  const m = model.toLowerCase();
  // Bedrock model ids look like "anthropic.claude-sonnet-4-5-20250929-v1:0"
  // or "us.anthropic.claude-..." (inference profile arns/ids).
  if (m.includes(".anthropic.") || m.startsWith("anthropic.")) return "bedrock";
  if (m.includes("gpt") || m.includes("openai")) return "openai";
  if (m.includes("claude")) return "anthropic";
  if (m.includes("gemini")) return "google";
  return "openai";
}

/**
 * Build a chat model for the given config. Throws a descriptive error if the
 * provider SDK or required credentials are missing.
 */
export async function createLLM(
  config: LLMFactoryConfig
): Promise<BaseLanguageModel> {
  const provider = config.provider ?? detectProvider(config.model);
  const temperature = config.temperature ?? 0.7;
  const maxTokens = config.maxTokens ?? 8192;

  switch (provider) {
    case "openai": {
      const { ChatOpenAI } = await import("@langchain/openai");
      return new ChatOpenAI({
        modelName: config.model,
        temperature,
        maxTokens,
        apiKey: process.env.OPENAI_API_KEY,
      }) as unknown as BaseLanguageModel;
    }

    case "anthropic": {
      const { ChatAnthropic } = await import("@langchain/anthropic");
      return new ChatAnthropic({
        modelName: config.model,
        temperature,
        maxTokens,
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      }) as unknown as BaseLanguageModel;
    }

    case "google": {
      const { ChatGoogleGenerativeAI } = await import(
        "@langchain/google-genai"
      );
      return new ChatGoogleGenerativeAI({
        modelName: config.model,
        temperature,
        apiKey: process.env.GOOGLE_API_KEY,
      }) as unknown as BaseLanguageModel;
    }

    case "bedrock": {
      const { ChatBedrockConverse } = await import("@langchain/aws");
      const region =
        process.env.BEDROCK_AWS_REGION ||
        process.env.AWS_REGION ||
        process.env.AWS_DEFAULT_REGION ||
        "us-east-1";

      // Credentials: if explicit keys are present use them, otherwise fall
      // back to the AWS default credential provider chain (profiles, SSO,
      // instance roles, etc.).
      const explicitCreds =
        process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
          ? {
              accessKeyId: process.env.AWS_ACCESS_KEY_ID,
              secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
              sessionToken: process.env.AWS_SESSION_TOKEN,
            }
          : undefined;

      return new ChatBedrockConverse({
        model: config.model,
        region,
        temperature,
        maxTokens,
        ...(explicitCreds ? { credentials: explicitCreds } : {}),
      }) as unknown as BaseLanguageModel;
    }

    default:
      throw new Error(`Unsupported LLM provider: ${provider}`);
  }
}
