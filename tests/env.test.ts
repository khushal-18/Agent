import { describe, it, expect } from "vitest";
import { parseEnv } from "../src/core/env";

describe("parseEnv", () => {
  it("defaults to gemini and requires GEMINI_API_KEY", () => {
    expect(() => parseEnv({})).toThrow(/GEMINI_API_KEY is required/);
    const env = parseEnv({ GEMINI_API_KEY: "abc" });
    expect(env.LLM_PROVIDER).toBe("gemini");
    expect(env.GEMINI_MODEL).toBeTruthy();
  });

  it("treats an empty value as not set", () => {
    expect(() => parseEnv({ GEMINI_API_KEY: "   " })).toThrow(/GEMINI_API_KEY is required/);
  });

  it("requires the key that matches the chosen provider", () => {
    expect(() => parseEnv({ LLM_PROVIDER: "anthropic", GEMINI_API_KEY: "abc" })).toThrow(/ANTHROPIC_API_KEY is required/);
    expect(parseEnv({ LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k" }).ANTHROPIC_API_KEY).toBe("k");
  });

  it("rejects an unknown provider", () => {
    expect(() => parseEnv({ LLM_PROVIDER: "openai", GEMINI_API_KEY: "abc" })).toThrow();
  });
});