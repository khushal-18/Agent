import { generateStructured } from "../core/llm/structured";
import type { LlmClient } from "../core/llm/types";
import type { Agent } from "../core/orchestrator/types";
import type { AgentOutput } from "../core/schemas/agent";
import { DiagnosisOutputSchema } from "../core/schemas/diagnosis";
import { buildSystemPrompt, DoctrineSliceSchema, renderContext } from "../prompts/layers";
import { DIAGNOSIS_TASK } from "../prompts/stages/diagnosis";

/** Without external research, a brief-only diagnosis cannot honestly claim high confidence. */
export const NO_RESEARCH_CONFIDENCE_CAP = 7;

export function createDiagnosisAgent(llm: LlmClient): Agent {
  return {
    stage: "diagnosis",
    async run(input): Promise<AgentOutput> {
      const doctrine = DoctrineSliceSchema.parse(input.doctrine_slice);
      const result = await generateStructured(llm, {
        system: buildSystemPrompt(doctrine, DIAGNOSIS_TASK),
        user: renderContext(input),
        schema: DiagnosisOutputSchema,
        maxTokens: 12000,
      });

      // Judgment comes from the model; the honesty guardrail is enforced in code.
      const confidence =
        input.relevant_research.length === 0
          ? Math.min(result.confidence, NO_RESEARCH_CONFIDENCE_CAP)
          : result.confidence;

      return { ...result, confidence };
    },
  };
}
