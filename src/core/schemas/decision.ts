import { z } from "zod";
import { StageSchema } from "./stages";

export const RejectedOptionSchema = z.object({
  option: z.string().min(1),
  reason: z.string().min(1),
});

export const DecisionSchema = z.object({
  decision: z.string().min(1),
  stage: StageSchema,
  rationale: z.string().min(1),
  evidence: z.array(z.string()), // ResearchItem ids; may be empty early on (e.g. diagnosis from the brief)
  rejected_options: z.array(RejectedOptionSchema).min(1, "Law 10: every decision needs rejected alternatives"),
  assumptions: z.array(z.string()),
  confidence: z.number().int().min(1).max(10),
  validation_needed: z.string().min(1),
  downstream_implications: z.array(z.string()),
});

export type Decision = z.infer<typeof DecisionSchema>;