import { generateStructured } from "../core/llm/structured";
import type { LlmClient } from "../core/llm/types";
import type { Agent } from "../core/orchestrator/types";
import type { AgentInput, AgentOutput } from "../core/schemas/agent";
import { DiagnosisOutputSchema } from "../core/schemas/diagnosis";
import {
  OpportunityLlmSchema,
  type OpportunityCandidate,
  type OpportunityReport,
} from "../core/schemas/opportunity";
import { ResearchOutputSchema } from "../core/schemas/research";
import { buildResearchRefs, checkEvidence, renderResearchRefs, type ResearchRef } from "../core/scoring/evidence";
import { scoreOpportunity, type OpportunityScore } from "../core/scoring/opportunity";
import { capConfidence, closeCallNote } from "../core/scoring/selection";
import { buildSystemPrompt, DoctrineSliceSchema } from "../prompts/layers";
import { OPPORTUNITY_TASK } from "../prompts/stages/opportunity";

type Diagnosis = ReturnType<typeof DiagnosisOutputSchema.parse>;
type Research = ReturnType<typeof ResearchOutputSchema.parse>;

function renderContext(d: Diagnosis, r: Research, refs: ResearchRef[]): string {
  const dd = d.detail;
  const rd = r.detail;
  const competitors = rd.competitors
    .map(
      (c) =>
        `- ${c.name} (${c.kind})\n    wants to own: ${c.positioning}\n    acquires customers: ${c.gtm}\n    does well: ${c.does_well}\n    does badly: ${c.does_badly}\n    customers complain: ${c.customer_complaints}\n    does not own: ${c.does_not_own}`
    )
    .join("\n");
  const gaps = rd.market_gaps.map((g) => `- ${g.gap} (why underserved: ${g.why_underserved})`).join("\n");

  return `DIAGNOSIS
- What they are building: ${dd.what_they_are_building}
- Real problem: ${dd.real_problem}
- Actual solution: ${dd.actual_solution}
- Solution quality: ${dd.solution_quality.verdict} (best dimension: ${dd.solution_quality.best_superiority_dimension}). ${dd.solution_quality.reasoning}
- Who feels it: ${dd.need.who_feels_it}. Today they: ${dd.need.current_workaround}. Cost of not solving: ${dd.need.cost_of_not_solving}.
- Known from the brief: ${dd.known_from_brief.join("; ")}

RESEARCH
Category: ${rd.category}
Research verdict on the diagnosis: ${rd.diagnosis_check.verdict}. ${rd.diagnosis_check.note}

Competitors and alternatives:
${competitors || "(none)"}

Market gaps found:
${gaps || "(none)"}

Not found in research: ${rd.unanswered_questions.join("; ") || "(nothing listed)"}

RESEARCH ITEMS YOU MAY CITE (use the aliases)
${renderResearchRefs(refs)}`;
}

export function createOpportunityAgent(llm: LlmClient): Agent {
  return {
    stage: "opportunity",
    async run(input: AgentInput): Promise<AgentOutput> {
      const slice = DoctrineSliceSchema.parse(input.doctrine_slice);
      if (!slice.opportunity) throw new Error("The doctrine slice has no opportunity scoring config.");

      const diag = DiagnosisOutputSchema.safeParse(input.upstream_outputs["diagnosis"]);
      const research = ResearchOutputSchema.safeParse(input.upstream_outputs["research"]);
      if (!diag.success || !research.success) {
        throw new Error("Opportunity discovery needs an accepted diagnosis and accepted research.");
      }
      const refs = buildResearchRefs(input.relevant_research);
      if (!refs.length) throw new Error("Opportunity discovery needs research evidence. Run the research stage first.");

      const result = await generateStructured(llm, {
        system: buildSystemPrompt(slice, OPPORTUNITY_TASK),
        user: renderContext(diag.data, research.data, refs),
        schema: OpportunityLlmSchema,
        maxTokens: 16000,
      });

      // Scoring and choosing happen in code. The model proposes and scores; it never picks the winner.
      type Scored = OpportunityCandidate & { score: OpportunityScore; research: ResearchRef[]; evidence: string[] };
      const dropped: string[] = [];
      const scored: Scored[] = [];
      for (const c of result.candidates) {
        const ev = checkEvidence(c.evidence_ids, refs);
        if (!ev.valid.length) {
          dropped.push(c.name);
          continue;
        }
        const score = scoreOpportunity({ name: c.name, scores: c.scores, competition: c.competition }, { opportunity: slice.opportunity });
        scored.push({ ...c, score, research: ev.research, evidence: ev.valid });
      }
      if (scored.length < 2) {
        throw new Error("Fewer than two opportunities had verifiable evidence, so there is nothing to compare.");
      }

      const ranked = [...scored].sort(
        (a, b) =>
          b.score.total - a.score.total ||
          b.scores.result_advantage - a.scores.result_advantage ||
          b.scores.pain - a.scores.pain ||
          a.name.localeCompare(b.name)
      );
      const winner = ranked[0];
      const runner = ranked[1];
      const margin = winner.score.total - runner.score.total;
      const researchBacked = winner.research.length > 0;

      const [weakFactor, weakScore] = Object.entries(winner.scores).sort((a, b) => a[1] - b[1])[0];
      const weakReason = (winner.reasons as Record<string, string>)[weakFactor];

      const largest = ranked.find((c) => c.is_largest_market_play);
      const largestRank = largest ? ranked.indexOf(largest) + 1 : 0;

      const assumptions = [
        ...winner.assumptions,
        `Weakest factor for the chosen wedge: ${weakFactor} (${weakScore}/5). ${weakReason}`,
        ...(largest ? [] : ["The largest-market play had no verifiable evidence and was excluded from the comparison."]),
        ...(researchBacked ? [] : ["The chosen wedge rests on the brief and diagnosis only, with no web research behind it."]),
      ];
      const validation = [winner.validation_needed, closeCallNote(winner.name, runner.name, margin)]
        .filter(Boolean)
        .join(" ");

      const detail: OpportunityReport = {
        chosen: {
          name: winner.name,
          use_case: winner.use_case,
          context: winner.context,
          why_underserved: winner.why_underserved,
          customer_advantage: winner.customer_advantage,
          superiority_dimension: winner.superiority_dimension,
          competitors_in_space: winner.competitors_in_space,
          weakest_factor: { factor: weakFactor, score: weakScore, reason: weakReason },
          evidence: winner.research.map((r) => ({ ref: r.ref, item_id: r.item_id, claim: r.claim, source_url: r.source_url })),
        },
        ranking: ranked.map((c, i) => ({
          rank: i + 1,
          name: c.name,
          is_largest_market_play: c.is_largest_market_play,
          total: c.score.total,
          weighted: c.score.weighted,
          penalty_pct: c.score.penaltyFraction * 100,
          competition: c.competition,
          scores: c.scores,
          research_backed: c.research.length > 0,
          case_against: c.case_against,
        })),
        margin_over_runner_up: margin,
        dropped_candidates: dropped,
        largest_market_play: largest
          ? {
              name: largest.name,
              rank: largestRank,
              why_not:
                largestRank === 1
                  ? "It was the highest-scoring option, so the biggest market is also the winnable one here."
                  : `Scored ${largest.score.total.toFixed(0)}/100 against ${winner.score.total.toFixed(0)}/100. ${largest.case_against}`,
            }
          : null,
      };

      return {
        recommendation: `Win "${winner.name}" first: ${winner.use_case} (${winner.context}).`,
        rationale: `${winner.case_for} Advantage to the customer: ${winner.customer_advantage} It scores ${winner.score.total.toFixed(0)}/100 against ${runner.name} at ${runner.score.total.toFixed(0)}/100, after a ${(winner.score.penaltyFraction * 100).toFixed(0)}% competition penalty.`,
        evidence_refs: winner.research.map((r) => r.item_id),
        assumptions,
        confidence: capConfidence(winner.confidence, { researchBacked, margin }),
        validation_needed: validation,
        alternatives_considered: ranked.slice(1).map((c) => ({
          option: c.name,
          why_not: `Scored ${c.score.total.toFixed(0)}/100 against ${winner.score.total.toFixed(0)}/100. ${c.case_against}`,
        })),
        downstream_implications: [winner.implication],
        detail,
      };
    },
  };
}
