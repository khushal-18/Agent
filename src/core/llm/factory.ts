import { getEnv } from "../env";
import { AnthropicLlm } from "./anthropic";
import { GeminiLlm } from "./gemini";
import { CachedSearchClient } from "./searchCache";
import type { LlmClient, SearchClient } from "./types";

function createGemini(): GeminiLlm {
  const env = getEnv();
  return new GeminiLlm(env.GEMINI_API_KEY!, env.GEMINI_MODEL, { fallbackModel: env.GEMINI_FALLBACK_MODEL });
}

/** The only place that knows which provider is in use. Agents just receive an LlmClient. */
export function createLlmFromEnv(): LlmClient {
  const env = getEnv();
  if (env.LLM_PROVIDER === "gemini") return createGemini();
  return new AnthropicLlm(env.ANTHROPIC_API_KEY!, env.ANTHROPIC_MODEL);
}

/** Live web search with sources. Only Gemini (Google Search grounding) is wired up for now. */
export function createSearchFromEnv(opts: { cache?: boolean } = {}): SearchClient {
  const env = getEnv();
  if (env.LLM_PROVIDER !== "gemini") {
    throw new Error("Research needs LLM_PROVIDER=gemini (it uses Google Search grounding).");
  }
  const live = createGemini();
  if (opts.cache === false) return live;
  return new CachedSearchClient(live, { dir: "data/search-cache", ttlHours: env.SEARCH_CACHE_HOURS });
}
