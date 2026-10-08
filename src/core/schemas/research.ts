import { z } from "zod";
import { AgentOutputSchema } from "./agent";
import { RESEARCH_TYPES } from "./researchItem";

const SourceIds = z.array(z.string().regex(/^S\d+$/, "use source ids like S1")).min(1);

export const ResearchPlanSchema = z.object({
  /** How buyers would name this category in a search box. */
  category: z.string().min(1),
  queries: z
    .array(z.object({ query: z.string().min(3), type: z.enum(RESEARCH_TYPES), why: z.string().min(1) }))
    .min(1),
});
export type ResearchPlan = z.infer<typeof ResearchPlanSchema>;

const FindingSchema = z.object({
  claim: z.string().min(1),
  summary: z.string().min(1),
  type: z.enum(RESEARCH_TYPES),
  source_ids: SourceIds,
  confidence: z.number().int().min(1).max(10),
});

const CompetitorSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(["direct", "indirect", "status_quo"]),
  positioning: z.string().min(1), // what they want to own
  gtm: z.string().min(1), // how they acquire customers
  does_well: z.string().min(1),
  does_badly: z.string().min(1),
  customer_complaints: z.string().min(1),
  does_not_own: z.string().min(1), // what they leave open
  source_ids: SourceIds,
});

const GapSchema = z.object({
  gap: z.string().min(1),
  why_underserved: z.string().min(1),
  source_ids: SourceIds,
});

const DiagnosisCheckSchema = z.object({
  verdict: z.enum(["confirmed", "refined", "contradicted"]),
  note: z.string().min(1),
});

/** What the model returns after reading all search results. */
export const ResearchSynthesisSchema = AgentOutputSchema.omit({
  detail: true,
  research_items: true,
  evidence_refs: true,
}).extend({
  category: z.string().min(1),
  findings: z.array(FindingSchema).min(1),
  competitors: z.array(CompetitorSchema),
  market_gaps: z.array(GapSchema),
  diagnosis_check: DiagnosisCheckSchema,
  unanswered_questions: z.array(z.string()),
});
export type ResearchSynthesis = z.infer<typeof ResearchSynthesisSchema>;

/** The full report stored in AgentOutput.detail after code has verified every citation. */
export const ResearchReportSchema = z.object({
  category: z.string(),
  queries_run: z.array(z.object({ query: z.string(), type: z.string(), sources_found: z.number() })),
  discarded_queries: z.array(z.string()),
  sources: z.array(z.object({ id: z.string(), url: z.string(), title: z.string() })),
  findings: z.array(FindingSchema.extend({ item_id: z.string() })),
  competitors: z.array(CompetitorSchema),
  market_gaps: z.array(GapSchema),
  diagnosis_check: DiagnosisCheckSchema,
  unanswered_questions: z.array(z.string()),
  dropped_unsourced: z.object({ findings: z.number(), competitors: z.number(), gaps: z.number() }),
});
export type ResearchReport = z.infer<typeof ResearchReportSchema>;

export const ResearchOutputSchema = AgentOutputSchema.extend({ detail: ResearchReportSchema });
export type ResearchOutput = z.infer<typeof ResearchOutputSchema>;
