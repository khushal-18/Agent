import { z } from "zod";
import { AgentOutputSchema } from "./agent";

export const SUPERIORITY_DIMENSIONS = [
  "better_results",
  "faster_results",
  "better_experience",
  "easier",
  "more_trustworthy",
  "cheaper",
  "status_desirability",
  "innovation",
  "none_yet",
] as const;

export const DiagnosisReportSchema = z.object({
  what_they_are_building: z.string().min(1),
  hype_removed: z.array(
    z.object({ claim: z.string().min(1), why_it_is_not_differentiation: z.string().min(1) })
  ),
  actual_solution: z.string().min(1),
  real_problem: z.string().min(1),
  founder_framing: z.object({
    verdict: z.enum(["accurate", "partly_off", "wrong"]),
    note: z.string().min(1),
  }),
  need: z.object({
    who_feels_it: z.string().min(1),
    current_workaround: z.string().min(1),
    cost_of_not_solving: z.string().min(1),
    why_now: z.string().min(1),
  }),
  solution_quality: z.object({
    verdict: z.enum(["superior", "good_not_superior", "unproven", "weak"]),
    best_superiority_dimension: z.enum(SUPERIORITY_DIMENSIONS),
    reasoning: z.string().min(1),
    what_would_make_it_superior: z.string().min(1),
  }),
  known_from_brief: z.array(z.string().min(1)).min(1),
  unknowns: z
    .array(
      z.object({
        question: z.string().min(1),
        why_it_matters: z.string().min(1),
        how_to_find_out: z.string().min(1),
      })
    )
    .min(1),
  research_questions_for_next_stage: z.array(z.string().min(1)).min(1),
});
export type DiagnosisReport = z.infer<typeof DiagnosisReportSchema>;

/** What the model must return for the diagnosis stage: the standard agent contract + the full report. */
export const DiagnosisOutputSchema = AgentOutputSchema.omit({ contradicts_upstream: true, detail: true }).extend({
  detail: DiagnosisReportSchema,
});
export type DiagnosisOutput = z.infer<typeof DiagnosisOutputSchema>;