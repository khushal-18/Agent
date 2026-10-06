import { describe, it, expect } from "vitest";
import { DecisionSchema } from "../src/core/schemas/decision";
import { AgentOutputSchema } from "../src/core/schemas/agent";

const validDecision = {
  decision: "Target Series A D2C companies",
  stage: "icp",
  rationale: "High inventory pain, strong ability to pay, reachable on LinkedIn",
  evidence: [],
  rejected_options: [{ option: "Enterprise retail", reason: "Long sales cycle, low initial accessibility" }],
  assumptions: ["Inventory pain creates a buying trigger"],
  confidence: 7,
  validation_needed: "Is the pain strong enough to trigger a purchase?",
  downstream_implications: ["Positioning must speak to ops/finance leads"],
};

describe("DecisionSchema", () => {
  it("accepts a valid decision", () => {
    expect(DecisionSchema.safeParse(validDecision).success).toBe(true);
  });
  it("rejects a decision with no rejected alternatives (Law 10)", () => {
    expect(DecisionSchema.safeParse({ ...validDecision, rejected_options: [] }).success).toBe(false);
  });
  it("rejects confidence outside 1-10", () => {
    expect(DecisionSchema.safeParse({ ...validDecision, confidence: 11 }).success).toBe(false);
  });
  it("rejects an unknown stage", () => {
    expect(DecisionSchema.safeParse({ ...validDecision, stage: "vibes" }).success).toBe(false);
  });
});

describe("AgentOutputSchema", () => {
  it("allows contradicts_upstream only in the explicit shape", () => {
    const base = {
      recommendation: "x", rationale: "y", evidence_refs: [], assumptions: [], confidence: 5,
      alternatives_considered: [{ option: "a", why_not: "b" }], downstream_implications: [],
    };
    expect(AgentOutputSchema.safeParse(base).success).toBe(true);
    expect(AgentOutputSchema.safeParse({ ...base, contradicts_upstream: { decision_id: "d1" } }).success).toBe(false);
  });
});