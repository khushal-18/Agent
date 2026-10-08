import { ResearchOutputSchema } from "../schemas/research";

const bullets = (items: string[]) => (items.length ? items.map((i) => `  - ${i}`).join("\n") : "  (none)");
const cite = (ids: string[]) => `[${ids.join(", ")}]`;

/** Renders the research trace: what we found, what it means, and how it checks the diagnosis. */
export function formatResearchTrace(raw: unknown): string {
  const o = ResearchOutputSchema.parse(raw);
  const d = o.detail;
  const lines: string[] = [
    "==================== RESEARCH ====================",
    "",
    `CATEGORY: ${d.category}`,
    "",
    `SEARCHES RUN (${d.queries_run.length})`,
    ...d.queries_run.map((q) => `  - [${q.type}] ${q.query} (${q.sources_found} sources)`),
    ...(d.discarded_queries.length ? ["  Discarded (no sources returned):", ...d.discarded_queries.map((q) => `    x ${q}`)] : []),
    "",
    "COMPETITORS AND ALTERNATIVES",
  ];

  if (!d.competitors.length) lines.push("  (none with a verifiable source)");
  for (const c of d.competitors) {
    lines.push(
      `  ${c.name.toUpperCase()} (${c.kind}) ${cite(c.source_ids)}`,
      `      wants to own:        ${c.positioning}`,
      `      acquires customers:  ${c.gtm}`,
      `      does well:           ${c.does_well}`,
      `      does badly:          ${c.does_badly}`,
      `      customers complain:  ${c.customer_complaints}`,
      `      does not own:        ${c.does_not_own}`
    );
  }

  const types = [...new Set(d.findings.map((f) => f.type))];
  lines.push("", "KEY FINDINGS");
  for (const t of types) {
    lines.push(`  ${t.toUpperCase()}`);
    for (const f of d.findings.filter((x) => x.type === t)) lines.push(`    - ${f.claim} ${cite(f.source_ids)} (conf ${f.confidence}/10)`);
  }

  lines.push("", "MARKET GAPS", ...(d.market_gaps.length ? d.market_gaps.map((g) => `  - ${g.gap}\n      why underserved: ${g.why_underserved} ${cite(g.source_ids)}`) : ["  (none with a verifiable source)"]));

  lines.push("", `DIAGNOSIS CHECK: ${d.diagnosis_check.verdict.toUpperCase()}`, `  ${d.diagnosis_check.note}`);
  if (o.contradicts_upstream) {
    lines.push(
      "",
      "!! RESEARCH CONTRADICTS THE DIAGNOSIS !!",
      `  Evidence: ${o.contradicts_upstream.new_evidence}`,
      `  Proposed revision: ${o.contradicts_upstream.proposed_revision}`
    );
  }

  lines.push(
    "",
    "NOT FOUND IN RESEARCH",
    bullets(d.unanswered_questions),
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
    `VALIDATE NEXT (needs a human): ${o.validation_needed}`,
    "",
    "DOWNSTREAM EFFECT",
    bullets(o.downstream_implications),
    "",
    "SOURCES",
    ...d.sources.map((s) => `  ${s.id}  ${s.title}\n       ${s.url}`),
    "",
    `Unsourced items removed by the system: ${d.dropped_unsourced.findings} findings, ${d.dropped_unsourced.competitors} competitors, ${d.dropped_unsourced.gaps} gaps.`,
    ""
  );
  return lines.join("\n");
}
