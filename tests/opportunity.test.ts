import { describe, it, expect } from "vitest";
import { createOpportunityAgent } from "../src/agents/opportunity";
import { OpportunityScoresSchema } from "../src/core/schemas/opportunity";
import { IcpScoresSchema } from "../src/core/schemas/icp";
import { OpportunityOutputSchema } from "../src/core/schemas/opportunity";
import { CLOSE_CALL_CAP, CONFIDENCE_CAP, NOT_RESEARCH_BACKED_CAP } from "../src/core/scoring/selection";
import { checkEvidence, buildResearchRefs } from "../src/core/scoring/evidence";
import { doctrine } from "./helpers/research-fixtures";
import { defaultOppCandidates, oppCandidate, oppJson, opportunityInput, savedResearch, sequenceLlm } from "./helpers/strategy-fixtures";

const run = (candidates: object[] = defaultOppCandidates(), input = opportunityInput()) =>
  createOpportunityAgent(sequenceLlm([oppJson(candidates)])).run(input);

describe("opportunity agent", () => {
  it("lets the code, not the model's ordering or confidence, pick the winner", async () => {
    const out = await run();
    const d = OpportunityOutputSchema.parse(out).detail;

    expect(d.chosen.name).toBe("Reorder timing for small Shopify brands");
    expect(out.recommendation).toContain("Reorder timing for small Shopify brands");
    expect(d.ranking.map((r) => r.rank)).toEqual([1, 2, 3]);
    // The model listed the largest-market play first and gave it confidence 10. It still loses.
    expect(d.largest_market_play!.rank).toBeGreaterThan(1);
    expect(d.largest_market_play!.why_not).toMatch(/Scored \d+\/100 against \d+\/100/);
    expect(out.alternatives_considered.map((a) => a.option)).not.toContain("Reorder timing for small Shopify brands");
    expect(out.alternatives_considered).toHaveLength(2);
  });

  it("applies competition as a penalty visible in the ranking", async () => {
    const d = OpportunityOutputSchema.parse(await run()).detail;
    const crowded = d.ranking.find((r) => r.is_largest_market_play)!;
    expect(crowded.penalty_pct).toBeCloseTo(doctrine.opportunity.competition_penalty * 100, 5);
  });

  it("breaks exact ties on result advantage", async () => {
    const out = await run([
      oppCandidate("Crowd pleaser", { is_largest_market_play: true, scores: { pain: 3, urgency: 3, product_fit: 5, accessibility: 3, result_advantage: 3, expansion_potential: 3 } }),
      oppCandidate("Results winner", { scores: { pain: 3, urgency: 3, product_fit: 3, accessibility: 3, result_advantage: 5, expansion_potential: 3 } }),
      oppCandidate("Filler", { scores: { pain: 1, urgency: 1, product_fit: 1, accessibility: 1, result_advantage: 1, expansion_potential: 1 } }),
    ]);
    expect(OpportunityOutputSchema.parse(out).detail.chosen.name).toBe("Results winner");
  });

  it("deletes candidates whose evidence does not exist and ignores invented ids", async () => {
    const out = await run([
      oppCandidate("Invented support", { is_largest_market_play: true, evidence_ids: ["R99", "made-up"] }),
      oppCandidate("Real wedge", { scores: { pain: 5, urgency: 5, product_fit: 5, accessibility: 5, result_advantage: 5, expansion_potential: 5 }, competition: 1, evidence_ids: ["R2", "R99", "[R1]"] }),
      oppCandidate("Other", { evidence_ids: ["r3"] }),
    ]);
    const d = OpportunityOutputSchema.parse(out).detail;
    expect(d.dropped_candidates).toEqual(["Invented support"]);
    expect(d.largest_market_play).toBeNull();
    expect(out.assumptions.join(" ")).toMatch(/largest-market play had no verifiable evidence/);
    // Aliases map back to real research item ids, in the order cited.
    expect(out.evidence_refs).toEqual(["item-b", "item-a"]);
  });

  it("refuses to choose when fewer than two candidates have evidence", async () => {
    const bad = [
      oppCandidate("A", { is_largest_market_play: true, evidence_ids: ["R50"] }),
      oppCandidate("B", { evidence_ids: ["R51"] }),
      oppCandidate("C", { evidence_ids: ["R2"] }),
    ];
    await expect(run(bad)).rejects.toThrow(/Fewer than two opportunities/);
  });

  it("needs research and upstream stages", async () => {
    await expect(run(defaultOppCandidates(), opportunityInput({ research: false }))).rejects.toThrow(/needs research evidence/);
    await expect(run(defaultOppCandidates(), opportunityInput({ upstream: false }))).rejects.toThrow(/needs an accepted diagnosis/);
  });

  it("caps confidence: never above 8, 5 without research, 6 on a close call", async () => {
    expect((await run()).confidence).toBe(CONFIDENCE_CAP);

    const noResearch = await run([
      oppCandidate("Big", { is_largest_market_play: true, scores: { pain: 2, urgency: 2, product_fit: 2, accessibility: 2, result_advantage: 2, expansion_potential: 2 } }),
      oppCandidate("Brief only", { scores: { pain: 5, urgency: 5, product_fit: 5, accessibility: 5, result_advantage: 5, expansion_potential: 5 }, competition: 1, evidence_ids: ["brief"], confidence: 10 }),
      oppCandidate("Other"),
    ]);
    expect(noResearch.confidence).toBe(NOT_RESEARCH_BACKED_CAP);
    expect(noResearch.assumptions.join(" ")).toMatch(/no web research behind it/);

    const close = await run([
      oppCandidate("Twin one", { is_largest_market_play: true, confidence: 10 }),
      oppCandidate("Twin two", { scores: { ...oppCandidate("x").scores, pain: 4, urgency: 2 } }),
      oppCandidate("Other", { scores: { pain: 1, urgency: 1, product_fit: 1, accessibility: 1, result_advantage: 1, expansion_potential: 1 } }),
    ]);
    expect(close.confidence).toBeLessThanOrEqual(CLOSE_CALL_CAP);
    expect(close.validation_needed).toMatch(/Close call/);
  });

  it("names the weakest factor of the chosen wedge as an assumption", async () => {
    const out = await run([
      oppCandidate("Big", { is_largest_market_play: true, competition: 5 }),
      oppCandidate("Lopsided", { scores: { pain: 5, urgency: 5, product_fit: 5, accessibility: 2, result_advantage: 5, expansion_potential: 5 }, competition: 1 }),
      oppCandidate("Other", { scores: { pain: 2, urgency: 2, product_fit: 2, accessibility: 2, result_advantage: 2, expansion_potential: 2 } }),
    ]);
    expect(out.assumptions.join(" ")).toMatch(/Weakest factor for the chosen wedge: accessibility \(2\/5\)/);
  });

  it("retries when the model flags no (or several) largest-market plays", async () => {
    const none = defaultOppCandidates().map((c) => ({ ...c, is_largest_market_play: false }));
    const llm = sequenceLlm([oppJson(none), oppJson()]);
    await createOpportunityAgent(llm).run(opportunityInput());
    expect(llm.calls).toBe(2);
  });
});

describe("scoring schemas stay in sync with the doctrine", () => {
  it("opportunity score keys equal doctrine weights, ICP keys equal doctrine factors", () => {
    expect(Object.keys(OpportunityScoresSchema.shape).sort()).toEqual(Object.keys(doctrine.opportunity.weights).sort());
    expect(Object.keys(IcpScoresSchema.shape).sort()).toEqual([...doctrine.icp.factors].sort());
  });
});

describe("evidence helpers", () => {
  const refs = buildResearchRefs(savedResearch);
  it("aliases items in order and validates citations", () => {
    expect(refs.map((r) => r.ref)).toEqual(["R1", "R2", "R3"]);
    const res = checkEvidence(["R2", "[R1]", "r3", "R2", "R9", "Brief", "nonsense"], refs);
    expect(res.valid).toEqual(["R2", "R1", "R3", "brief"]);
    expect(res.research.map((r) => r.item_id)).toEqual(["item-b", "item-a", "item-c"]);
  });
});
