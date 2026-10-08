import { z } from "zod";

/** Mirrors the doctrine's competitor research priorities. Keep in sync with src/db/schema.ts. */
export const RESEARCH_TYPES = [
  "competitor_positioning",
  "gtm",
  "strength",
  "weakness",
  "complaint",
  "messaging",
  "gap",
  "market",
] as const;

export const ResearchItemSchema = z.object({
  id: z.string().min(1),
  claim: z.string().min(1),
  excerpt_summary: z.string().min(1),
  type: z.enum(RESEARCH_TYPES),
  source_url: z.string().min(1),
  source_title: z.string(),
  confidence: z.number().int().min(1).max(10),
});
export type ResearchItem = z.infer<typeof ResearchItemSchema>;
