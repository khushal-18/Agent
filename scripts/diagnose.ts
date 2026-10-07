import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { buildAgents } from "../src/agents/registry";
import { getEnv } from "../src/core/env";
import { loadDoctrine } from "../src/core/doctrine/load";
import { createLlmFromEnv } from "../src/core/llm/factory";
import { createProject, listDecisions } from "../src/core/memory/ledger";
import { acceptStage, latestRun, runStage } from "../src/core/orchestrator/orchestrator";
import { formatDiagnosisTrace } from "../src/core/trace/diagnosisTrace";
import { openDb } from "../src/db/client";

async function main() {
  const briefPath = process.argv[2];
  if (!briefPath) {
    console.error("Usage: npm run diagnose -- <path-to-brief.md> [project name]");
    process.exitCode = 1;
    return;
  }
  const brief = fs.readFileSync(briefPath, "utf8");
  const name = process.argv[3] ?? path.basename(briefPath, path.extname(briefPath));

  const env = getEnv();
  const { db, close } = await openDb("file:./data/dev.db");
  const deps = { db, doctrine: loadDoctrine(env.DOCTRINE_VERSION), agents: buildAgents(createLlmFromEnv()) };
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    const project = await createProject(db, { name, briefRaw: brief, doctrineVersion: env.DOCTRINE_VERSION });
    await runStage(deps, project.id, "intake");
    await acceptStage(deps, project.id, "intake");

    console.log(`\nDiagnosing "${name}" with ${env.LLM_PROVIDER}... (this can take a minute)\n`);
    let result = await runStage(deps, project.id, "diagnosis");

    for (;;) {
      const run = await latestRun(deps, project.id, "diagnosis");
      console.log(formatDiagnosisTrace(run!.output));
      const answer = (await rl.question("[a] accept   [c] challenge   [q] quit  > ")).trim().toLowerCase();

      if (answer === "a") {
        await acceptStage(deps, project.id, "diagnosis");
        const decisions = await listDecisions(db, project.id, "active");
        console.log(`\nAccepted. Ledger now holds ${decisions.length} active decisions for this project.`);
        break;
      }
      if (answer === "c") {
        const note = (await rl.question("What is wrong or missing? > ")).trim();
        if (!note) continue;
        console.log("\nRe-running with your pushback as a constraint...\n");
        result = await runStage(deps, project.id, "diagnosis", { challengeNote: note });
        continue;
      }
      if (answer === "q") break;
    }
    void result;
  } finally {
    rl.close();
    close();
  }
}

main().catch((e) => {
  console.error("Diagnose failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
