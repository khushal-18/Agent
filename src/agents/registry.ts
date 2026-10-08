import type { LlmClient, SearchClient } from "../core/llm/types";
import type { Agent } from "../core/orchestrator/types";
import { STAGES, type Stage } from "../core/schemas/stages";
import { createDiagnosisAgent } from "./diagnosis";
import { createIntakeAgent } from "./intake";
import { createResearchAgent, type ResearchAgentOptions } from "./research";
import { createStubAgent } from "./stub";

/** Real agents where they exist; stubs for stages not built yet. Swap one line as each agent lands. */
export function buildAgents(
  llm: LlmClient,
  search?: SearchClient,
  research: ResearchAgentOptions = {}
): Record<Stage, Agent> {
  const agents = Object.fromEntries(STAGES.map((s) => [s, createStubAgent(s)])) as Record<Stage, Agent>;
  agents.intake = createIntakeAgent();
  agents.diagnosis = createDiagnosisAgent(llm);
  if (search) agents.research = createResearchAgent(llm, search, research);
  return agents;
}
