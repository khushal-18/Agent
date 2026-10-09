import { z } from "zod";
import { AgentOutputSchema } from "./agent";

const Score = z.number().int().min(1).max(5);

/** Keys must match doctrine.icp.factors (a test checks this). */
export const IcpScoresSchema = z.object({
  pain: Score,
  urgency: Score,
  accessibility: Score,
  ability_to_pay: Score,
  solution_fit: Score,
  trigger_strength: Score,
});

const Reason = z.string().min(1);
const IcpReasonsSchema = z.object({
  pain: Reason,
  urgency: Reason,
  accessibility: Reason,
  ability_to_pay: Reason,
  solution_fit: Reason,
  trigger_strength: Reason,
});

export const BuyerRoleSchema = z.object({
  role: z.string().min(1), // economic buyer, champion, user, blocker...
  who: z.string().min(1),
  cares_about: z.string().min(1),
  likely_objection: z.string().min(1),
  how_to_reach: z.string().min(1),
});

export const IcpSegmentSchema = z.object({
  name: z.string().min(1),
  who: z.string().min(1), // specific enough to find in a list: role + company type/size + situation
  trigger_event: z.string().min(1), // the identifiable event that makes them act now
  accessibility_notes: z.string().min(1), // where and how a small team can actually reach them
  buying_committee: z.array(BuyerRoleSchema).min(2),
  disqualifiers: z.array(z.string().min(1)).min(1), // who looks like a fit but is not
  expansion_path: z.string().min(1),
  is_largest_segment: z.boolean(),
  scores: IcpScoresSchema,
  reasons: IcpReasonsSchema,
  evidence_ids: z.array(z.string()).min(1),
  case_for: z.string().min(1),
  case_against: z.string().min(1),
  validation_needed: z.string().min(1),
  implication: z.string().min(1),
  assumptions: z.array(z.string()),
  confidence: z.number().int().min(1).max(10),
});
export type IcpSegment = z.infer<typeof IcpSegmentSchema>;

/** The model proposes and scores; it does NOT rank or choose. Code does that. */
export const IcpLlmSchema = z
  .object({ segments: z.array(IcpSegmentSchema).min(3).max(5) })
  .refine((o) => o.segments.filter((s) => s.is_largest_segment).length === 1, {
    message: "exactly one segment must be the largest-TAM segment (is_largest_segment true)",
  });

const EvidenceView = z.object({ ref: z.string(), item_id: z.string(), claim: z.string(), source_url: z.string() });

export const IcpReportSchema = z.object({
  wedge: z.string(),
  chosen: z.object({
    name: z.string(),
    who: z.string(),
    trigger_event: z.string(),
    accessibility_notes: z.string(),
    buying_committee: z.array(BuyerRoleSchema),
    disqualifiers: z.array(z.string()),
    expansion_path: z.string(),
    weakest_factor: z.object({ factor: z.string(), score: z.number(), reason: z.string() }),
    evidence: z.array(EvidenceView),
  }),
  ranking: z.array(
    z.object({
      rank: z.number(),
      name: z.string(),
      is_largest_segment: z.boolean(),
      normalized: z.number(),
      product: z.number(),
      scores: z.record(z.string(), z.number()),
      research_backed: z.boolean(),
      case_against: z.string(),
    })
  ),
  margin_over_runner_up: z.number(),
  dropped_segments: z.array(z.string()),
  largest_segment: z.object({ name: z.string(), rank: z.number(), why_not: z.string() }).nullable(),
});
export type IcpReport = z.infer<typeof IcpReportSchema>;

export const IcpOutputSchema = AgentOutputSchema.extend({ detail: IcpReportSchema });
export type IcpOutput = z.infer<typeof IcpOutputSchema>;
