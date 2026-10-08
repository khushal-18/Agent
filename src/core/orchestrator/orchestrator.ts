import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { projects, researchItems, stageRuns } from "../../db/schema";
import { doctrineSliceForStage } from "../doctrine/load";
import {
  getActiveDecisionsForStage,
  getLiveDecisionsForStage,
  getProject,
  listDecisions,
  recordDecision,
  reviseDecision,
} from "../memory/ledger";
import { AgentInputSchema, AgentOutputSchema, type AgentOutput } from "../schemas/agent";
import type { Decision } from "../schemas/decision";
import { STAGES, type Stage } from "../schemas/stages";
import type { Deps, PipelineResult, StageResult } from "./types";

type StageRunRow = typeof stageRuns.$inferSelect;
type Committed = Extract<StageResult, { status: "awaiting_user" }>;

export async function latestRun(deps: Deps, projectId: string, stage: Stage): Promise<StageRunRow | undefined> {
  const [row] = await deps.db
    .select()
    .from(stageRuns)
    .where(and(eq(stageRuns.projectId, projectId), eq(stageRuns.stage, stage)))
    .orderBy(desc(stageRuns.runNumber))
    .limit(1);
  return row;
}

function toDecision(stage: Stage, o: AgentOutput): Decision {
  return {
    decision: o.recommendation,
    stage,
    rationale: o.rationale,
    evidence: o.evidence_refs,
    rejected_options: o.alternatives_considered.map((a) => ({ option: a.option, reason: a.why_not })),
    assumptions: o.assumptions,
    confidence: o.confidence,
    validation_needed: o.validation_needed,
    downstream_implications: o.downstream_implications,
  };
}

/** Sourced facts gathered by research are saved so every later stage can cite them. */
async function saveResearchItems(deps: Deps, projectId: string, stage: Stage, output: AgentOutput): Promise<void> {
  if (!output.research_items?.length) return;
  await deps.db.insert(researchItems).values(
    output.research_items.map((i) => ({
      id: i.id,
      projectId,
      stage,
      sourceUrl: i.source_url,
      claim: i.claim,
      excerptSummary: i.excerpt_summary,
      type: i.type,
      confidence: i.confidence,
    }))
  );
}

/**
 * The orchestrator, not the agent, assembles the context packet.
 * Agents only ever see what they are given here.
 */
async function buildInput(deps: Deps, projectId: string, stage: Stage, challengeNote?: string) {
  const project = await getProject(deps.db, projectId);
  const active = await listDecisions(deps.db, projectId, "active");

  const upstream: Record<string, unknown> = {};
  for (const s of STAGES.slice(0, STAGES.indexOf(stage))) {
    const run = await latestRun(deps, projectId, s);
    if (run) upstream[s] = run.output;
  }

  const research = await deps.db
    .select()
    .from(researchItems)
    .where(eq(researchItems.projectId, projectId))
    .orderBy(desc(researchItems.createdAt))
    .limit(80);

  return AgentInputSchema.parse({
    stage,
    objective: `Complete the "${stage}" stage for project "${project.name}".`,
    project_context: `Project: ${project.name}\n\nBrief:\n${project.briefRaw}`,
    active_decisions: active.map((d) => ({
      id: d.id,
      stage: d.stage,
      decision: d.decision,
      rationale: d.rationale,
      confidence: d.confidence,
    })),
    relevant_research: research.map((r) => ({
      id: r.id,
      type: r.type,
      claim: r.claim,
      summary: r.excerptSummary,
      source_url: r.sourceUrl,
      confidence: r.confidence,
    })),
    upstream_outputs: upstream,
    constraints: { ...project.constraints, ...(challengeNote ? { challenge_note: challengeNote } : {}) },
    doctrine_slice: doctrineSliceForStage(deps.doctrine, stage),
  });
}

/** Writes the stage's decision to the ledger (superseding the previous one) and links it upstream. */
async function commitDecision(
  deps: Deps,
  projectId: string,
  stage: Stage,
  output: AgentOutput,
  runId: string,
  evidenceNote?: string
): Promise<Committed> {
  const idx = STAGES.indexOf(stage);
  const prevStage = idx > 0 ? STAGES[idx - 1] : undefined;
  const dependsOn = prevStage ? (await getActiveDecisionsForStage(deps.db, projectId, prevStage)).map((d) => d.id) : [];
  const decision = toDecision(stage, output);
  const existing = await getLiveDecisionsForStage(deps.db, projectId, stage);

  let decisionId: string;
  let flaggedStages: Stage[] = [];
  if (existing.length) {
    const rev = await reviseDecision(deps.db, {
      projectId,
      oldDecisionId: existing[0].id,
      newDecision: decision,
      newEvidence: evidenceNote ?? "Stage re-run",
      dependsOn,
    });
    decisionId = rev.newDecisionId;
    flaggedStages = rev.flaggedStages;
  } else {
    decisionId = await recordDecision(deps.db, projectId, decision, { dependsOn });
  }

  await deps.db.update(projects).set({ currentStage: stage }).where(eq(projects.id, projectId));
  return { status: "awaiting_user", stage, runId, decisionId, flaggedStages };
}

/**
 * Runs one stage: agent -> validate -> save evidence -> ledger -> gate (awaiting_user).
 * Re-running a stage (a "challenge") supersedes its previous decision and flags downstream work as stale.
 */
export async function runStage(
  deps: Deps,
  projectId: string,
  stage: Stage,
  opts: { challengeNote?: string } = {}
): Promise<StageResult> {
  const idx = STAGES.indexOf(stage);
  const prevStage = idx > 0 ? STAGES[idx - 1] : undefined;

  if (prevStage) {
    const prev = await latestRun(deps, projectId, prevStage);
    if (!prev || prev.status !== "complete") {
      throw new Error(`Cannot run "${stage}": previous stage "${prevStage}" has not been accepted yet`);
    }
  }

  const input = await buildInput(deps, projectId, stage, opts.challengeNote);
  const output = AgentOutputSchema.parse(await deps.agents[stage].run(input));

  const previousRun = await latestRun(deps, projectId, stage);
  const runId = randomUUID();
  await deps.db.insert(stageRuns).values({
    id: runId,
    projectId,
    stage,
    status: "awaiting_user",
    runNumber: (previousRun?.runNumber ?? 0) + 1,
    inputSnapshot: input,
    output,
  });

  // Evidence is kept even when the stage contradicts upstream: it is the reason for the revision.
  await saveResearchItems(deps, projectId, stage, output);

  // No silent contradictions: disagreement with upstream pauses the pipeline for a human decision.
  if (output.contradicts_upstream) {
    return { status: "revision_requested", stage, runId, contradiction: output.contradicts_upstream };
  }

  return commitDecision(deps, projectId, stage, output, runId, opts.challengeNote);
}

/**
 * The human keeps the upstream decision despite the agent's objection. The objection is not lost:
 * it is recorded in the stage's assumptions, which flow into the ledger.
 */
export async function overruleContradiction(deps: Deps, projectId: string, stage: Stage): Promise<Committed> {
  const run = await latestRun(deps, projectId, stage);
  const output = run && (run.output as AgentOutput);
  if (!run || run.status !== "awaiting_user" || !output?.contradicts_upstream) {
    throw new Error(`Stage "${stage}" has no pending contradiction to overrule.`);
  }
  const { contradicts_upstream, ...rest } = output;
  const cleaned: AgentOutput = {
    ...rest,
    assumptions: [
      ...rest.assumptions,
      `Upstream decision kept by the user despite this evidence: ${contradicts_upstream.new_evidence}`,
    ],
  };
  await deps.db.update(stageRuns).set({ output: cleaned }).where(eq(stageRuns.id, run.id));
  return commitDecision(deps, projectId, stage, cleaned, run.id, "Contradiction overruled by user");
}

/** The gate: the user accepts the stage's output so the next stage may run. */
export async function acceptStage(deps: Deps, projectId: string, stage: Stage): Promise<void> {
  const run = await latestRun(deps, projectId, stage);
  if (!run || run.status !== "awaiting_user") throw new Error(`Nothing to accept for stage "${stage}"`);
  if ((run.output as AgentOutput).contradicts_upstream) {
    throw new Error(`Stage "${stage}" contradicts an upstream decision. Resolve the revision first.`);
  }
  await deps.db.update(stageRuns).set({ status: "complete" }).where(eq(stageRuns.id, run.id));
}

/** The gate: push back on a stage. Your note becomes a constraint for the re-run. */
export function challengeStage(deps: Deps, projectId: string, stage: Stage, note: string) {
  return runStage(deps, projectId, stage, { challengeNote: note });
}

/**
 * Runs every stage that has no accepted output yet (including stale ones, which regenerates
 * affected outputs after a revision). With autoAccept=false it stops at each gate.
 */
export async function runPipeline(
  deps: Deps,
  projectId: string,
  opts: { autoAccept?: boolean } = {}
): Promise<PipelineResult> {
  const completed: Stage[] = [];
  for (const stage of STAGES) {
    const latest = await latestRun(deps, projectId, stage);
    if (latest?.status === "complete") continue;

    if (latest?.status !== "awaiting_user") {
      const result = await runStage(deps, projectId, stage);
      if (result.status === "revision_requested") {
        return { completed, halted: { stage, reason: "revision_requested" } };
      }
    }
    if (!opts.autoAccept) return { completed, halted: { stage, reason: "awaiting_user" } };

    await acceptStage(deps, projectId, stage);
    completed.push(stage);
  }
  return { completed };
}
