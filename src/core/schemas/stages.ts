import { z } from "zod";

export const STAGES = [
  "intake",
  "diagnosis",
  "research",
  "opportunity",
  "icp",
  "positioning",
  "gtm",
  "funnel",
  "campaign",
  "critic",
  "compose",
] as const;

export const StageSchema = z.enum(STAGES);
export type Stage = z.infer<typeof StageSchema>;