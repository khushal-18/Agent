import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openTestDb } from "./helpers/testDb";
import { loadDoctrine } from "../src/core/doctrine/load";
import { createProject, listDecisions } from "../src/core/memory/ledger";
import { acceptStage, challengeStage, latestRun, runPipeline, runStage } from "../src/core/orchestrator/orchestrator";
import type { Agent, Deps } from "../src/core/orchestrator/types";
import { STAGES, type Stage } from "../src/core/schemas/stages";
import { createStubAgent } from "../src/agents/stub";

const buildAgents = (override: Partial<Record<Stage, Agent>> = {}) =>
  Object.fromEntries(STAGES.map((s) => [s, override[s] ?? createStubAgent(s)])) as Record<Stage, Agent>;

describe("orchestrator", () => {
  let t: Awaited<ReturnType<typeof openTestDb>>;
  let deps: Deps;
  let projectId: string;

  const setup = async (override: Partial<Record<Stage, Agent>> = {}) => {
    deps = { db: t.db, doctrine: loadDoctrine("v1"), agents: buildAgents(override) };
    projectId = (await createProject(t.db, { name: "Demo", briefRaw: "A product brief", doctrineVersion: "v1" })).id;
  };

  beforeEach(async () => {
    t = await openTestDb();
  });
  afterEach(() => t.cleanup());

  it("runs all stages end to end and writes one active decision per stage", async () => {
    await setup();
    const res = await runPipeline(deps, projectId, { autoAccept: true });
    expect(res.completed).toEqual([...STAGES]);
    expect(res.halted).toBeUndefined();
    const active = await listDecisions(t.db, projectId, "active");
    expect(active).toHaveLength(STAGES.length);
  });

  it("stops at each gate when autoAccept is off, and refuses to skip ahead", async () => {
    await setup();
    const res = await runPipeline(deps, projectId);
    expect(res.halted).toEqual({ stage: "intake", reason: "awaiting_user" });
    await expect(runStage(deps, projectId, "diagnosis")).rejects.toThrow(/has not been accepted/);
    await acceptStage(deps, projectId, "intake");
    const next = await runPipeline(deps, projectId);
    expect(next.halted?.stage).toBe("diagnosis");
  });

  it("a challenge supersedes the decision, flags downstream stale, and the pipeline regenerates it", async () => {
    await setup();
    await runPipeline(deps, projectId, { autoAccept: true });

    const result = await challengeStage(deps, projectId, "icp", "Pain looks weaker than assumed");
    expect(result.status).toBe("awaiting_user");
    if (result.status !== "awaiting_user") throw new Error("unexpected");
    expect(result.flaggedStages).toEqual(expect.arrayContaining(["positioning", "gtm", "campaign"]));

    expect((await latestRun(deps, projectId, "gtm"))!.status).toBe("stale");
    const stale = await listDecisions(t.db, projectId, "stale");
    expect(stale.length).toBeGreaterThan(0);

    // The challenge note reached the agent as a constraint.
    const icpDecision = (await listDecisions(t.db, projectId, "active")).find((d) => d.stage === "icp")!;
    expect(icpDecision.decision).toMatch(/Pain looks weaker/);

    await acceptStage(deps, projectId, "icp");
    const regen = await runPipeline(deps, projectId, { autoAccept: true });
    expect(regen.completed).toContain("gtm");
    expect(await listDecisions(t.db, projectId, "stale")).toHaveLength(0);

    // History is preserved: superseded decisions are never deleted.
    const superseded = await listDecisions(t.db, projectId, "superseded");
    expect(superseded.length).toBeGreaterThan(1);
  });

  it("halts instead of silently overriding when an agent contradicts upstream", async () => {
    await setup({
      positioning: createStubAgent("positioning", {
        contradicts_upstream: { decision_id: "icp-decision", new_evidence: "Buyers are not the users", proposed_revision: "Target ops leads" },
      }),
    });
    const res = await runPipeline(deps, projectId, { autoAccept: true });
    expect(res.halted).toEqual({ stage: "positioning", reason: "revision_requested" });
    await expect(acceptStage(deps, projectId, "positioning")).rejects.toThrow(/Resolve the revision/);
  });
});