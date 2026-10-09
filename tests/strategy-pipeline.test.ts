import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { openTestDb } from "./helpers/testDb";
import { doctrine, fakeSearch, synthJson } from "./helpers/research-fixtures";
import { fakeStrategyLlm } from "./helpers/strategy-fixtures";
import { buildAgents } from "../src/agents/registry";
import { createProject, listDecisions } from "../src/core/memory/ledger";
import {
  acceptStage,
  challengeStage,
  latestRun,
  nextIncompleteStage,
  reopenIfObsolete,
  runStage,
} from "../src/core/orchestrator/orchestrator";
import type { Deps } from "../src/core/orchestrator/types";
import type { Stage } from "../src/core/schemas/stages";
import { formatStageTrace } from "../src/core/trace";
import { decisionEdges } from "../src/db/schema";

const counter = () => {
  let n = 0;
  return () => `item-${++n}`;
};

describe("brief to beachhead", () => {
  let t: Awaited<ReturnType<typeof openTestDb>>;
  let deps: Deps;
  let projectId: string;

  const setup = async (llm = fakeStrategyLlm()) => {
    deps = { db: t.db, doctrine, agents: buildAgents(llm, fakeSearch(), { maxQueries: 3, newId: counter() }) };
    projectId = (await createProject(t.db, { name: "LedgerLoop", briefRaw: "AI inventory forecasting", doctrineVersion: "v1" })).id;
  };

  /** Runs and accepts every stage up to and including `last`. */
  const through = async (last: Stage) => {
    for (;;) {
      const stage = (await nextIncompleteStage(deps, projectId))!;
      const res = await runStage(deps, projectId, stage);
      if (res.status !== "awaiting_user") throw new Error(`unexpected ${res.status} at ${stage}`);
      await acceptStage(deps, projectId, stage);
      if (stage === last) return;
    }
  };

  beforeEach(async () => {
    t = await openTestDb();
  });
  afterEach(() => t.cleanup());

  it("runs intake through ICP with a linked, cited decision at every stage", async () => {
    await setup();
    await through("icp");

    const active = await listDecisions(t.db, projectId, "active");
    expect(active.map((d) => d.stage).sort()).toEqual(["diagnosis", "icp", "intake", "opportunity", "research"]);

    const opp = active.find((d) => d.stage === "opportunity")!;
    expect(opp.decision).toMatch(/Reorder timing for small Shopify brands/);
    expect(opp.evidence.length).toBeGreaterThan(0); // real research item ids
    expect(opp.rejectedOptions).toHaveLength(2);

    const icp = active.find((d) => d.stage === "icp")!;
    expect(icp.decision).toMatch(/^Beachhead: Ops leads/);

    // Each decision depends on the one before it, so revisions can propagate.
    const edges = await t.db.select().from(decisionEdges).where(eq(decisionEdges.projectId, projectId));
    const chain = ["intake", "diagnosis", "research", "opportunity", "icp"].map((s) => active.find((d) => d.stage === s)!.id);
    for (let i = 1; i < chain.length; i++) {
      expect(edges.some((e) => e.fromDecisionId === chain[i - 1] && e.toDecisionId === chain[i])).toBe(true);
    }

    expect(await nextIncompleteStage(deps, projectId)).toBe("positioning");
    expect(deps.agents.positioning.isStub).toBe(true);
    expect(deps.agents.icp.isStub).toBeUndefined();
  });

  it("challenging the opportunity supersedes it and flags the ICP as stale", async () => {
    await setup();
    await through("icp");

    const res = await challengeStage(deps, projectId, "opportunity", "Reorder timing is too narrow to build a company on");
    expect(res.status).toBe("awaiting_user");
    expect((await latestRun(deps, projectId, "icp"))!.status).toBe("stale");
    expect(await listDecisions(t.db, projectId, "superseded")).toHaveLength(1);

    expect(await nextIncompleteStage(deps, projectId)).toBe("opportunity"); // awaiting your review
    await acceptStage(deps, projectId, "opportunity");
    expect(await nextIncompleteStage(deps, projectId)).toBe("icp"); // must regenerate against the new wedge

    await runStage(deps, projectId, "icp");
    await acceptStage(deps, projectId, "icp");
    expect(await listDecisions(t.db, projectId, "stale")).toHaveLength(0);
  });

  it("reopens a stage whose contradiction pointed at a decision that has since been revised", async () => {
    const contradicts = { decision_id: "x", new_evidence: "Free incumbents already solve this", proposed_revision: "Reframe" };
    await setup(fakeStrategyLlm({ synth: synthJson({ contradicts }) }));
    await through("diagnosis");

    expect((await runStage(deps, projectId, "research")).status).toBe("revision_requested");
    expect(await reopenIfObsolete(deps, projectId, "research")).toBe(false); // diagnosis is still current

    await challengeStage(deps, projectId, "diagnosis", "Research shows free incumbents");
    await acceptStage(deps, projectId, "diagnosis");

    expect(await reopenIfObsolete(deps, projectId, "research")).toBe(true);
    expect((await latestRun(deps, projectId, "research"))!.status).toBe("stale");
    expect(await nextIncompleteStage(deps, projectId)).toBe("research");
    expect(await reopenIfObsolete(deps, projectId, "icp")).toBe(false);
  });

  it("renders a trace for every real stage", async () => {
    await setup();
    await through("icp");
    const trace = async (s: Stage) => formatStageTrace(s, (await latestRun(deps, projectId, s))!.output);

    const opp = await trace("opportunity");
    for (const s of ["CHOSEN WEDGE:", "RANKING", "[LARGEST-MARKET PLAY]", "MARGIN OVER RUNNER-UP", "REJECTED ALTERNATIVES", "VALIDATE NEXT"]) expect(opp).toContain(s);

    const icp = await trace("icp");
    for (const s of ["BEACHHEAD CUSTOMER:", "BUYER MAP", "ECONOMIC BUYER", "DISQUALIFIERS", "[LARGEST SEGMENT]", "WEDGE THIS SERVES:"]) expect(icp).toContain(s);

    expect(await trace("intake")).toContain("==================== INTAKE");
  });
});
