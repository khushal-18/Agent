import { OpportunityOutputSchema } from "../schemas/opportunity";

const bullets = (items: string[]) => (items.length ? items.map((i) => `  - ${i}`).join("\n") : "  (none)");
const scoreLine = (scores: Record<string, number>) => Object.entries(scores).map(([k, v]) => `${k} ${v}`).join(", ");

/** Renders the opportunity decision: the winner, the full code-computed ranking, and the Law 3 comparison. */
export function formatOpportunityTrace(raw: unknown): string {
  const o = OpportunityOutputSchema.parse(raw);
  const d = o.detail;
  const c = d.chosen;
  const lines = [
    "==================== OPPORTUNITY (THE WEDGE) ====================",
    "",
    `CHOSEN WEDGE: ${c.name}`,
    `  Use case:            ${c.use_case}`,
    `  Context:             ${c.context}`,
    `  Why underserved:     ${c.why_underserved}`,
    `  Advantage gained:    ${c.customer_advantage}`,
    `  Can win on:          ${c.superiority_dimension}`,
    `  Competitors there:   ${c.competitors_in_space.join(", ") || "(none named)"}`,
    `  Weakest factor:      ${c.weakest_factor.factor} (${c.weakest_factor.score}/5). ${c.weakest_factor.reason}`,
    "  Evidence:",
    ...(c.evidence.length ? c.evidence.map((e) => `    ${e.ref}: ${e.claim}\n        ${e.source_url}`) : ["    (none from web research)"]),
    "",
    "RANKING (scores come from the model, ranking and totals are computed by the system)",
  ];
  for (const r of d.ranking) {
    lines.push(
      `  ${r.rank}. ${r.name}${r.is_largest_market_play ? "  [LARGEST-MARKET PLAY]" : ""}`,
      `       ${r.total.toFixed(0)}/100  (competition ${r.competition}/5, penalty ${r.penalty_pct.toFixed(0)}%)  ${r.research_backed ? "research-backed" : "NOT research-backed"}`,
      `       ${scoreLine(r.scores)}`
    );
  }
  lines.push("", `MARGIN OVER RUNNER-UP: ${d.margin_over_runner_up.toFixed(1)} points`);
  if (d.largest_market_play) {
    lines.push("", `LARGEST-MARKET PLAY: "${d.largest_market_play.name}" ranked #${d.largest_market_play.rank}`, `  ${d.largest_market_play.why_not}`);
  }
  if (d.dropped_candidates.length) lines.push("", `DROPPED (no verifiable evidence): ${d.dropped_candidates.join("; ")}`);

  lines.push(
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
    ""
  );
  return lines.join("\n");
}
