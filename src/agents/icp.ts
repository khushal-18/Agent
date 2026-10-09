import { generateStructured } from "../core/llm/structured";
import type { LlmClient } from "../core/llm/types";
import type { Agent } from "../core/orchestrator/types";
import type { AgentInput, AgentOutput } from "../core/schemas/agent";
import { DiagnosisOutputSchema } from "../core/schemas/diagnosis";
import { IcpLlmSchema, type IcpReport, type IcpSegment } from "../core/schemas/icp";
import { OpportunityOutputSchema } from "../core/schemas/opportunity";
import { ResearchOutputSchema } from "../core/schemas/research";
import { buildResearchRefs, checkEvidence, renderResearchRefs, type ResearchRef } from "../core/scoring/evidence";
import { scoreIcp, type IcpScore } from "../core/scoring/icp";
import { capConfidence, closeCallNote } from "../core/scoring/selection";
import { buildSystemPrompt, DoctrineSliceSchema } from "../prompts/layers";
import { ICP_TASK } from "../prompts/stages/icp";

function renderContext(
  diag: ReturnType<typeof DiagnosisOutputSchema.parse>,
  research: ReturnType<typeof ResearchOutputSchema.parse>,
  opp: ReturnType<typeof OpportunityOutputSchema.parse>,
  refs: ResearchRef[]
): string {
  const w = opp.detail.chosen;
  const rejected = opp.detail.ranking
    .slice(1)
    .map((r) => `- ${r.name} (score ${r.total.toFixed(0)}/100): ${r.case_against}`)
    .join("\n");
  const competitors = research.detail.competitors.map((c) => `- ${c.name} (${c.kind}): owns "${c.positioning}", leaves open "${c.does_not_own}"`).join("\n");

  return `CHOSEN WEDGE (from the opportunity stage)
- ${w.name}: ${w.use_case}
- Context: ${w.context}
- Why underserved: ${w.why_underserved}
- Advantage to the customer: ${w.customer_advantage}
- Weakest factor: ${w.weakest_factor.factor} (${w.weakest_factor.score}/5). ${w.weakest_factor.reason}

OTHER OPPORTUNITIES THAT LOST
${rejected || "(none)"}

DIAGNOSIS
- What they are building: ${diag.detail.what_they_are_building}
- Real problem: ${diag.detail.real_problem}
- Who feels it: ${diag.detail.need.who_feels_it}. Today they: ${diag.detail.need.current_workaround}
- Known from the brief: ${diag.detail.known_from_brief.join("; ")}

COMPETITORS
${competitors || "(none)"}

RESEARCH ITEMS YOU MAY CITE (use the aliases)
${renderResearchRefs(refs)}`;
}

export function createIcpAgent(llm: LlmClient): Agent {
  return {
    stage: "icp",
    async run(input: AgentInput): Promise<AgentOutput> {
      const slice = DoctrineSliceSchema.parse(input.doctrine_slice);
      if (!slice.icp) throw new Error("The doctrine slice has no ICP scoring config.");

      const diag = DiagnosisOutputSchema.safeParse(input.upstream_outputs["diagnosis"]);
      const research = ResearchOutputSchema.safeParse(input.upstream_outputs["research"]);
      const opp = OpportunityOutputSchema.safeParse(input.upstream_outputs["opportunity"]);
      if (!diag.success || !research.success || !opp.success) {
        throw new Error("ICP needs accepted diagnosis, research and opportunity stages.");
      }
      const refs = buildResearchRefs(input.relevant_research);

      const result = await generateStructured(llm, {
        system: buildSystemPrompt(slice, ICP_TASK),
        user: renderContext(diag.data, research.data, opp.data, refs),
        schema: IcpLlmSchema,
        maxTokens: 16000,
      });

      type Scored = IcpSegment & { score: IcpScore; research: ResearchRef[] };
      const dropped: string[] = [];
      const scored: Scored[] = [];
      for (const s of result.segments) {
        const ev = checkEvidence(s.evidence_ids, refs);
        if (!ev.valid.length) {
          dropped.push(s.name);
          continue;
        }
        scored.push({ ...s, score: scoreIcp(s.scores, { icp: slice.icp }), research: ev.research });
      }
      if (scored.length < 2) {
        throw new Error("Fewer than two segments had verifiable evidence, so there is nothing to compare.");
      }

      // Pain x Urgency x Accessibility x Ability to pay x Fit x Trigger. One weak factor sinks a segment.
      const ranked = [...scored].sort(
        (a, b) =>
          b.score.normalized - a.score.normalized ||
          b.scores.accessibility - a.scores.accessibility ||
          b.scores.pain - a.scores.pain ||
          a.name.localeCompare(b.name)
      );
      const winner = ranked[0];
      const runner = ranked[1];
      const margin = winner.score.normalized - runner.score.normalized;
      const researchBacked = winner.research.length > 0;
      const weak = winner.score.weakest;
      const weakReason = (winner.reasons as Record<string, string>)[weak.factor];

      const largest = ranked.find((s) => s.is_largest_segment);
      const largestRank = largest ? ranked.indexOf(largest) + 1 : 0;

      const assumptions = [
        ...winner.assumptions,
        `Weakest factor for the beachhead: ${weak.factor} (${weak.score}/5). ${weakReason}`,
        ...(largest ? [] : ["The largest-TAM segment had no verifiable evidence and was excluded from the comparison."]),
        ...(researchBacked ? [] : ["The beachhead rests on the brief and diagnosis only, with no web research behind it."]),
      ];
      const validation = [winner.validation_needed, closeCallNote(winner.name, runner.name, margin)].filter(Boolean).join(" ");

      const detail: IcpReport = {
        wedge: opp.data.detail.chosen.name,
        chosen: {
          name: winner.name,
          who: winner.who,
          trigger_event: winner.trigger_event,
          accessibility_notes: winner.accessibility_notes,
          buying_committee: winner.buying_committee,
          disqualifiers: winner.disqualifiers,
          expansion_path: winner.expansion_path,
          weakest_factor: { factor: weak.factor, score: weak.score, reason: weakReason },
          evidence: winner.research.map((r) => ({ ref: r.ref, item_id: r.item_id, claim: r.claim, source_url: r.source_url })),
        },
        ranking: ranked.map((s, i) => ({
          rank: i + 1,
          name: s.name,
          is_largest_segment: s.is_largest_segment,
          normalized: s.score.normalized,
          product: s.score.product,
          scores: s.scores,
          research_backed: s.research.length > 0,
          case_against: s.case_against,
        })),
        margin_over_runner_up: margin,
        dropped_segments: dropped,
        largest_segment: largest
          ? {
              name: largest.name,
              rank: largestRank,
              why_not:
                largestRank === 1
                  ? "It was the highest-scoring segment, so the biggest segment is also the winnable one here."
                  : `Scored ${largest.score.normalized.toFixed(0)}/100 against ${winner.score.normalized.toFixed(0)}/100. ${largest.case_against}`,
            }
          : null,
      };

      return {
        recommendation: `Beachhead: ${winner.name}: ${winner.who}. Trigger: ${winner.trigger_event}`,
        rationale: `${winner.case_for} It scores ${winner.score.normalized.toFixed(0)}/100 against ${runner.name} at ${runner.score.normalized.toFixed(0)}/100 on pain x urgency x accessibility x ability to pay x fit x trigger.`,
        evidence_refs: winner.research.map((r) => r.item_id),
        assumptions,
        confidence: capConfidence(winner.confidence, { researchBacked, margin }),
        validation_needed: validation,
        alternatives_considered: ranked.slice(1).map((s) => ({
          option: s.name,
          why_not: `Scored ${s.score.normalized.toFixed(0)}/100 against ${winner.score.normalized.toFixed(0)}/100. ${s.case_against}`,
        })),
        downstream_implications: [
          winner.implication,
          `Reach them through: ${winner.accessibility_notes}`,
          `Expansion path once won: ${winner.expansion_path}`,
        ],
        detail,
      };
    },
  };
}
