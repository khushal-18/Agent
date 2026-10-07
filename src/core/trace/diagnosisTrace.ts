import { DiagnosisOutputSchema } from "../schemas/diagnosis";

const bullets = (items: string[]) => items.map((i) => `  - ${i}`).join("\n");

/** Renders the structured decision trace: what we know, what we don't, insight, decision, why. */
export function formatDiagnosisTrace(raw: unknown): string {
  const o = DiagnosisOutputSchema.parse(raw);
  const d = o.detail;
  const lines = [
    "==================== DIAGNOSIS ====================",
    "",
    "WHAT WE KNOW (from the brief)",
    bullets(d.known_from_brief),
    "",
    "WHAT WE DON'T KNOW",
    ...d.unknowns.map((u) => `  - ${u.question}\n      matters because: ${u.why_it_matters}\n      find out by: ${u.how_to_find_out}`),
    "",
    "WHAT THEY ARE ACTUALLY BUILDING",
    `  ${d.what_they_are_building}`,
    "",
    "HYPE REMOVED",
    d.hype_removed.length ? d.hype_removed.map((h) => `  - "${h.claim}": ${h.why_it_is_not_differentiation}`).join("\n") : "  (none)",
    "",
    "INSIGHT: THE REAL PROBLEM",
    `  ${d.real_problem}`,
    `  Founder framing: ${d.founder_framing.verdict.toUpperCase()}. ${d.founder_framing.note}`,
    "",
    "NEED",
    `  Who feels it: ${d.need.who_feels_it}`,
    `  Today they: ${d.need.current_workaround}`,
    `  Cost of not solving: ${d.need.cost_of_not_solving}`,
    `  Why now: ${d.need.why_now}`,
    "",
    `SOLUTION QUALITY: ${d.solution_quality.verdict.toUpperCase()} (best dimension: ${d.solution_quality.best_superiority_dimension})`,
    `  ${d.solution_quality.reasoning}`,
    `  To be superior: ${d.solution_quality.what_would_make_it_superior}`,
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
    o.assumptions.length ? bullets(o.assumptions) : "  (none)",
    "",
    `CONFIDENCE: ${o.confidence}/10`,
    `VALIDATE NEXT: ${o.validation_needed}`,
    "",
    "NEXT STAGE (RESEARCH) MUST ANSWER",
    bullets(d.research_questions_for_next_stage),
    "",
    "DOWNSTREAM EFFECT",
    o.downstream_implications.length ? bullets(o.downstream_implications) : "  (none)",
    "",
  ];
  return lines.join("\n");
}
