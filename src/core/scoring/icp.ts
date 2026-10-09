import type { Doctrine } from "../doctrine/load";

export type FactorScores = Record<string, number>;

export interface IcpScore {
  /** Raw product of all factor scores. */
  product: number;
  /** 0 (every factor at the minimum) to 100 (every factor at the maximum). */
  normalized: number;
  /** The factor holding the candidate back. Useful for the trace and the critic. */
  weakest: { factor: string; score: number };
}

export function assertScoreInRange(name: string, value: number, min: number, max: number): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Score "${name}" must be between ${min} and ${max} (got ${value})`);
  }
}

/**
 * ICP = Pain x Urgency x Accessibility x AbilityToPay x SolutionFit x TriggerStrength
 * Multiplicative on purpose: one weak factor drags the whole candidate down.
 */
export function scoreIcp(scores: FactorScores, d: Pick<Doctrine, "icp">): IcpScore {
  const { min, max } = d.icp.scale;
  const factors = d.icp.factors;

  const unknown = Object.keys(scores).filter((k) => !factors.includes(k));
  if (unknown.length) throw new Error(`Unknown ICP factor(s): ${unknown.join(", ")}`);

  let product = 1;
  let weakest = { factor: factors[0], score: Infinity };
  for (const f of factors) {
    const v = scores[f];
    if (v === undefined) throw new Error(`Missing ICP factor: ${f}`);
    assertScoreInRange(f, v, min, max);
    product *= v;
    if (v < weakest.score) weakest = { factor: f, score: v };
  }

  const lo = Math.pow(min, factors.length);
  const hi = Math.pow(max, factors.length);
  return { product, normalized: ((product - lo) / (hi - lo)) * 100, weakest };
}
