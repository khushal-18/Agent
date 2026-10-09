import { IcpOutputSchema } from "../schemas/icp";

const bullets = (items: string[]) => (items.length ? items.map((i) => `  - ${i}`).join("\n") : "  (none)");
const scoreLine = (scores: Record<string, number>) => Object.entries(scores).map(([k, v]) => `${k} ${v}`).join(", ");

/** Renders the beachhead, ICP and buyer map, with the code-computed ranking. */
export function formatIcpTrace(raw: unknown): string {
  const o = IcpOutputSchema.parse(raw);
  const d = o.detail;
  const c = d.chosen;
  const lines = [
    "==================== BEACHHEAD, ICP AND BUYER MAP ====================",
    "",
    `WEDGE THIS SERVES: ${d.wedge}`,
    "",
    `BEACHHEAD CUSTOMER: ${c.name}`,
    `  Who:                 ${c.who}`,
    `  Trigger event:       ${c.trigger_event}`,
    `  How to reach them:   ${c.accessibility_notes}`,
    `  Expansion path:      ${c.expansion_path}`,
    `  Weakest factor:      ${c.weakest_factor.factor} (${c.weakest_factor.score}/5). ${c.weakest_factor.reason}`,
    "",
    "BUYER MAP",
    ...c.buying_committee.map(
      (b) => `  ${b.role.toUpperCase()}: ${b.who}\n      cares about:  ${b.cares_about}\n      objection:    ${b.likely_objection}\n      reach via:    ${b.how_to_reach}`
    ),
    "",
    "DISQUALIFIERS (look like a fit, are not)",
    bullets(c.disqualifiers),
    "",
    "EVIDENCE",
    ...(c.evidence.length ? c.evidence.map((e) => `  ${e.ref}: ${e.claim}\n      ${e.source_url}`) : ["  (none from web research)"]),
    "",
    "RANKING (pain x urgency x accessibility x ability to pay x fit x trigger, computed by the system)",
  ];
  for (const r of d.ranking) {
    lines.push(
      `  ${r.rank}. ${r.name}${r.is_largest_segment ? "  [LARGEST SEGMENT]" : ""}`,
      `       ${r.normalized.toFixed(0)}/100 (product ${r.product})  ${r.research_backed ? "research-backed" : "NOT research-backed"}`,
      `       ${scoreLine(r.scores)}`
    );
  }
  lines.push("", `MARGIN OVER RUNNER-UP: ${d.margin_over_runner_up.toFixed(1)} points`);
  if (d.largest_segment) {
    lines.push("", `LARGEST SEGMENT: "${d.largest_segment.name}" ranked #${d.largest_segment.rank}`, `  ${d.largest_segment.why_not}`);
  }
  if (d.dropped_segments.length) lines.push("", `DROPPED (no verifiable evidence): ${d.dropped_segments.join("; ")}`);

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
