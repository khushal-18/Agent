import type { Agent } from "../core/orchestrator/types";
import type { AgentOutput } from "../core/schemas/agent";
import type { Stage } from "../core/schemas/stages";

/** Placeholder agent: lets the whole pipeline run before any real agent exists. */
export function createStubAgent(stage: Stage, overrides: Partial<AgentOutput> = {}): Agent {
  return {
    stage,
    async run(input) {
      const note = input.constraints["challenge_note"];
      return {
        recommendation: `[stub] ${stage} recommendation${note ? ` (revised after: ${String(note)})` : ""}`,
        rationale: `[stub] rationale for ${stage}`,
        evidence_refs: [],
        assumptions: [`[stub] assumption for ${stage}`],
        confidence: 5,
        validation_needed: `[stub] what to validate for ${stage}`,
        alternatives_considered: [{ option: `[stub] alternative to ${stage}`, why_not: "[stub] weaker fit" }],
        downstream_implications: [],
        ...overrides,
      };
    },
  };
}