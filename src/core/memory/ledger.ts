import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../../db/client";
import { decisionEdges, decisions, projects, revisionEvents, stageRuns } from "../../db/schema";
import { DecisionSchema, type Decision } from "../schemas/decision";
import type { Stage } from "../schemas/stages";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DecisionRow = typeof decisions.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;

// ---------- projects ----------

export async function createProject(
  db: Db,
  input: { name: string; briefRaw: string; constraints?: Record<string, unknown>; doctrineVersion: string }
): Promise<ProjectRow> {
  const row = {
    id: randomUUID(),
    name: input.name,
    briefRaw: input.briefRaw,
    constraints: input.constraints ?? {},
    currentStage: "intake",
    doctrineVersion: input.doctrineVersion,
  };
  await db.insert(projects).values(row);
  const [created] = await db.select().from(projects).where(eq(projects.id, row.id));
  return created;
}

export async function getProject(db: Db, projectId: string): Promise<ProjectRow> {
  const [row] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!row) throw new Error(`Project not found: ${projectId}`);
  return row;
}

// ---------- decisions ----------

async function insertDecision(
  tx: Tx,
  projectId: string,
  decision: Decision,
  dependsOn: string[],
  supersedesId: string | null
): Promise<string> {
  const id = randomUUID();
  await tx.insert(decisions).values({
    id,
    projectId,
    stage: decision.stage,
    decision: decision.decision,
    rationale: decision.rationale,
    evidence: decision.evidence,
    rejectedOptions: decision.rejected_options,
    assumptions: decision.assumptions,
    confidence: decision.confidence,
    validationNeeded: decision.validation_needed,
    downstreamImplications: decision.downstream_implications,
    status: "active",
    supersedesId,
  });
  if (dependsOn.length) {
    await tx.insert(decisionEdges).values(
      dependsOn.map((from) => ({ id: randomUUID(), projectId, fromDecisionId: from, toDecisionId: id }))
    );
  }
  return id;
}

/** Law 10: validates the decision (including rejected alternatives) before storing it. */
export async function recordDecision(
  db: Db,
  projectId: string,
  decision: Decision,
  opts: { dependsOn?: string[] } = {}
): Promise<string> {
  const valid = DecisionSchema.parse(decision);
  return db.transaction((tx) => insertDecision(tx, projectId, valid, opts.dependsOn ?? [], null));
}

export async function listDecisions(
  db: Db,
  projectId: string,
  status?: DecisionRow["status"]
): Promise<DecisionRow[]> {
  const where = status
    ? and(eq(decisions.projectId, projectId), eq(decisions.status, status))
    : eq(decisions.projectId, projectId);
  return db.select().from(decisions).where(where);
}

export async function getActiveDecisionsForStage(db: Db, projectId: string, stage: Stage): Promise<DecisionRow[]> {
  return db
    .select()
    .from(decisions)
    .where(and(eq(decisions.projectId, projectId), eq(decisions.stage, stage), eq(decisions.status, "active")));
}

/** Active OR stale: the decisions a stage currently "owns" and may replace when it is re-run. */
export async function getLiveDecisionsForStage(db: Db, projectId: string, stage: Stage): Promise<DecisionRow[]> {
  return db
    .select()
    .from(decisions)
    .where(
      and(eq(decisions.projectId, projectId), eq(decisions.stage, stage), inArray(decisions.status, ["active", "stale"]))
    );
}

/** Everything that depends, directly or indirectly, on rootId. Pure function over edges. */
export function downstreamIds(edges: { fromDecisionId: string; toDecisionId: string }[], rootId: string): string[] {
  const children = new Map<string, string[]>();
  for (const e of edges) {
    children.set(e.fromDecisionId, [...(children.get(e.fromDecisionId) ?? []), e.toDecisionId]);
  }
  const seen = new Set<string>();
  const queue = [rootId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const child of children.get(current) ?? []) {
      if (!seen.has(child) && child !== rootId) {
        seen.add(child);
        queue.push(child);
      }
    }
  }
  return [...seen];
}

// ---------- revisions ----------

export interface RevisionResult {
  newDecisionId: string;
  revisionEventId: string;
  flaggedDecisionIds: string[];
  flaggedStages: Stage[];
}

/**
 * Never silently overwrites. Old decision -> superseded (kept forever),
 * new decision links back to it, everything downstream is flagged stale,
 * and a revision event records why.
 */
export async function reviseDecision(
  db: Db,
  input: { projectId: string; oldDecisionId: string; newDecision: Decision; newEvidence: string; dependsOn?: string[] }
): Promise<RevisionResult> {
  const newDecision = DecisionSchema.parse(input.newDecision);

  return db.transaction(async (tx) => {
    const [old] = await tx.select().from(decisions).where(eq(decisions.id, input.oldDecisionId));
    if (!old) throw new Error(`Decision not found: ${input.oldDecisionId}`);
    if (old.projectId !== input.projectId) throw new Error("Decision belongs to a different project");
    if (old.status === "superseded") throw new Error(`Decision ${old.id} is already superseded`);

    const edges = await tx.select().from(decisionEdges).where(eq(decisionEdges.projectId, input.projectId));

    // Keep the same upstream links unless the caller says otherwise.
    const dependsOn =
      input.dependsOn ?? edges.filter((e) => e.toDecisionId === old.id).map((e) => e.fromDecisionId);

    const newDecisionId = await insertDecision(tx, input.projectId, newDecision, dependsOn, old.id);
    await tx.update(decisions).set({ status: "superseded" }).where(eq(decisions.id, old.id));

    // Flag everything that was built on the old decision.
    const downstream = downstreamIds(edges, old.id);
    let flaggedDecisionIds: string[] = [];
    let flaggedStages: Stage[] = [];
    if (downstream.length) {
      const rows = await tx.select().from(decisions).where(inArray(decisions.id, downstream));
      const live = rows.filter((r) => r.status === "active");
      flaggedDecisionIds = live.map((r) => r.id);
      flaggedStages = [...new Set(live.map((r) => r.stage as Stage))];
      if (flaggedDecisionIds.length) {
        await tx.update(decisions).set({ status: "stale" }).where(inArray(decisions.id, flaggedDecisionIds));
      }
      if (flaggedStages.length) {
        await tx
          .update(stageRuns)
          .set({ status: "stale" })
          .where(and(eq(stageRuns.projectId, input.projectId), inArray(stageRuns.stage, flaggedStages)));
      }
    }

    const revisionEventId = randomUUID();
    await tx.insert(revisionEvents).values({
      id: revisionEventId,
      projectId: input.projectId,
      oldDecisionId: old.id,
      newDecisionId,
      newEvidence: input.newEvidence,
      flaggedDecisionIds,
      flaggedStages,
    });

    return { newDecisionId, revisionEventId, flaggedDecisionIds, flaggedStages };
  });
}