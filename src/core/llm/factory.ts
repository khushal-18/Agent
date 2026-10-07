import { getEnv } from "../env";
import { AnthropicLlm } from "./anthropic";
import { GeminiLlm } from "./gemini";
import type { LlmClient } from "./types";

/** The only place that knows which provider is in use. Agents just receive an LlmClient. */
export function createLlmFromEnv(): LlmClient {
  const env = getEnv();
  if (env.LLM_PROVIDER === "gemini") return new GeminiLlm(env.GEMINI_API_KEY!, env.GEMINI_MODEL);
  return new AnthropicLlm(env.ANTHROPIC_API_KEY!, env.ANTHROPIC_MODEL);
}