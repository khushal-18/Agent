/** Web research is partial evidence, so even a clear winner never reaches the top of the scale. */
export const CONFIDENCE_CAP = 8;
/** A choice with no web research behind it is mostly judgment. */
export const NOT_RESEARCH_BACKED_CAP = 5;
/** If the top two score within this many points (out of 100), the choice is a close call. */
export const CLOSE_CALL_MARGIN = 5;
export const CLOSE_CALL_CAP = 6;

/** The model's confidence is an input. Code applies the honesty limits. */
export function capConfidence(base: number, o: { researchBacked: boolean; margin: number }): number {
  let cap = CONFIDENCE_CAP;
  if (!o.researchBacked) cap = Math.min(cap, NOT_RESEARCH_BACKED_CAP);
  if (o.margin < CLOSE_CALL_MARGIN) cap = Math.min(cap, CLOSE_CALL_CAP);
  return Math.min(base, cap);
}

export function closeCallNote(winner: string, runnerUp: string, margin: number): string | null {
  return margin < CLOSE_CALL_MARGIN
    ? `Close call: "${winner}" beat "${runnerUp}" by only ${margin.toFixed(1)} points. Test both before committing.`
    : null;
}
