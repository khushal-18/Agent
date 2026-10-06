import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5-5"),
  DATABASE_URL: z.string().default("file:./data/khushal.db"),
  DOCTRINE_VERSION: z.string().default("v1"),
  MAX_REVISION_PASSES: z.coerce.number().int().min(0).max(5).default(2),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

/** Validated, typed access to environment variables. Server-side only. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment configuration:\n${issues}\nCopy .env.example to .env and fill it in.`
    );
  }
  cached = parsed.data;
  return cached;
}