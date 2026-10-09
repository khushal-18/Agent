import { describe, it, expect } from "vitest";
import { createIcpAgent } from "../src/agents/icp";
import { createOpportunityAgent } from "../src/agents/opportunity";
import { IcpOutputSchema } from "../src/core/schemas/icp";
import { defaultIcpSegments, icpInput, icpJson, icpSegment, oppJson, opportunityInput, sequenceLlm } from "./helpers/strategy-fixtures";

const opportunityOutput = () => createOpportunityAgent(sequenceLlm([oppJson()])).run(opportunityInput());
const run = async (segments: object[] = defaultIcpSegments(), opp: unknown | null = undefined) =>
  createIcpAgent(sequenceLlm([icpJson(segments)])).run(icpInput(opp === undefined ? await opportunityOutput() : opp));

describe("icp agent", () => {
  it("multiplies the factors, so a high-pain but unreachable segment loses to a balanced one", async () => {
    const out = await run();
    const d = IcpOutputSchema.parse(out).detail;

    expect(d.chosen.name).toBe("Ops leads at 2-10 person Shopify brands");
    const giant = d.ranking.find((r) => r.is_largest_segment)!;
    expect(giant.rank).toBeGreaterThan(1);
    expect(giant.scores["accessibility"]).toBe(1);
    expect(d.largest_segment!.why_not).toMatch(/Scored \d+\/100 against \d+\/100/);
  });

  it("produces the beachhead, trigger, buyer map and disqualifiers", async () => {
    const out = await run();
    const d = IcpOutputSchema.parse(out).detail;
    expect(out.recommendation).toMatch(/^Beachhead: Ops leads/);
    expect(out.recommendation).toMatch(/Trigger: Trigger for/);
    expect(d.chosen.buying_committee.map((b) => b.role)).toEqual(["economic buyer", "user"]);
    expect(d.chosen.disqualifiers).toEqual(["Under 50 SKUs"]);
    expect(d.wedge).toBe("Reorder timing for small Shopify brands");
    expect(out.downstream_implications.join(" ")).toMatch(/Reach them through/);
  });

  it("records the weakest factor and deletes segments without verifiable evidence", async () => {
    const out = await run([
      icpSegment("Ghost segment", { is_largest_segment: true, evidence_ids: ["R42"] }),
      icpSegment("Hard to trigger", { scores: { pain: 5, urgency: 4, accessibility: 4, ability_to_pay: 4, solution_fit: 5, trigger_strength: 2 } }),
      icpSegment("Plain"),
    ]);
    const d = IcpOutputSchema.parse(out).detail;
    expect(d.dropped_segments).toEqual(["Ghost segment"]);
    expect(d.largest_segment).toBeNull();
    expect(d.chosen.weakest_factor.factor).toBe("trigger_strength");
    expect(out.assumptions.join(" ")).toMatch(/Weakest factor for the beachhead: trigger_strength \(2\/5\)/);
  });

  it("needs the opportunity stage first", async () => {
    await expect(run(defaultIcpSegments(), null)).rejects.toThrow(/needs accepted diagnosis, research and opportunity/);
  });

  it("only cites real research ids as evidence", async () => {
    const out = await run();
    expect(out.evidence_refs.every((id) => ["item-a", "item-b", "item-c"].includes(id))).toBe(true);
  });
});
