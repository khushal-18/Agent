import { z } from "zod";
import { StageSchema } from "./stages";

export const AlternativeSchema = z.object({
  option: z.string().min(1),
  why_not: z.string().min(1),
});

// The ONLY legitimate way for an agent to disagree with an upstream decision.
export const ContradictsUpstreamSchema = z.object({
  decision_id: z.string().min(1),
  new_evidence: z.string().min(1),
  proposed_revision: z.string().min(1),
});

export const AgentOutputSchema = z.object({
  recommendation: z.string().min(1),
  rationale: z.string().min(1),
  evidence_refs: z.array(z.string()),
  assumptions: z.array(z.string()),
  confidence: z.number().int().min(1).max(10),
  validation_needed: z.string().min(1), // what would prove this wrong / what to test next
  alternatives_considered: z.array(AlternativeSchema).min(1),
  downstream_implications: z.array(z.string()),
  contradicts_upstream: ContradictsUpstreamSchema.optional(),
});
export type AgentOutput = z.infer<typeof AgentOutputSchema>;

// Assembled by the orchestrator, never by the agent itself.
export const AgentInputSchema = z.object({
  stage: StageSchema,
  objective: z.string().min(1),
  project_context: z.string(),
  active_decisions: z.array(z.record(z.string(), z.unknown())),
  relevant_research: z.array(z.record(z.string(), z.unknown())),
  upstream_outputs: z.record(z.string(), z.unknown()),
  constraints: z.record(z.string(), z.unknown()),
  doctrine_slice: z.record(z.string(), z.unknown()),
});
export type AgentInput = z.infer<typeof AgentInputSchema>;