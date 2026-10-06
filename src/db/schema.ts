import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());

export const STAGE_RUN_STATUSES = ["pending", "awaiting_user", "complete", "stale"] as const;
export const DECISION_STATUSES = ["active", "superseded", "stale"] as const;
export const RESEARCH_TYPES = ["competitor_positioning", "gtm", "complaint", "gap", "market"] as const;

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  briefRaw: text("brief_raw").notNull(),
  constraints: text("constraints", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  currentStage: text("current_stage").notNull(),
  doctrineVersion: text("doctrine_version").notNull(),
  createdAt: createdAt(),
});

export const stageRuns = sqliteTable(
  "stage_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    stage: text("stage").notNull(),
    status: text("status", { enum: STAGE_RUN_STATUSES }).notNull(),
    runNumber: integer("run_number").notNull(),
    inputSnapshot: text("input_snapshot", { mode: "json" }).$type<unknown>().notNull(),
    output: text("output", { mode: "json" }).$type<unknown>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("stage_runs_project_stage_idx").on(t.projectId, t.stage)]
);

export const researchItems = sqliteTable("research_items", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  stage: text("stage").notNull(),
  sourceUrl: text("source_url").notNull(),
  claim: text("claim").notNull(),
  excerptSummary: text("excerpt_summary").notNull(),
  type: text("type", { enum: RESEARCH_TYPES }).notNull(),
  confidence: integer("confidence").notNull(),
  createdAt: createdAt(),
});

export const decisions = sqliteTable(
  "decisions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    stage: text("stage").notNull(),
    decision: text("decision").notNull(),
    rationale: text("rationale").notNull(),
    evidence: text("evidence", { mode: "json" }).$type<string[]>().notNull(),
    rejectedOptions: text("rejected_options", { mode: "json" })
      .$type<{ option: string; reason: string }[]>()
      .notNull(),
    assumptions: text("assumptions", { mode: "json" }).$type<string[]>().notNull(),
    confidence: integer("confidence").notNull(),
    validationNeeded: text("validation_needed").notNull(),
    downstreamImplications: text("downstream_implications", { mode: "json" }).$type<string[]>().notNull(),
    status: text("status", { enum: DECISION_STATUSES }).notNull(),
    supersedesId: text("supersedes_id"),
    createdAt: createdAt(),
  },
  (t) => [index("decisions_project_stage_idx").on(t.projectId, t.stage)]
);

export const decisionEdges = sqliteTable(
  "decision_edges",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    fromDecisionId: text("from_decision_id").notNull(),
    toDecisionId: text("to_decision_id").notNull(),
  },
  (t) => [index("decision_edges_project_idx").on(t.projectId)]
);

export const revisionEvents = sqliteTable("revision_events", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  oldDecisionId: text("old_decision_id").notNull(),
  newDecisionId: text("new_decision_id").notNull(),
  newEvidence: text("new_evidence").notNull(),
  flaggedDecisionIds: text("flagged_decision_ids", { mode: "json" }).$type<string[]>().notNull(),
  flaggedStages: text("flagged_stages", { mode: "json" }).$type<string[]>().notNull(),
  createdAt: createdAt(),
});