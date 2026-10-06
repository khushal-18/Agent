import { describe, it, expect } from "vitest";
import { loadDoctrine } from "../src/core/doctrine/load";
import { scoreIcp } from "../src/core/scoring/icp";
import { scoreOpportunity, rankOpportunities } from "../src/core/scoring/opportunity";

const d = loadDoctrine("v1");
const allIcp = (n: number) => Object.fromEntries(d.icp.factors.map((f) => [f, n]));
const allOpp = (n: number) => Object.fromEntries(Object.keys(d.opportunity.weights).map((f) => [f, n]));

describe("scoreIcp", () => {
  it("scores 100 when every factor is at max and 0 at min", () => {
    expect(scoreIcp(allIcp(5), d).normalized).toBeCloseTo(100, 6);
    expect(scoreIcp(allIcp(1), d).normalized).toBeCloseTo(0, 6);
  });

  it("is multiplicative: one weak factor collapses the score", () => {
    const strongButUnreachable = { ...allIcp(5), accessibility: 1 };
    const result = scoreIcp(strongButUnreachable, d);
    expect(result.normalized).toBeCloseTo(20, 0);
    expect(result.weakest.factor).toBe("accessibility");
  });

  it("rejects missing, unknown, and out-of-range factors", () => {
    const { pain, ...missing } = allIcp(3);
    expect(() => scoreIcp(missing, d)).toThrow(/Missing ICP factor: pain/);
    expect(() => scoreIcp({ ...allIcp(3), vibes: 5 }, d)).toThrow(/Unknown ICP factor/);
    expect(() => scoreIcp({ ...allIcp(3), pain: 6 }, d)).toThrow(/between 1 and 5/);
  });
});

describe("scoreOpportunity", () => {
  it("applies competition as a penalty", () => {
    const open = scoreOpportunity({ name: "a", scores: allOpp(5), competition: 1 }, d);
    const crowded = scoreOpportunity({ name: "b", scores: allOpp(5), competition: 5 }, d);
    expect(open.total).toBeCloseTo(100, 6);
    expect(crowded.total).toBeCloseTo(100 * (1 - d.opportunity.competition_penalty), 6);
  });

  it("ranks a winnable wedge above a bigger but crowded opportunity", () => {
    const ranked = rankOpportunities(
      [
        { name: "crowded giant", scores: { ...allOpp(5) }, competition: 5 },
        { name: "winnable wedge", scores: { ...allOpp(5), expansion_potential: 3 }, competition: 1 },
      ],
      d
    );
    expect(ranked[0].name).toBe("winnable wedge");
  });

  it("rejects unknown factors", () => {
    expect(() => scoreOpportunity({ name: "x", scores: { ...allOpp(3), hype: 5 }, competition: 2 }, d)).toThrow(
      /Unknown opportunity factor/
    );
  });
});