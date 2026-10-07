import { z } from "zod";
import type { LlmClient, LlmMessage } from "./types";

/** Pulls a JSON object out of a model reply, tolerating ```json fences and stray prose. */
export function extractJson(raw: string): unknown {
  const unfenced = raw.replace(/```(?:json)?/gi, "").trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("No JSON object found in reply");
  return JSON.parse(unfenced.slice(start, end + 1));
}

/**
 * Asks the model for JSON matching `schema`, validates it with Zod, and on failure
 * sends the validation errors back so the model can correct itself.
 */
export async function generateStructured<S extends z.ZodType>(
  llm: LlmClient,
  opts: { system: string; user: string; schema: S; maxAttempts?: number; maxTokens?: number }
): Promise<z.infer<S>> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const system =
    `${opts.system}\n\n` +
    `Respond with ONLY a single JSON object that matches this JSON Schema. ` +
    `No prose, no markdown fences.\n${JSON.stringify(z.toJSONSchema(opts.schema))}`;

  const messages: LlmMessage[] = [{ role: "user", content: opts.user }];
  let lastError = "unknown error";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const raw = await llm.complete({ system, messages, maxTokens: opts.maxTokens });
    try {
      const parsed = opts.schema.safeParse(extractJson(raw));
      if (parsed.success) return parsed.data;
      lastError = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    messages.push(
      { role: "assistant", content: raw },
      { role: "user", content: `Your reply was invalid: ${lastError}. Return corrected JSON only.` }
    );
  }
  throw new Error(`Structured output failed after ${maxAttempts} attempts: ${lastError}`);
}