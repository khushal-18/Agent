import { z } from "zod";
import { createLlmFromEnv } from "../src/core/llm/factory";
import { generateStructured } from "../src/core/llm/structured";

async function main() {
  const llm = createLlmFromEnv();
  const result = await generateStructured(llm, {
    system: "You are a connectivity test.",
    user: "Reply with ok=true and a one-sentence note saying hello.",
    schema: z.object({ ok: z.boolean(), note: z.string() }),
    maxTokens: 2048,
  });
  console.log("LLM connection OK:", result);
}

main().catch((e) => {
  console.error("LLM ping failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});