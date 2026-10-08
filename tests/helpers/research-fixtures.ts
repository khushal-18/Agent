import { loadDoctrine, doctrineSliceForStage } from "../../src/core/doctrine/load";
import type { GroundedResult, LlmClient, SearchClient } from "../../src/core/llm/types";
import { AgentInputSchema } from "../../src/core/schemas/agent";

export const doctrine = loadDoctrine("v1");

export const diagnosisJson = (confidence = 6) => ({
  recommendation: "The real problem is stockout-driven lost sales. Solution quality is unproven.",
  rationale: "Founders frame it as forecasting; the brief only shows reorder alerts.",
  evidence_refs: [],
  assumptions: ["Prototype users are representative"],
  confidence,
  validation_needed: "Do pilot brands reorder differently because of alerts?",
  alternatives_considered: [{ option: "Forecasting accuracy is the problem", why_not: "No accuracy evidence" }],
  downstream_implications: ["ICP defined by reorder pain"],
  detail: {
    what_they_are_building: "A Shopify plugin that emails reorder alerts per SKU.",
    hype_removed: [{ claim: "AI-powered", why_it_is_not_differentiation: "Buyers want fewer stockouts" }],
    actual_solution: "Per-SKU reorder timing alerts.",
    real_problem: "Small D2C teams find out about stockouts after sales are lost.",
    founder_framing: { verdict: "partly_off", note: "Market is not every online retailer." },
    need: { who_feels_it: "Ops leads", current_workaround: "Spreadsheets", cost_of_not_solving: "Lost sales", why_now: "Ad costs" },
    solution_quality: { verdict: "unproven", best_superiority_dimension: "better_results", reasoning: "No measured outcomes.", what_would_make_it_superior: "Show fewer stockouts." },
    known_from_brief: ["3 pilot brands"],
    unknowns: [{ question: "Did stockouts fall?", why_it_matters: "Core claim", how_to_find_out: "Interview pilots" }],
    research_questions_for_next_stage: ["Which tools do Shopify D2C brands use for reordering?"],
  },
});

export const DIAGNOSIS_DECISION_ID = "diag-decision-1";

export const researchInput = (opts: { withDiagnosis?: boolean; withDecision?: boolean } = {}) =>
  AgentInputSchema.parse({
    stage: "research",
    objective: 'Complete the "research" stage for project "LedgerLoop".',
    project_context: "Project: LedgerLoop\n\nBrief:\nAI inventory forecasting for D2C brands.",
    active_decisions:
      opts.withDecision === false ? [] : [{ id: DIAGNOSIS_DECISION_ID, stage: "diagnosis", decision: "Stockouts", rationale: "", confidence: 6 }],
    relevant_research: [],
    upstream_outputs: opts.withDiagnosis === false ? {} : { diagnosis: diagnosisJson() },
    constraints: {},
    doctrine_slice: doctrineSliceForStage(doctrine, "research"),
  });

const plan = (round: 1 | 2) => ({
  category: "inventory forecasting for Shopify D2C brands",
  queries:
    round === 1
      ? [
          { query: "best inventory forecasting apps for Shopify", type: "competitor_positioning", why: "find incumbents" },
          { query: "inventory spreadsheet vs app small brands", type: "gtm", why: "status quo" },
          { query: "inventory app reviews complaints", type: "complaint", why: "pain" },
        ]
      : [
          { query: "best inventory forecasting apps for Shopify", type: "competitor_positioning", why: "duplicate of round 1" },
          { query: "Stocky shopify app complaints", type: "complaint", why: "specific" },
          { query: "Inventory Planner pricing and customers", type: "gtm", why: "specific" },
          { query: "underserved needs of small shopify brands inventory", type: "gap", why: "gaps" },
        ],
});

export interface SynthOptions {
  findings?: object[];
  competitors?: object[];
  gaps?: object[];
  confidence?: number;
  contradicts?: object;
}

export const synthJson = (o: SynthOptions = {}) => ({
  recommendation: "The category is crowded with free incumbents; a wedge must come from complaint-driven gaps.",
  rationale: "Incumbents compete on forecasting, while reviews complain about slow reorder signals.",
  assumptions: ["Public reviews represent buyers"],
  confidence: o.confidence ?? 10,
  validation_needed: "Interview five ops leads about reorder timing.",
  alternatives_considered: [{ option: "Market is empty", why_not: "Several incumbents exist" }],
  downstream_implications: ["ICP must be defined by reorder pain"],
  category: "inventory forecasting for Shopify D2C brands",
  findings: o.findings ?? [
    { claim: "Stocky is a free Shopify app", summary: "Free inventory app from Shopify", type: "competitor_positioning", source_ids: ["S1"], confidence: 8 },
    { claim: "Users report slow reorder alerts", summary: "Reviews mention late alerts", type: "complaint", source_ids: ["S1", "S99"], confidence: 6 },
    { claim: "Made-up claim with a fake source", summary: "Nothing backs this", type: "gap", source_ids: ["S99"], confidence: 9 },
  ],
  competitors: o.competitors ?? [
    { name: "Stocky", kind: "direct", positioning: "Free default", gtm: "Shopify app store", does_well: "Free", does_badly: "Basic forecasts", customer_complaints: "Slow alerts", does_not_own: "Timing", source_ids: ["S2"] },
    { name: "Ghost Corp", kind: "indirect", positioning: "?", gtm: "?", does_well: "?", does_badly: "?", customer_complaints: "?", does_not_own: "?", source_ids: ["S99"] },
  ],
  market_gaps: o.gaps ?? [{ gap: "No tool optimises reorder timing", why_underserved: "Complaints cluster on alerts", source_ids: ["S1"] }],
  diagnosis_check: { verdict: "refined", note: "Pain is timing, not forecasting." },
  unanswered_questions: ["Actual willingness to pay"],
  ...(o.contradicts ? { contradicts_upstream: o.contradicts } : {}),
});

export interface FakeLlm extends LlmClient {
  systems: string[];
  users: string[];
}

/** Answers by looking at which stage the prompt is for. */
export const fakeResearchLlm = (synth: object = synthJson(), diagnosisConfidence = 6): FakeLlm => {
  const systems: string[] = [];
  const users: string[] = [];
  return {
    systems,
    users,
    async complete({ system, messages }) {
      systems.push(system);
      users.push(messages[0].content);
      if (system.includes("RESEARCH PLANNING")) return JSON.stringify(plan(system.includes("ROUND 1") ? 1 : 2));
      if (system.includes("RESEARCH SYNTHESIS")) return JSON.stringify(synth);
      if (system.includes("STAGE: DIAGNOSIS")) return JSON.stringify(diagnosisJson(diagnosisConfidence));
      throw new Error("unexpected prompt");
    },
  };
};

export interface FakeSearch extends SearchClient {
  queries: string[];
}

export const fakeSearch = (): FakeSearch => {
  const queries: string[] = [];
  return {
    queries,
    async search({ query }): Promise<GroundedResult> {
      queries.push(query);
      if (query.includes("NOSOURCE")) return { text: "Unsourced memory.", searchQueries: [], sources: [], supports: [] };
      return {
        text: "Stocky is a free Shopify app. Reviews mention slow alerts.",
        searchQueries: [],
        sources: [
          { url: "https://a.example/stocky", title: "Stocky" },
          { url: "https://b.example/reviews", title: "Reviews" },
        ],
        supports: [{ endIndex: 29, sourceIndices: [0] }],
      };
    },
  };
};
