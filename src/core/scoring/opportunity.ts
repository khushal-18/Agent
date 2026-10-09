import type { Doctrine } from "../doctrine/load";
import { assertScoreInRange } from "./icp";

export interface OpportunityInput {
  name: string;
  /** One score per weighted factor in doctrine.opportunity.weights. */
  scores: Record<string, number>;
  /** How crowded / well-served this use case already is (higher = worse for us). */
  competition: number;
}

export interface OpportunityScore {
  name: string;
  /** Weighted average of the factors on the doctrine scale. */
  weighted: number;
  /** Fraction (0-1) of the base score removed because of competition. */
  penaltyFraction: number;
  /** 0-100, after the competition penalty. */
  total: number;
}

/**
 * base  = weighted average of factors, mapped to 0-100
 * total = base x (1 - competition_penalty x normalizedCompetition)
 * Competition acts as a penalty, not as a factor to maximise.
 */
export function scoreOpportunity(input: OpportunityInput, d: Pick<Doctrine, "opportunity">): OpportunityScore {
  const { min, max } = d.opportunity.scale;
  const weights = d.opportunity.weights;

  const unknown = Object.keys(input.scores).filter((k) => !(k in weights));
  if (unknown.length) throw new Error(`Unknown opportunity factor(s): ${unknown.join(", ")}`);

  let weighted = 0;
  for (const [factor, w] of Object.entries(weights)) {
    const v = input.scores[factor];
    if (v === undefined) throw new Error(`Missing opportunity factor: ${factor}`);
    assertScoreInRange(factor, v, min, max);
    weighted += w * v;
  }
  assertScoreInRange("competition", input.competition, min, max);

  const base = ((weighted - min) / (max - min)) * 100;
  const penaltyFraction = d.opportunity.competition_penalty * ((input.competition - min) / (max - min));
  return { name: input.name, weighted, penaltyFraction, total: base * (1 - penaltyFraction) };
}

export function rankOpportunities(inputs: OpportunityInput[], d: Pick<Doctrine, "opportunity">): OpportunityScore[] {
  return inputs.map((i) => scoreOpportunity(i, d)).sort((a, b) => b.total - a.total);
}
