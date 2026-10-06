import { getEnv } from "../src/core/env";

const env = getEnv();
const masked = env.ANTHROPIC_API_KEY.slice(0, 7) + "..." + env.ANTHROPIC_API_KEY.slice(-4);
console.log("Environment OK");
console.log("  ANTHROPIC_API_KEY  :", masked);
console.log("  ANTHROPIC_MODEL    :", env.ANTHROPIC_MODEL);
console.log("  DATABASE_URL       :", env.DATABASE_URL);
console.log("  DOCTRINE_VERSION   :", env.DOCTRINE_VERSION);
console.log("  MAX_REVISION_PASSES:", env.MAX_REVISION_PASSES);