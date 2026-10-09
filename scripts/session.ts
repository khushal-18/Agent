import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { desc, eq } from "drizzle-orm";
import { buildAgents } from "../src/agents/registry";
import { getEnv } from "../src/core/env";
import { loadDoctrine } from "../src/core/doctrine/load";
import { createLlmFromEnv, createSearchFromEnv } from "../src/core/llm/factory";
import { createProject, listDecisions } from "../src/core/memory/ledger";
import {
  acceptStage,
  challengeStage,
  latestRun,
  nextIncompleteStage,
  overruleContradiction,
  reopenIfObsolete,
  runStage,
} from "../src/core/orchestrator/orchestrator";
import type { Deps } from "../src/core/orchestrator/types";
import type { AgentOutput } from "../src/core/schemas/agent";
import type { Stage } from "../src/core/schemas/stages";
import { formatStageTrace } from "../src/core/trace";
import { openDb } from "../src/db/client";
import { decisions, projects, researchItems } from "../src/db/schema";

/**
 * Usage:
 *   npm run session -- briefs/example-ledgerloop.md [name]   start a new project from a brief
 *   npm run session                                          continue the latest project
 * Walks every stage that has a real agent, pausing at each gate to accept, challenge or quit.
 */
async function main() {
  const [briefPath, nameArg] = process.argv.slice(2);
  const env = getEnv();
  const { db, close } = await openDb("file:./data/dev.db");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (q: string) => (await rl.question(q)).trim().toLowerCase();

  try {
    const deps: Deps = {
      db,
      doctrine: loadDoctrine(env.DOCTRINE_VERSION),
      agents: buildAgents(createLlmFromEnv(), createSearchFromEnv(), {
        maxQueries: env.RESEARCH_MAX_QUERIES,
        onProgress: (m) => console.log(`  ${m}`),
      }),
    };

    let project;
    if (briefPath) {
      const brief = fs.readFileSync(briefPath, "utf8");
      project = await createProject(db, {
        name: nameArg ?? path.basename(briefPath, path.extname(briefPath)),
        briefRaw: brief,
        doctrineVersion: env.DOCTRINE_VERSION,
      });
      console.log(`\nCreated project "${project.name}".`);
    } else {
      [project] = await db.select().from(projects).orderBy(desc(projects.createdAt)).limit(1);
      if (!project) {
        console.error('No project yet. Start one with: npm run session -- briefs/example-ledgerloop.md');
        process.exitCode = 1;
        return;
      }
      console.log(`\nContinuing project "${project.name}".`);
    }
    const projectId = project.id;

    const show = async (stage: Stage) => {
      const run = await latestRun(deps, projectId, stage);
      console.log(formatStageTrace(stage, run!.output));
      return run!;
    };

    /** Reviews one stage until it is accepted. Returns what happened so the outer loop can rescan. */
    const reviewStage = async (stage: Stage): Promise<"accepted" | "revised" | "quit"> => {
      await reopenIfObsolete(deps, projectId, stage);
      let latest = await latestRun(deps, projectId, stage);

      // Resume a stage that was left waiting for review instead of spending quota to regenerate it.
      if (latest?.status !== "awaiting_user") {
        console.log(`\nRunning ${stage}...\n`);
        await runStage(deps, projectId, stage);
      } else {
        console.log(`\nResuming ${stage}, which was waiting for your review.\n`);
      }

      if (stage === "intake") {
        await acceptStage(deps, projectId, stage);
        return "accepted";
      }

      for (;;) {
        const run = await show(stage);
        const contradiction = (run.output as AgentOutput).contradicts_upstream;

        if (contradiction) {
          const answer = await ask(
            `${stage.toUpperCase()} contradicts an earlier decision.\n[r] revise that decision with this evidence   [k] keep it (objection is recorded)   [q] quit  > `
          );
          if (answer === "k") {
            await overruleContradiction(deps, projectId, stage);
            continue;
          }
          if (answer === "r") {
            const [target] = await db.select().from(decisions).where(eq(decisions.id, contradiction.decision_id));
            if (!target) {
              console.log("Could not find the contradicted decision.");
              continue;
            }
            const targetStage = target.stage as Stage;
            console.log(`\nRe-running "${targetStage}" with the evidence as pushback...\n`);
            await challengeStage(deps, projectId, targetStage, `Evidence from ${stage}: ${contradiction.new_evidence} Proposed revision: ${contradiction.proposed_revision}`);
            await show(targetStage);
            if ((await ask(`[a] accept the revised ${targetStage} and carry on   [q] quit  > `)) !== "a") return "quit";
            await acceptStage(deps, projectId, targetStage);
            return "revised";
          }
          if (answer === "q") return "quit";
          continue;
        }

        const answer = await ask("[a] accept   [c] challenge   [q] quit  > ");
        if (answer === "a") {
          await acceptStage(deps, projectId, stage);
          return "accepted";
        }
        if (answer === "c") {
          const note = await ask("What is wrong or missing? > ");
          if (!note) continue;
          console.log("\nRe-running with your pushback as a constraint...\n");
          await challengeStage(deps, projectId, stage, note);
          continue;
        }
        if (answer === "q") return "quit";
      }
    };

    for (;;) {
      const stage = await nextIncompleteStage(deps, projectId);
      if (!stage) {
        console.log("\nEvery stage is complete.");
        break;
      }
      if (deps.agents[stage].isStub) {
        console.log(`\nThe next stage, "${stage}", is not built yet. Everything so far is saved.`);
        break;
      }
      if ((await reviewStage(stage)) === "quit") break;
    }

    const items = await db.select().from(researchItems).where(eq(researchItems.projectId, projectId));
    const active = await listDecisions(db, projectId, "active");
    console.log(`\nSaved: ${active.length} active decisions, ${items.length} sourced research items. Inspect with: npm run ledger`);
  } finally {
    rl.close();
    close();
  }
}

main().catch((e) => {
  console.error("Session failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
