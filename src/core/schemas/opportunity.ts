import { z } from "zod";
import { AgentOutputSchema } from "./agent";
import { SUPERIORITY_DIMENSIONS } from "./diagnosis";

const Score = z.number().int().min(1).max(5);

/** Keys must match doctrine.opportunity.weights (a test checks this). */
export const OpportunityScoresSchema = z.object({
  pain: Score,
  urgency: Score,
  product_fit: Score,
  accessibility: Score,
  result_advantage: Score,
  expansion_potential: Score,
});

const Reason = z.string().min(1);
const OpportunityReasonsSchema = z.object({
  pain: Reason,
  urgency: Reason,
  product_fit: Reason,
  accessibility: Reason,
  result_advantage: Reason,
  expansion_potential: Reason,
  competition: Reason,
});

export const OpportunityCandidateSchema = z.object({
  name: z.string().min(1),
  use_case: z.string().min(1), // the concrete job to be done
  context: z.string().min(1), // who needs it, and when
  why_underserved: z.string().min(1), // what competitor weaknesses, complaints or gaps show
  customer_advantage: z.string().min(1), // what solving it gives the customer (Law 7), beyond relief
  superiority_dimension: z.enum(SUPERIORITY_DIMENSIONS),
  competitors_in_space: z.array(z.string()),
  is_largest_market_play: z.boolean(),
  scores: OpportunityScoresSchema,
  competition: Score, // 5 = crowded / well served. A penalty, not a goal.
  reasons: OpportunityReasonsSchema,
  evidence_ids: z.array(z.string()).min(1), // research aliases like "R3", or "brief" / "diagnosis"
  case_for: z.string().min(1),
  case_against: z.string().min(1),
  validation_needed: z.string().min(1),
  implication: z.string().min(1), // what this means for ICP, positioning and GTM
  assumptions: z.array(z.string()),
  confidence: z.number().int().min(1).max(10),
});
export type OpportunityCandidate = z.infer<typeof OpportunityCandidateSchema>;

/** What the model returns. It proposes and scores; it does NOT rank or choose. Code does that. */
export const OpportunityLlmSchema = z
  .object({ candidates: z.array(OpportunityCandidateSchema).min(3).max(6) })
  .refine((o) => o.candidates.filter((c) => c.is_largest_market_play).length === 1, {
    message: "exactly one candidate must be the largest-market play (is_largest_market_play true)",
  });

const EvidenceView = z.object({ ref: z.string(), item_id: z.string(), claim: z.string(), source_url: z.string() });

export const OpportunityReportSchema = z.object({
  chosen: z.object({
    name: z.string(),
    use_case: z.string(),
    context: z.string(),
    why_underserved: z.string(),
    customer_advantage: z.string(),
    superiority_dimension: z.string(),
    competitors_in_space: z.array(z.string()),
    weakest_factor: z.object({ factor: z.string(), score: z.number(), reason: z.string() }),
    evidence: z.array(EvidenceView),
  }),
  ranking: z.array(
    z.object({
      rank: z.number(),
      name: z.string(),
      is_largest_market_play: z.boolean(),
      total: z.number(),
      weighted: z.number(),
      penalty_pct: z.number(),
      competition: z.number(),
      scores: z.record(z.string(), z.number()),
      research_backed: z.boolean(),
      case_against: z.string(),
    })
  ),
  margin_over_runner_up: z.number(),
  dropped_candidates: z.array(z.string()),
  largest_market_play: z.object({ name: z.string(), rank: z.number(), why_not: z.string() }).nullable(),
});
export type OpportunityReport = z.infer<typeof OpportunityReportSchema>;

export const OpportunityOutputSchema = AgentOutputSchema.extend({ detail: OpportunityReportSchema });
export type OpportunityOutput = z.infer<typeof OpportunityOutputSchema>;
