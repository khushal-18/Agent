import { doctrineSliceForStage } from "../../src/core/doctrine/load";
import type { LlmClient } from "../../src/core/llm/types";
import { AgentInputSchema, type AgentInput } from "../../src/core/schemas/agent";
import { diagnosisJson, doctrine, fakeResearchLlm, synthJson, type FakeLlm } from "./research-fixtures";

/** Saved research items as the orchestrator hands them to later stages. */
export const savedResearch = [
  { id: "item-a", type: "complaint", claim: "Users report slow reorder alerts", summary: "s", source_url: "https://a.example", confidence: 7 },
  { id: "item-b", type: "competitor_positioning", claim: "Stocky is a free Shopify app", summary: "s", source_url: "https://b.example", confidence: 8 },
  { id: "item-c", type: "gap", claim: "No tool optimises reorder timing", summary: "s", source_url: "https://c.example", confidence: 6 },
];

const evidence = {
  sources: [{ id: "S1", url: "https://a.example", title: "A" }],
};

export const researchOutputJson = () => ({
  recommendation: "Crowded category with a timing gap.",
  rationale: "Incumbents compete on forecasts.",
  evidence_refs: ["item-a", "item-b", "item-c"],
  assumptions: [],
  confidence: 6,
  validation_needed: "Interview ops leads.",
  alternatives_considered: [{ option: "Empty market", why_not: "Incumbents exist" }],
  downstream_implications: [],
  detail: {
    category: "inventory forecasting for Shopify D2C brands",
    queries_run: [],
    discarded_queries: [],
    ...evidence,
    findings: [{ claim: "Users report slow reorder alerts", summary: "s", type: "complaint", source_ids: ["S1"], confidence: 7, item_id: "item-a" }],
    competitors: [
      { name: "Stocky", kind: "direct", positioning: "Free default", gtm: "App store", does_well: "Free", does_badly: "Basic", customer_complaints: "Slow alerts", does_not_own: "Timing", source_ids: ["S1"] },
    ],
    market_gaps: [{ gap: "Reorder timing", why_underserved: "Complaints", source_ids: ["S1"] }],
    diagnosis_check: { verdict: "refined", note: "Timing, not forecasting." },
    unanswered_questions: ["Willingness to pay"],
    dropped_unsourced: { findings: 0, competitors: 0, gaps: 0 },
  },
});

type Over = Record<string, unknown>;

const oppScores = (n: number) => ({ pain: n, urgency: n, product_fit: n, accessibility: n, result_advantage: n, expansion_potential: n });
const reasons = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, `reason for ${k}`]));

export const oppCandidate = (name: string, o: Over = {}) => ({
  name,
  use_case: `Use case for ${name}`,
  context: `Context for ${name}`,
  why_underserved: "Competitors leave it open",
  customer_advantage: `Advantage from ${name}`,
  superiority_dimension: "better_results",
  competitors_in_space: ["Stocky"],
  is_largest_market_play: false,
  scores: oppScores(3),
  competition: 3,
  reasons: reasons(["pain", "urgency", "product_fit", "accessibility", "result_advantage", "expansion_potential", "competition"]),
  evidence_ids: ["R1", "R2"],
  case_for: `Case for ${name}.`,
  case_against: `Case against ${name}.`,
  validation_needed: `Validate ${name}`,
  implication: `Implication of ${name}`,
  assumptions: [`Assumption for ${name}`],
  confidence: 7,
  ...o,
});

/** Largest-market play first on purpose: the model's order must not decide the winner. */
export const defaultOppCandidates = () => [
  oppCandidate("Every online retailer", { is_largest_market_play: true, scores: oppScores(4), competition: 5, confidence: 10 }),
  oppCandidate("Reorder timing for small Shopify brands", { scores: { ...oppScores(4), result_advantage: 5, pain: 5 }, competition: 1, confidence: 8 }),
  oppCandidate("Multi-warehouse sync", { scores: oppScores(3), competition: 3 }),
];

export const oppJson = (candidates: object[] = defaultOppCandidates()) => ({ candidates });

const icpScores = (n: number) => ({ pain: n, urgency: n, accessibility: n, ability_to_pay: n, solution_fit: n, trigger_strength: n });

export const icpSegment = (name: string, o: Over = {}) => ({
  name,
  who: `Who: ${name}`,
  trigger_event: `Trigger for ${name}`,
  accessibility_notes: `Reach ${name} via Shopify communities`,
  buying_committee: [
    { role: "economic buyer", who: "Founder", cares_about: "Margin", likely_objection: "Cost", how_to_reach: "LinkedIn" },
    { role: "user", who: "Ops lead", cares_about: "Time", likely_objection: "Setup effort", how_to_reach: "Community" },
  ],
  disqualifiers: ["Under 50 SKUs"],
  expansion_path: `Expand from ${name}`,
  is_largest_segment: false,
  scores: icpScores(3),
  reasons: reasons(["pain", "urgency", "accessibility", "ability_to_pay", "solution_fit", "trigger_strength"]),
  evidence_ids: ["R1", "R3"],
  case_for: `Case for ${name}.`,
  case_against: `Case against ${name}.`,
  validation_needed: `Validate ${name}`,
  implication: `Implication of ${name}`,
  assumptions: [`Assumption for ${name}`],
  confidence: 7,
  ...o,
});

export const defaultIcpSegments = () => [
  // High pain but nearly unreachable: the multiplicative score must punish it.
  icpSegment("Large enterprise retailers", { is_largest_segment: true, scores: { ...icpScores(5), accessibility: 1 } }),
  icpSegment("Ops leads at 2-10 person Shopify brands", { scores: icpScores(4) }),
  icpSegment("Agencies managing stores", { scores: icpScores(3) }),
];

export const icpJson = (segments: object[] = defaultIcpSegments()) => ({ segments });

export const opportunityInput = (opts: { research?: boolean; upstream?: boolean } = {}): AgentInput =>
  AgentInputSchema.parse({
    stage: "opportunity",
    objective: 'Complete the "opportunity" stage.',
    project_context: "Project: LedgerLoop",
    active_decisions: [],
    relevant_research: opts.research === false ? [] : savedResearch,
    upstream_outputs: opts.upstream === false ? {} : { diagnosis: diagnosisJson(), research: researchOutputJson() },
    constraints: {},
    doctrine_slice: doctrineSliceForStage(doctrine, "opportunity"),
  });

export const icpInput = (opportunityOutput: unknown | null): AgentInput =>
  AgentInputSchema.parse({
    stage: "icp",
    objective: 'Complete the "icp" stage.',
    project_context: "Project: LedgerLoop",
    active_decisions: [],
    relevant_research: savedResearch,
    upstream_outputs: {
      diagnosis: diagnosisJson(),
      research: researchOutputJson(),
      ...(opportunityOutput ? { opportunity: opportunityOutput } : {}),
    },
    constraints: {},
    doctrine_slice: doctrineSliceForStage(doctrine, "icp"),
  });

export interface SimpleLlm extends LlmClient {
  calls: number;
}

/** Replies with each canned string in turn (the last one repeats). */
export const sequenceLlm = (replies: unknown[]): SimpleLlm => {
  let i = 0;
  return {
    get calls() {
      return i;
    },
    async complete() {
      const r = replies[Math.min(i++, replies.length - 1)];
      return typeof r === "string" ? r : JSON.stringify(r);
    },
  };
};

/** Answers every stage the pipeline can reach, by recognising the stage in the prompt. */
export const fakeStrategyLlm = (opts: { opp?: object; icp?: object; synth?: object; diagnosisConfidence?: number } = {}): FakeLlm => {
  const base = fakeResearchLlm(opts.synth ?? synthJson(), opts.diagnosisConfidence ?? 6);
  return {
    ...base,
    async complete(args) {
      if (args.system.includes("OPPORTUNITY DISCOVERY")) return JSON.stringify(opts.opp ?? oppJson());
      if (args.system.includes("BEACHHEAD AND ICP")) return JSON.stringify(opts.icp ?? icpJson());
      return base.complete(args);
    },
  };
};
