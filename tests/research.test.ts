import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { openTestDb } from "./helpers/testDb";
import {
  DIAGNOSIS_DECISION_ID,
  diagnosisJson,
  doctrine,
  fakeResearchLlm,
  fakeSearch,
  researchInput,
  synthJson,
} from "./helpers/research-fixtures";
import { buildAgents } from "../src/agents/registry";
import { createStubAgent } from "../src/agents/stub";
import { createResearchAgent, RESEARCH_CONFIDENCE_CAP, THIN_EVIDENCE_CAP } from "../src/agents/research";
import { createProject, listDecisions } from "../src/core/memory/ledger";
import {
  acceptStage,
  challengeStage,
  latestRun,
  overruleContradiction,
  runStage,
} from "../src/core/orchestrator/orchestrator";
import type { Agent, Deps } from "../src/core/orchestrator/types";
import type { AgentInput } from "../src/core/schemas/agent";
import { ResearchOutputSchema } from "../src/core/schemas/research";
import { formatResearchTrace } from "../src/core/trace/researchTrace";
import { researchItems } from "../src/db/schema";

const counter = () => {
  let n = 0;
  return () => `item-${++n}`;
};

const manyFindings = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    claim: `Finding ${i}`, summary: `Summary ${i}`, type: "competitor_positioning", source_ids: ["S1"], confidence: 7,
  }));

describe("research agent", () => {
  it("keeps only findings with a real source and reports what it removed", async () => {
    const agent = createResearchAgent(fakeResearchLlm(), fakeSearch(), { maxQueries: 6, newId: counter() });
    const out = await agent.run(researchInput());
    const d = ResearchOutputSchema.parse(out).detail;

    expect(d.findings.map((f) => f.claim)).toEqual(["Stocky is a free Shopify app", "Users report slow reorder alerts"]);
    expect(d.findings[1].source_ids).toEqual(["S1"]); // the fake S99 was stripped
    expect(d.competitors.map((c) => c.name)).toEqual(["Stocky"]);
    expect(d.dropped_unsourced).toEqual({ findings: 1, competitors: 1, gaps: 0 });
    expect(d.sources.map((s) => s.id)).toEqual(["S1", "S2"]);
  });

  it("links decision evidence to the saved research items", async () => {
    const out = await createResearchAgent(fakeResearchLlm(), fakeSearch(), { newId: counter() }).run(researchInput());
    expect(out.research_items!.map((i) => i.id)).toEqual(["item-1", "item-2"]);
    expect(out.evidence_refs).toEqual(["item-1", "item-2"]);
    expect(out.research_items![0].source_url).toBe("https://a.example/stocky");
  });

  it("caps confidence lower when few findings are verified, and lower than 10 even with many", async () => {
    const thin = await createResearchAgent(fakeResearchLlm(), fakeSearch()).run(researchInput());
    expect(thin.confidence).toBe(THIN_EVIDENCE_CAP);

    const rich = await createResearchAgent(fakeResearchLlm(synthJson({ findings: manyFindings(6) })), fakeSearch()).run(researchInput());
    expect(rich.confidence).toBe(RESEARCH_CONFIDENCE_CAP);
  });

  it("fails loudly when no finding has a verifiable source", async () => {
    const llm = fakeResearchLlm(synthJson({ findings: [{ claim: "x", summary: "y", type: "gap", source_ids: ["S77"], confidence: 5 }] }));
    await expect(createResearchAgent(llm, fakeSearch()).run(researchInput())).rejects.toThrow(/no findings with a verifiable source/);
  });

  it("fails loudly when no search returns sources", async () => {
    const search = fakeSearch();
    const noSources = { ...search, search: async () => ({ text: "memory", searchQueries: [], sources: [], supports: [] }) };
    await expect(createResearchAgent(fakeResearchLlm(), noSources).run(researchInput())).rejects.toThrow(/nothing to base research on/);
  });

  it("respects the search budget, never repeats a query, and feeds round 1 into round 2", async () => {
    const search = fakeSearch();
    const llm = fakeResearchLlm();
    const progress: string[] = [];
    await createResearchAgent(llm, search, { maxQueries: 4, onProgress: (m) => progress.push(m) }).run(researchInput());

    expect(search.queries.length).toBeLessThanOrEqual(4);
    const bare = search.queries.map((q) => q.split("\n")[0].toLowerCase());
    expect(new Set(bare).size).toBe(bare.length);

    const round2 = llm.systems.findIndex((s) => s.includes("ROUND 2"));
    expect(llm.users[round2]).toMatch(/ROUND 1 FINDINGS/);
    expect(llm.users[round2]).toMatch(/Stocky is a free Shopify app/);
    expect(progress.some((p) => p.startsWith("Searching"))).toBe(true);
  });

  it("puts citation markers into the text the synthesis step reads", async () => {
    const llm = fakeResearchLlm();
    await createResearchAgent(llm, fakeSearch()).run(researchInput());
    const synthUser = llm.users[llm.systems.findIndex((s) => s.includes("RESEARCH SYNTHESIS"))];
    expect(synthUser).toMatch(/Stocky is a free Shopify app\. \[S1\]/);
  });

  it("throws away a search answer that came back without sources", async () => {
    const search = fakeSearch();
    const llm = fakeResearchLlm();
    // Make the first query a sourceless one by wrapping the search client.
    let first = true;
    const flaky = {
      queries: search.queries,
      search: async (a: { system: string; query: string }) => {
        if (first) {
          first = false;
          return { text: "From memory.", searchQueries: [], sources: [], supports: [] };
        }
        return search.search(a);
      },
    };
    const out = await createResearchAgent(llm, flaky, { maxQueries: 6 }).run(researchInput());
    const d = ResearchOutputSchema.parse(out).detail;
    expect(d.discarded_queries).toHaveLength(1);
    expect(d.queries_run.every((q) => q.sources_found > 0)).toBe(true);
  });

  it("routes a contradiction through the explicit channel with the real diagnosis decision id", async () => {
    const contradicts = { decision_id: "made-up-id", new_evidence: "Incumbents solve this free", proposed_revision: "Reframe around timing" };
    const out = await createResearchAgent(fakeResearchLlm(synthJson({ contradicts })), fakeSearch()).run(researchInput());
    expect(out.contradicts_upstream).toEqual({ ...contradicts, decision_id: DIAGNOSIS_DECISION_ID });

    const orphan = await createResearchAgent(fakeResearchLlm(synthJson({ contradicts })), fakeSearch()).run(researchInput({ withDecision: false }));
    expect(orphan.contradicts_upstream).toBeUndefined();
  });

  it("refuses to run without a diagnosis", async () => {
    await expect(createResearchAgent(fakeResearchLlm(), fakeSearch()).run(researchInput({ withDiagnosis: false }))).rejects.toThrow(/needs an accepted diagnosis/);
  });
});

describe("research inside the orchestrator", () => {
  let t: Awaited<ReturnType<typeof openTestDb>>;
  let deps: Deps;
  let projectId: string;
  let seen: AgentInput | undefined;

  const setup = async (synth: object = synthJson(), diagnosisConfidence = 6) => {
    const agents = buildAgents(fakeResearchLlm(synth, diagnosisConfidence), fakeSearch(), { maxQueries: 3, newId: counter() });
    const original = createStubAgent("opportunity"); // the real opportunity agent is not what this test is about
    const spy: Agent = {
      stage: "opportunity",
      run: async (input) => {
        seen = input;
        return original.run(input);
      },
    };
    agents.opportunity = spy;
    deps = { db: t.db, doctrine, agents };
    projectId = (await createProject(t.db, { name: "LedgerLoop", briefRaw: "AI inventory forecasting", doctrineVersion: "v1" })).id;
    await runStage(deps, projectId, "intake");
    await acceptStage(deps, projectId, "intake");
    await runStage(deps, projectId, "diagnosis");
    await acceptStage(deps, projectId, "diagnosis");
  };

  beforeEach(async () => {
    t = await openTestDb();
    seen = undefined;
  });
  afterEach(() => t.cleanup());

  it("saves sourced items, records a cited decision, and hands the research to later stages", async () => {
    await setup();
    const res = await runStage(deps, projectId, "research");
    expect(res.status).toBe("awaiting_user");

    const rows = await t.db.select().from(researchItems).where(eq(researchItems.projectId, projectId));
    expect(rows.map((r) => r.id).sort()).toEqual(["item-1", "item-2"]);
    expect(rows[0].sourceUrl).toMatch(/^https:\/\//);

    const decision = (await listDecisions(t.db, projectId, "active")).find((d) => d.stage === "research")!;
    expect(decision.evidence.sort()).toEqual(["item-1", "item-2"]);

    await acceptStage(deps, projectId, "research");
    await runStage(deps, projectId, "opportunity");
    expect(seen!.relevant_research.length).toBe(2);
  });

  it("lifts the diagnosis confidence cap once research exists", async () => {
    await setup(synthJson(), 10);
    const before = (await latestRun(deps, projectId, "diagnosis"))!.output as { confidence: number };
    expect(before.confidence).toBe(7); // capped: no research yet

    await runStage(deps, projectId, "research");
    await acceptStage(deps, projectId, "research");
    await challengeStage(deps, projectId, "diagnosis", "Re-check against the research");
    const after = (await latestRun(deps, projectId, "diagnosis"))!.output as { confidence: number };
    expect(after.confidence).toBe(10);
  });

  it("pauses on a contradiction, keeps the evidence, and records an overruled objection", async () => {
    const contradicts = { decision_id: "x", new_evidence: "Free incumbents already solve this", proposed_revision: "Reframe" };
    await setup(synthJson({ contradicts }));

    const res = await runStage(deps, projectId, "research");
    expect(res.status).toBe("revision_requested");
    expect(await t.db.select().from(researchItems)).toHaveLength(2); // evidence is not lost
    expect((await listDecisions(t.db, projectId, "active")).some((d) => d.stage === "research")).toBe(false);
    await expect(acceptStage(deps, projectId, "research")).rejects.toThrow(/Resolve the revision/);

    const committed = await overruleContradiction(deps, projectId, "research");
    expect(committed.status).toBe("awaiting_user");
    const decision = (await listDecisions(t.db, projectId, "active")).find((d) => d.stage === "research")!;
    expect(decision.assumptions.join(" ")).toMatch(/kept by the user despite this evidence: Free incumbents/);

    await acceptStage(deps, projectId, "research");
    expect((await latestRun(deps, projectId, "research"))!.status).toBe("complete");
  });

  it("can only overrule when a contradiction is actually pending", async () => {
    await setup();
    await runStage(deps, projectId, "research");
    await expect(overruleContradiction(deps, projectId, "research")).rejects.toThrow(/no pending contradiction/);
  });

  it("renders a trace with every section", async () => {
    await setup();
    await runStage(deps, projectId, "research");
    const text = formatResearchTrace((await latestRun(deps, projectId, "research"))!.output);
    for (const s of ["CATEGORY:", "SEARCHES RUN", "COMPETITORS AND ALTERNATIVES", "STOCKY (direct)", "KEY FINDINGS", "MARKET GAPS", "DIAGNOSIS CHECK: REFINED", "NOT FOUND IN RESEARCH", "VALIDATE NEXT", "SOURCES", "Unsourced items removed"]) {
      expect(text).toContain(s);
    }
  });
});
