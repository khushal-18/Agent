import type { Agent } from "../core/orchestrator/types";

/**
 * Intake is a deterministic pass-through for now: it records that the brief was captured.
 * Missing information is surfaced by the diagnosis stage as explicit unknowns instead.
 */
export function createIntakeAgent(): Agent {
  return {
    stage: "intake",
    async run(input) {
      const chars = input.project_context.length;
      return {
        recommendation: `Brief captured and passed to diagnosis (${chars} characters of context).`,
        rationale: "The brief is accepted as written. Gaps are handled in diagnosis as explicit unknowns.",
        evidence_refs: [],
        assumptions: ["The brief reflects the founder's own framing and may contain hype."],
        confidence: 10,
        validation_needed: "Confirm the brief is complete enough to diagnose.",
        alternatives_considered: [
          { option: "Ask clarifying questions before diagnosing", why_not: "Diagnosis lists unknowns explicitly, which is faster for the MVP." },
        ],
        downstream_implications: ["Diagnosis must strip founder hype and test the framing."],
      };
    },
  };
}
