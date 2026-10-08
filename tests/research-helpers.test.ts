import { describe, it, expect } from "vitest";
import { annotateWithCitations, SourceTable } from "../src/core/research/citations";
import { selectQueries } from "../src/core/research/plan";
import { RESEARCH_TYPES as SCHEMA_TYPES } from "../src/core/schemas/researchItem";
import { RESEARCH_TYPES as DB_TYPES } from "../src/db/schema";

describe("SourceTable", () => {
  it("gives stable ids, dedupes by URL, and rejects blank URLs", () => {
    const t = new SourceTable();
    expect(t.add("https://a.com", "A")).toBe("S1");
    expect(t.add("https://b.com", "B")).toBe("S2");
    expect(t.add("https://a.com", "A again")).toBe("S1");
    expect(t.add("  ", "nothing")).toBeNull();
    expect(t.list()).toHaveLength(2);
    expect(t.has("S2")).toBe(true);
    expect(t.has("S9")).toBe(false);
  });
});

describe("annotateWithCitations", () => {
  const ids = ["S1", "S2"];
  const idFor = (i: number) => ids[i] ?? null;

  it("inserts markers after the supported text", () => {
    const out = annotateWithCitations("Hello world. Bye.", [{ endIndex: 12, sourceIndices: [0, 1] }], idFor);
    expect(out).toBe("Hello world. [S1, S2] Bye.");
  });

  it("uses UTF-8 byte offsets and never splits a multi-byte character", () => {
    // "₹" is 3 bytes, so "₹5 plan." is 10 bytes.
    expect(annotateWithCitations("₹5 plan. Free tier.", [{ endIndex: 10, sourceIndices: [0] }], idFor)).toBe("₹5 plan. [S1] Free tier.");
    // An offset inside the character is moved back to a safe boundary instead of corrupting the text.
    const out = annotateWithCitations("₹5", [{ endIndex: 1, sourceIndices: [0] }], idFor);
    expect(out).not.toContain("\uFFFD");
    expect(out).toContain("₹5");
  });

  it("merges markers at the same position, skips unknown sources, and clamps overlong offsets", () => {
    const out = annotateWithCitations(
      "Claim.",
      [
        { endIndex: 6, sourceIndices: [0] },
        { endIndex: 6, sourceIndices: [0, 1] },
        { endIndex: 6, sourceIndices: [7] },
        { endIndex: 999, sourceIndices: [1] },
      ],
      idFor
    );
    expect(out).toBe("Claim. [S1, S2]");
  });

  it("returns the text unchanged when there are no supports", () => {
    expect(annotateWithCitations("Plain text.", [], idFor)).toBe("Plain text.");
  });
});

describe("selectQueries", () => {
  const q = (query: string, type: string) => ({ query, type });

  it("spreads the budget across research types in priority order", () => {
    const picked = selectQueries(
      [q("a1", "competitor_positioning"), q("a2", "competitor_positioning"), q("a3", "competitor_positioning"), q("b", "gtm"), q("c", "complaint")],
      3
    );
    expect(picked.map((p) => p.query)).toEqual(["a1", "b", "c"]);
  });

  it("skips duplicates and queries that already ran", () => {
    const picked = selectQueries([q("Best  tools", "gtm"), q("best tools", "gtm"), q("new one", "gap"), q("old one", "gap")], 5, new Set(["old one"]));
    expect(picked.map((p) => p.query)).toEqual(["Best  tools", "new one"]);
  });

  it("never exceeds the budget", () => {
    const many = Array.from({ length: 20 }, (_, i) => q(`q${i}`, "market"));
    expect(selectQueries(many, 4)).toHaveLength(4);
  });
});

describe("research types", () => {
  it("are identical in the schema layer and the database layer", () => {
    expect([...DB_TYPES]).toEqual([...SCHEMA_TYPES]);
  });
});
