import "dotenv/config";
import { z } from "zod";

// An empty value in .env (e.g. `ANTHROPIC_API_KEY=`) counts as "not set".
const optionalKey = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const EnvSchema = z
  .object({
    LLM_PROVIDER: z.enum(["gemini", "anthropic"]).default("gemini"),
    GEMINI_API_KEY: optionalKey,
    GEMINI_MODEL: z.string().default("gemini-3.8-flash"),
    GEMINI_FALLBACK_MODEL: optionalKey,
    ANTHROPIC_API_KEY: optionalKey,
    ANTHROPIC_MODEL: z.string().default("claude-sonnet-5-5"),
    DATABASE_URL: z.string().default("file:./data/khushal.db"),
    DOCTRINE_VERSION: z.string().default("v1"),
    MAX_REVISION_PASSES: z.coerce.number().int().min(0).max(5).default(2),
  })
  .superRefine((env, ctx) => {
    const keyName = env.LLM_PROVIDER === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY";
    if (!env[keyName]) {
      ctx.addIssue({
        code: "custom",
        path: [keyName],
        message: `${keyName} is required when LLM_PROVIDER=${env.LLM_PROVIDER}`,
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

/** Pure and testable: validates any env-like object. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(
      `Invalid environment configuration:\n${issues}\nCopy .env.example to .env and fill it in.`
    );
  }
  return parsed.data;
}

let cached: Env | null = null;

/** Validated, typed access to environment variables. Server-side only. */
export function getEnv(): Env {
  if (!cached) cached = parseEnv(process.env);
  return cached;
}
