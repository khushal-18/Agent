import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { StageSchema, type Stage } from "../schemas/stages";

const LawSchema = z.object({ id: z.number().int(), name: z.string(), rule: z.string() });

const DoctrineSchema = z
  .object({
    version: z.string(),
    description: z.string(),
    laws: z.array(LawSchema).length(10),
    superiority_hierarchy: z.array(z.object({ rank: z.number().int(), name: z.string() })),
    icp: z.object({
      scale: z.object({ min: z.number(), max: z.number() }),
      factors: z.array(z.string()).min(1),
      beachhead_criteria: z.array(z.string()),
    }),
    opportunity: z.object({
      scale: z.object({ min: z.number(), max: z.number() }),
      weights: z.record(z.string(), z.number()),
      competition_penalty: z.number().min(0).max(1),
    }),
    competitor_research_order: z.array(z.string()),
    funnel_stages: z.array(z.string()),
    banned_patterns: z.array(z.string()),
    stage_laws: z.record(z.string(), z.array(z.number().int())),
  })
  .superRefine((d, ctx) => {
    const sum = Object.values(d.opportunity.weights).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) > 1e-9) {
      ctx.addIssue({ code: "custom", message: `opportunity.weights must sum to 1 (got ${sum})` });
    }
    for (const stage of Object.keys(d.stage_laws)) {
      if (!StageSchema.safeParse(stage).success) {
        ctx.addIssue({ code: "custom", message: `stage_laws has unknown stage "${stage}"` });
      }
    }
  });

export type Doctrine = z.infer<typeof DoctrineSchema>;

export function loadDoctrine(version = "v1", baseDir = process.cwd()): Doctrine {
  const file = path.join(baseDir, "doctrine", `${version}.yaml`);
  const raw = fs.readFileSync(file, "utf8");
  return DoctrineSchema.parse(parse(raw));
}

/** Only the parts of the doctrine a given stage needs. Law 10 is always included. */
export function doctrineSliceForStage(d: Doctrine, stage: Stage) {
  const ids = new Set([...(d.stage_laws[stage] ?? []), 10]);
  return {
    laws: d.laws.filter((l) => ids.has(l.id)),
    banned_patterns: d.banned_patterns,
    superiority_hierarchy: d.superiority_hierarchy,
  };
}