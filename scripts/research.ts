import readline from "node:readline/promises";
import { desc, eq } from "drizzle-orm";
import { buildAgents } from "../src/agents/registry";
import { getEnv } from "../src/core/env";
import { loadDoctrine } from "../src/core/doctrine/load";
import { createLlmFromEnv, createSearchFromEnv } from "../src/core/llm/factory";
import { listDecisions } from "../src/core/memory/ledger";
import { acceptStage, challengeStage, latestRun, overruleContradiction, runStage } from "../src/core/orchestrator/orchestrator";
import { formatDiagnosisTrace } from "../src/core/trace/diagnosisTrace";
import { formatResearchTrace } from "../src/core/trace/researchTrace";
import { openDb } from "../src/db/client";
import { projects, researchItems } from "../src/db/schema";

/** Usage: npm run research [projectIdPrefix]   (defaults to the latest project in data/dev.db) */
async function main() {
  const env = getEnv();
  const { db, close } = await openDb("file:./data/dev.db");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    const all = await db.select().from(projects).orderBy(desc(projects.createdAt));
    const idArg = process.argv[2];
    const project = idArg ? all.find((p) => p.id.startsWith(idArg)) : all[0];
    if (!project) {
      console.error('No project found. Run "npm run diagnose -- briefs/example-ledgerloop.md" first.');
      process.exitCode = 1;
      return;
    }

    const deps = {
      db,
      doctrine: loadDoctrine(env.DOCTRINE_VERSION),
      agents: buildAgents(createLlmFromEnv(), createSearchFromEnv(), {
        maxQueries: env.RESEARCH_MAX_QUERIES,
        onProgress: (m) => console.log(`  ${m}`),
      }),
    };

    const diagnosis = await latestRun(deps, project.id, "diagnosis");
    if (!diagnosis || diagnosis.status !== "complete") {
      console.error('The diagnosis has not been accepted yet. Run "npm run diagnose -- <brief>" and accept it first.');
      process.exitCode = 1;
      return;
    }

    console.log(`\nResearching "${project.name}" (up to ${env.RESEARCH_MAX_QUERIES} searches). This takes a few minutes.\n`);
    let result = await runStage(deps, project.id, "research");

    for (;;) {
      const run = await latestRun(deps, project.id, "research");
      console.log(formatResearchTrace(run!.output));

      if (result.status === "revision_requested") {
        const c = result.contradiction;
        const answer = (
          await rl.question(
            "The research contradicts your diagnosis.\n[r] revise the diagnosis with this evidence   [k] keep the diagnosis (objection is recorded)   [q] quit  > "
          )
        )
          .trim()
          .toLowerCase();

        if (answer === "k") {
          result = await overruleContradiction(deps, project.id, "research");
          continue;
        }
        if (answer === "r") {
          console.log("\nRe-running the diagnosis with the research evidence as pushback...\n");
          await challengeStage(deps, project.id, "diagnosis", `Research evidence: ${c.new_evidence} Proposed revision: ${c.proposed_revision}`);
          const diag = await latestRun(deps, project.id, "diagnosis");
          console.log(formatDiagnosisTrace(diag!.output));
          const ok = (await rl.question("[a] accept the revised diagnosis and re-run research   [q] quit  > ")).trim().toLowerCase();
          if (ok !== "a") break;
          await acceptStage(deps, project.id, "diagnosis");
          console.log("\nRe-running research against the revised diagnosis...\n");
          result = await runStage(deps, project.id, "research");
          continue;
        }
        if (answer === "q") break;
        continue;
      }

      const answer = (await rl.question("[a] accept   [c] challenge   [q] quit  > ")).trim().toLowerCase();
      if (answer === "a") {
        await acceptStage(deps, project.id, "research");
        const items = await db.select().from(researchItems).where(eq(researchItems.projectId, project.id));
        const active = await listDecisions(db, project.id, "active");
        console.log(`\nAccepted. ${items.length} sourced research items and ${active.length} active decisions saved.`);
        console.log('Inspect the history with: npm run ledger');
        break;
      }
      if (answer === "c") {
        const note = (await rl.question("What is wrong or missing? > ")).trim();
        if (!note) continue;
        console.log("\nRe-running research with your pushback...\n");
        result = await runStage(deps, project.id, "research", { challengeNote: note });
        continue;
      }
      if (answer === "q") break;
    }
  } finally {
    rl.close();
    close();
  }
}

main().catch((e) => {
  console.error("Research failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
