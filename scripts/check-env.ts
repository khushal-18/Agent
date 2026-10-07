import { getEnv } from "../src/core/env";

const mask = (k?: string) => (k ? `${k.slice(0, 4)}...${k.slice(-4)}` : "(not set)");

const env = getEnv();
console.log("Environment OK");
console.log("  LLM_PROVIDER       :", env.LLM_PROVIDER);
if (env.LLM_PROVIDER === "gemini") {
  console.log("  GEMINI_API_KEY     :", mask(env.GEMINI_API_KEY));
  console.log("  GEMINI_MODEL       :", env.GEMINI_MODEL);
} else {
  console.log("  ANTHROPIC_API_KEY  :", mask(env.ANTHROPIC_API_KEY));
  console.log("  ANTHROPIC_MODEL    :", env.ANTHROPIC_MODEL);
}
console.log("  DATABASE_URL       :", env.DATABASE_URL);
console.log("  DOCTRINE_VERSION   :", env.DOCTRINE_VERSION);
console.log("  MAX_REVISION_PASSES:", env.MAX_REVISION_PASSES);