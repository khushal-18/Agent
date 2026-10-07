import { openDb } from "../src/db/client";
import { loadDoctrine } from "../src/core/doctrine/load";
import { createProject, listDecisions } from "../src/core/memory/ledger";
import { challengeStage, acceptStage, runPipeline } from "../src/core/orchestrator/orchestrator";
import { createStubAgent } from "../src/agents/stub";
import { STAGES, type Stage } from "../src/core/schemas/stages";
import type { Agent } from "../src/core/orchestrator/types";

async function main() {
  const { db, close } = await openDb("file:./data/smoke.db");
  const agents = Object.fromEntries(STAGES.map((s) => [s, createStubAgent(s)])) as Record<Stage, Agent>;
  const deps = { db, doctrine: loadDoctrine("v1"), agents };

  const project = await createProject(db, { name: "Smoke Test", briefRaw: "Demo brief", doctrineVersion: "v1" });

  console.log("\n1) Running the full pipeline with stub agents...");
  const first = await runPipeline(deps, project.id, { autoAccept: true });
  console.log("   Completed:", first.completed.join(" -> "));

  console.log("\n2) Challenging the ICP stage (simulates new evidence)...");
  const challenge = await challengeStage(deps, project.id, "icp", "Interviews show the pain is weaker than assumed");
  if (challenge.status === "awaiting_user") console.log("   Downstream flagged stale:", challenge.flaggedStages.join(", "));

  console.log("\n3) Accepting the revised ICP and regenerating affected stages...");
  await acceptStage(deps, project.id, "icp");
  const second = await runPipeline(deps, project.id, { autoAccept: true });
  console.log("   Regenerated:", second.completed.join(", "));

  const counts = { active: 0, superseded: 0, stale: 0 };
  for (const d of await listDecisions(db, project.id)) counts[d.status] += 1;
  console.log("\nLedger:", counts, "(superseded decisions are kept as history)\n");
  close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});