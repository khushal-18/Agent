import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { openTestDb } from "./helpers/testDb";
import { createProject, recordDecision, reviseDecision, listDecisions, downstreamIds } from "../src/core/memory/ledger";
import { stageRuns, revisionEvents } from "../src/db/schema";
import type { Decision } from "../src/core/schemas/decision";
import type { Stage } from "../src/core/schemas/stages";

const mk = (stage: Stage, text: string): Decision => ({
  decision: text,
  stage,
  rationale: `why ${text}`,
  evidence: [],
  rejected_options: [{ option: "other", reason: "weaker" }],
  assumptions: [],
  confidence: 6,
  validation_needed: "validate it",
  downstream_implications: [],
});

describe("decision ledger", () => {
  let t: Awaited<ReturnType<typeof openTestDb>>;
  beforeEach(async () => {
    t = await openTestDb();
  });
  afterEach(() => t.cleanup());

  it("rejects a decision without rejected alternatives", async () => {
    const p = await createProject(t.db, { name: "p", briefRaw: "b", doctrineVersion: "v1" });
    const bad = { ...mk("icp", "x"), rejected_options: [] };
    await expect(recordDecision(t.db, p.id, bad)).rejects.toThrow();
  });

  it("supersedes instead of overwriting, and flags downstream decisions + stage runs", async () => {
    const p = await createProject(t.db, { name: "p", briefRaw: "b", doctrineVersion: "v1" });
    const icp = await recordDecision(t.db, p.id, mk("icp", "Series A D2C"));
    const pos = await recordDecision(t.db, p.id, mk("positioning", "inventory clarity"), { dependsOn: [icp] });
    const gtm = await recordDecision(t.db, p.id, mk("gtm", "LinkedIn"), { dependsOn: [pos] });
    await t.db.insert(stageRuns).values(
      (["icp", "positioning", "gtm"] as const).map((stage, i) => ({
        id: `run-${i}`, projectId: p.id, stage, status: "complete" as const, runNumber: 1, inputSnapshot: {}, output: {},
      }))
    );

    const rev = await reviseDecision(t.db, {
      projectId: p.id,
      oldDecisionId: icp,
      newDecision: mk("icp", "Seed-stage marketplaces"),
      newEvidence: "Interviews show D2C pain is weaker than assumed",
    });

    const all = await listDecisions(t.db, p.id);
    const byId = Object.fromEntries(all.map((d) => [d.id, d]));
    expect(byId[icp].status).toBe("superseded"); // kept, not deleted
    expect(byId[rev.newDecisionId].status).toBe("active");
    expect(byId[rev.newDecisionId].supersedesId).toBe(icp);
    expect(byId[pos].status).toBe("stale");
    expect(byId[gtm].status).toBe("stale");
    expect(rev.flaggedStages.sort()).toEqual(["gtm", "positioning"]);

    const runs = await t.db.select().from(stageRuns);
    expect(runs.find((r) => r.stage === "icp")!.status).toBe("complete");
    expect(runs.find((r) => r.stage === "gtm")!.status).toBe("stale");

    const events = await t.db.select().from(revisionEvents).where(eq(revisionEvents.projectId, p.id));
    expect(events).toHaveLength(1);
    expect(events[0].newEvidence).toMatch(/Interviews/);
  });

  it("refuses to revise a decision that is already superseded", async () => {
    const p = await createProject(t.db, { name: "p", briefRaw: "b", doctrineVersion: "v1" });
    const a = await recordDecision(t.db, p.id, mk("icp", "A"));
    await reviseDecision(t.db, { projectId: p.id, oldDecisionId: a, newDecision: mk("icp", "B"), newEvidence: "e" });
    await expect(
      reviseDecision(t.db, { projectId: p.id, oldDecisionId: a, newDecision: mk("icp", "C"), newEvidence: "e" })
    ).rejects.toThrow(/already superseded/);
  });
});

describe("downstreamIds", () => {
  it("walks the graph transitively and ignores cycles back to the root", () => {
    const edges = [
      { fromDecisionId: "a", toDecisionId: "b" },
      { fromDecisionId: "b", toDecisionId: "c" },
      { fromDecisionId: "x", toDecisionId: "y" },
      { fromDecisionId: "c", toDecisionId: "a" },
    ];
    expect(downstreamIds(edges, "a").sort()).toEqual(["b", "c"]);
  });
});