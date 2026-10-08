import { desc, eq } from "drizzle-orm";
import { openDb } from "../src/db/client";
import { decisions, projects, revisionEvents } from "../src/db/schema";

/** Usage: npm run ledger [dbName]   (defaults to data/dev.db, the latest project in it) */
async function main() {
  const { db, close } = await openDb(`file:./data/${process.argv[2] ?? "dev"}.db`);
  try {
    const [project] = await db.select().from(projects).orderBy(desc(projects.createdAt)).limit(1);
    if (!project) {
      console.log("No projects yet. Run: npm run diagnose -- briefs/example-ledgerloop.md");
      return;
    }
    console.log(`\nProject: ${project.name}\n`);

    const rows = (await db.select().from(decisions).where(eq(decisions.projectId, project.id))).sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    );
    const short = (id: string) => id.slice(0, 8);
    const text = (s: string) => (s.length > 110 ? `${s.slice(0, 107)}...` : s);

    console.log("DECISIONS (oldest first)");
    for (const d of rows) {
      console.log(`  [${d.status.toUpperCase().padEnd(10)}] ${d.stage.padEnd(11)} ${short(d.id)}  conf ${d.confidence}/10`);
      console.log(`      ${text(d.decision)}`);
      if (d.supersedesId) console.log(`      replaces ${short(d.supersedesId)}`);
      console.log(`      rejected: ${d.rejectedOptions.map((r) => r.option).join("; ")}`);
    }

    const events = await db.select().from(revisionEvents).where(eq(revisionEvents.projectId, project.id));
    console.log(`\nREVISION EVENTS (${events.length})`);
    for (const e of events) {
      console.log(`  ${short(e.oldDecisionId)} -> ${short(e.newDecisionId)}`);
      console.log(`      because: ${text(e.newEvidence)}`);
      console.log(`      flagged stages: ${e.flaggedStages.length ? e.flaggedStages.join(", ") : "none"}`);
    }
    console.log("");
  } finally {
    close();
  }
}

main().catch((e) => {
  console.error("Could not read ledger:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});