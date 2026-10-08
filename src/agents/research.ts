import { randomUUID } from "node:crypto";
import { generateStructured } from "../core/llm/structured";
import type { LlmClient, SearchClient } from "../core/llm/types";
import type { Agent } from "../core/orchestrator/types";
import type { AgentInput, AgentOutput } from "../core/schemas/agent";
import { DiagnosisOutputSchema, type DiagnosisOutput } from "../core/schemas/diagnosis";
import { ResearchPlanSchema, ResearchSynthesisSchema, type ResearchReport } from "../core/schemas/research";
import type { ResearchItem } from "../core/schemas/researchItem";
import { annotateWithCitations, SourceTable } from "../core/research/citations";
import { normalizeQuery, selectQueries } from "../core/research/plan";
import { buildSystemPrompt, DoctrineSliceSchema } from "../prompts/layers";
import { planTask, SEARCH_SYSTEM, SYNTHESIS_TASK } from "../prompts/stages/research";

/** Web research is partial evidence, so confidence never reaches the top of the scale. */
export const RESEARCH_CONFIDENCE_CAP = 8;
/** With very few verified findings, confidence is capped lower still. */
export const THIN_EVIDENCE_CAP = 5;
export const THIN_EVIDENCE_FINDINGS = 5;

export interface ResearchAgentOptions {
  /** Total search budget across both rounds. Default 6. */
  maxQueries?: number;
  onProgress?: (message: string) => void;
  newId?: () => string;
}

interface SearchBlock {
  query: string;
  type: string;
  text: string;
  sourceIds: string[];
}

function diagnosisSummary(d: DiagnosisOutput, decisionId?: string): string {
  const r = d.detail;
  return [
    "DIAGNOSIS FROM THE PREVIOUS STAGE",
    `- What they are building: ${r.what_they_are_building}`,
    `- Real problem: ${r.real_problem}`,
    `- Founder framing: ${r.founder_framing.verdict} (${r.founder_framing.note})`,
    `- Solution quality: ${r.solution_quality.verdict} (${r.solution_quality.reasoning})`,
    `- Who feels it: ${r.need.who_feels_it}; today they: ${r.need.current_workaround}`,
    `- Research questions to answer:\n${r.research_questions_for_next_stage.map((q) => `    * ${q}`).join("\n")}`,
    decisionId ? `- Diagnosis decision id (use in contradicts_upstream if needed): ${decisionId}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function renderBlocks(blocks: SearchBlock[], table: SourceTable, maxChars = 2500): string {
  return blocks
    .map((b, i) => {
      const sources = b.sourceIds.map((id) => `${id} (${table.get(id)?.title ?? ""})`).join(", ");
      const text = b.text.length > maxChars ? `${b.text.slice(0, maxChars)}...` : b.text;
      return `### Search ${i + 1} [${b.type}]: ${b.query}\nSources: ${sources}\n${text}`;
    })
    .join("\n\n");
}

export function createResearchAgent(llm: LlmClient, search: SearchClient, opts: ResearchAgentOptions = {}): Agent {
  const maxQueries = Math.max(1, opts.maxQueries ?? 6);
  const say = opts.onProgress ?? (() => {});
  const newId = opts.newId ?? randomUUID;

  return {
    stage: "research",
    async run(input: AgentInput): Promise<AgentOutput> {
      const doctrine = DoctrineSliceSchema.parse(input.doctrine_slice);
      const parsedDiag = DiagnosisOutputSchema.safeParse(input.upstream_outputs["diagnosis"]);
      if (!parsedDiag.success) throw new Error("Research needs an accepted diagnosis as its input.");
      const diag = parsedDiag.data;
      const diagnosisDecisionId = input.active_decisions.find((d) => d["stage"] === "diagnosis")?.["id"] as
        | string
        | undefined;

      const table = new SourceTable();
      const blocks: SearchBlock[] = [];
      const queriesRun: ResearchReport["queries_run"] = [];
      const discarded: string[] = [];
      const done = new Set<string>();
      let category = "";
      const order = doctrine.competitor_research_order ?? [];

      const runRound = async (round: 1 | 2, budget: number) => {
        const plan = await generateStructured(llm, {
          system: buildSystemPrompt(doctrine, planTask(round, budget, order)),
          user:
            `${diagnosisSummary(diag)}\n\n` +
            (round === 2 ? `ROUND 1 FINDINGS\n${renderBlocks(blocks, table, 1500)}\n\n` : "") +
            `Plan up to ${budget} searches.`,
          schema: ResearchPlanSchema,
          maxTokens: 4000,
        });
        if (!category) category = plan.category;

        const chosen = selectQueries(plan.queries, budget, done);
        for (const [i, q] of chosen.entries()) {
          done.add(normalizeQuery(q.query));
          say(`Searching (round ${round}, ${i + 1}/${chosen.length}) [${q.type}]: ${q.query}`);
          const res = await search.search({
            system: SEARCH_SYSTEM,
            query: `${q.query}\n\nContext: the product is "${diag.detail.what_they_are_building}". Category: ${category}.`,
          });
          const ids = res.sources.map((s) => table.add(s.url, s.title));
          const used = [...new Set(ids.filter((x): x is string => x !== null))];
          // A search answer with no sources is memory, not research. Throw it away.
          if (!used.length || !res.text.trim()) {
            discarded.push(q.query);
            say("  no sources returned, result discarded");
            continue;
          }
          blocks.push({
            query: q.query,
            type: q.type,
            text: annotateWithCitations(res.text, res.supports, (idx) => ids[idx] ?? null),
            sourceIds: used,
          });
          queriesRun.push({ query: q.query, type: q.type, sources_found: used.length });
          say(`  ${used.length} source(s)`);
        }
      };

      const round1 = Math.max(1, Math.ceil(maxQueries / 3));
      await runRound(1, round1);
      if (maxQueries - round1 > 0) await runRound(2, maxQueries - round1);

      if (!blocks.length) throw new Error("No search returned sourced results, so there is nothing to base research on.");

      say("Synthesising findings...");
      const synth = await generateStructured(llm, {
        system: buildSystemPrompt(doctrine, SYNTHESIS_TASK),
        user: `${diagnosisSummary(diag, diagnosisDecisionId)}\n\nSEARCH RESULTS\n${renderBlocks(blocks, table)}`,
        schema: ResearchSynthesisSchema,
        maxTokens: 16000,
      });

      // Code, not the model, decides what counts as evidence: every citation must exist.
      const cleanIds = (ids: string[]) => [...new Set(ids.filter((id) => table.has(id)))];
      const findings = synth.findings
        .map((f) => ({ ...f, source_ids: cleanIds(f.source_ids) }))
        .filter((f) => f.source_ids.length > 0);
      const competitors = synth.competitors
        .map((c) => ({ ...c, source_ids: cleanIds(c.source_ids) }))
        .filter((c) => c.source_ids.length > 0);
      const gaps = synth.market_gaps
        .map((g) => ({ ...g, source_ids: cleanIds(g.source_ids) }))
        .filter((g) => g.source_ids.length > 0);

      if (!findings.length) throw new Error("Research produced no findings with a verifiable source.");

      const items: ResearchItem[] = findings.map((f) => {
        const primary = table.get(f.source_ids[0])!;
        return {
          id: newId(),
          claim: f.claim,
          excerpt_summary: f.summary,
          type: f.type,
          source_url: primary.url,
          source_title: primary.title,
          confidence: f.confidence,
        };
      });

      const used = new Set([...findings, ...competitors, ...gaps].flatMap((x) => x.source_ids));
      const cap = findings.length < THIN_EVIDENCE_FINDINGS ? THIN_EVIDENCE_CAP : RESEARCH_CONFIDENCE_CAP;

      // The only upstream decision research may contest is the diagnosis, and only through this channel.
      const contradicts =
        synth.contradicts_upstream && diagnosisDecisionId
          ? { ...synth.contradicts_upstream, decision_id: diagnosisDecisionId }
          : undefined;

      const detail: ResearchReport = {
        category: category || synth.category,
        queries_run: queriesRun,
        discarded_queries: discarded,
        sources: table.list().filter((s) => used.has(s.id)),
        findings: findings.map((f, i) => ({ ...f, item_id: items[i].id })),
        competitors,
        market_gaps: gaps,
        diagnosis_check: synth.diagnosis_check,
        unanswered_questions: synth.unanswered_questions,
        dropped_unsourced: {
          findings: synth.findings.length - findings.length,
          competitors: synth.competitors.length - competitors.length,
          gaps: synth.market_gaps.length - gaps.length,
        },
      };

      return {
        recommendation: synth.recommendation,
        rationale: synth.rationale,
        evidence_refs: items.map((i) => i.id),
        assumptions: synth.assumptions,
        confidence: Math.min(synth.confidence, cap),
        validation_needed: synth.validation_needed,
        alternatives_considered: synth.alternatives_considered,
        downstream_implications: synth.downstream_implications,
        ...(contradicts ? { contradicts_upstream: contradicts } : {}),
        detail,
        research_items: items,
      };
    },
  };
}
