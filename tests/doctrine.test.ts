import { describe, it, expect } from "vitest";
import { loadDoctrine, doctrineSliceForStage } from "../src/core/doctrine/load";

describe("doctrine", () => {
  const d = loadDoctrine("v1");

  it("loads 10 laws and a ranked hierarchy", () => {
    expect(d.laws).toHaveLength(10);
    expect(d.superiority_hierarchy[0].name).toBe("Better results");
  });

  it("opportunity weights sum to 1", () => {
    const sum = Object.values(d.opportunity.weights).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 9);
  });

  it("stage slices always include law 10", () => {
    for (const stage of ["diagnosis", "opportunity", "gtm"] as const) {
      expect(doctrineSliceForStage(d, stage).laws.some((l) => l.id === 10)).toBe(true);
    }
  });

  it("opportunity slice includes the winnable-wedge law", () => {
    expect(doctrineSliceForStage(d, "opportunity").laws.some((l) => l.id === 3)).toBe(true);
  });
});