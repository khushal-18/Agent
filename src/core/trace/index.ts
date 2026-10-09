import { AgentOutputSchema } from "../schemas/agent";
import type { Stage } from "../schemas/stages";
import { formatDiagnosisTrace } from "./diagnosisTrace";
import { formatIcpTrace } from "./icpTrace";
import { formatOpportunityTrace } from "./opportunityTrace";
import { formatResearchTrace } from "./researchTrace";

const bullets = (items: string[]) => (items.length ? items.map((i) => `  - ${i}`).join("\n") : "  (none)");

/** Fallback for stages without a dedicated renderer: the standard decision trace. */
export function formatGenericTrace(stage: Stage, raw: unknown): string {
  const o = AgentOutputSchema.parse(raw);
  return [
    `==================== ${stage.toUpperCase()} ====================`,
    "",
    "DECISION",
    `  ${o.recommendation}`,
    "",
    "WHY",
    `  ${o.rationale}`,
    "",
    "REJECTED ALTERNATIVES",
    ...o.alternatives_considered.map((a) => `  - ${a.option}\n      why not: ${a.why_not}`),
    "",
    "ASSUMPTIONS",
    bullets(o.assumptions),
    "",
    `CONFIDENCE: ${o.confidence}/10`,
    `VALIDATE NEXT: ${o.validation_needed}`,
    "",
    "DOWNSTREAM EFFECT",
    bullets(o.downstream_implications),
    "",
  ].join("\n");
}

const RENDERERS: Partial<Record<Stage, (raw: unknown) => string>> = {
  diagnosis: formatDiagnosisTrace,
  research: formatResearchTrace,
  opportunity: formatOpportunityTrace,
  icp: formatIcpTrace,
};

/** One entry point for every stage. Add a renderer here when a new stage gets a rich report. */
export function formatStageTrace(stage: Stage, raw: unknown): string {
  const render = RENDERERS[stage];
  return render ? render(raw) : formatGenericTrace(stage, raw);
}
