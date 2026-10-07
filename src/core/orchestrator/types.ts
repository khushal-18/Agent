import type { AgentInput, AgentOutput } from "../schemas/agent";
import type { Stage } from "../schemas/stages";
import type { Doctrine } from "../doctrine/load";
import type { Db } from "../../db/client";

/** Agents are modular and replaceable: anything that satisfies this can be plugged in. */
export interface Agent {
  stage: Stage;
  run(input: AgentInput): Promise<AgentOutput>;
}

export interface Deps {
  db: Db;
  doctrine: Doctrine;
  agents: Record<Stage, Agent>;
}

export type StageResult =
  | { status: "awaiting_user"; stage: Stage; runId: string; decisionId: string; flaggedStages: Stage[] }
  | { status: "revision_requested"; stage: Stage; runId: string; contradiction: NonNullable<AgentOutput["contradicts_upstream"]> };

export interface PipelineResult {
  completed: Stage[];
  halted?: { stage: Stage; reason: "awaiting_user" | "revision_requested" };
}