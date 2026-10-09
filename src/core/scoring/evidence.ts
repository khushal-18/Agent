/** Facts that come from the brief or the diagnosis rather than from web research. */
export const PSEUDO_EVIDENCE = ["brief", "diagnosis"] as const;

export interface ResearchRef {
  /** Short alias the model cites, e.g. "R3". Long ids are too easy to mistype. */
  ref: string;
  item_id: string;
  type: string;
  claim: string;
  source_url: string;
  confidence: number;
}

/** Gives every saved research item a short alias (R1, R2, ...) in the order supplied. */
export function buildResearchRefs(items: Record<string, unknown>[], max = 60): ResearchRef[] {
  return items.slice(0, max).map((r, i) => ({
    ref: `R${i + 1}`,
    item_id: String(r["id"] ?? ""),
    type: String(r["type"] ?? ""),
    claim: String(r["claim"] ?? ""),
    source_url: String(r["source_url"] ?? ""),
    confidence: Number(r["confidence"] ?? 0),
  }));
}

const normalise = (id: string) => id.trim().replace(/^\[|\]$/g, "");

/**
 * Keeps only evidence that exists. Anything the model made up is silently dropped by code, which is
 * the same rule research follows: no valid source, no claim.
 */
export function checkEvidence(ids: string[], refs: ResearchRef[]): { valid: string[]; research: ResearchRef[] } {
  const byRef = new Map(refs.map((r) => [r.ref, r]));
  const valid: string[] = [];
  const research: ResearchRef[] = [];
  for (const raw of ids) {
    const id = normalise(raw);
    const lower = id.toLowerCase();
    if ((PSEUDO_EVIDENCE as readonly string[]).includes(lower)) {
      if (!valid.includes(lower)) valid.push(lower);
      continue;
    }
    const hit = byRef.get(id.toUpperCase());
    if (hit && !valid.includes(hit.ref)) {
      valid.push(hit.ref);
      research.push(hit);
    }
  }
  return { valid, research };
}

/** Lists the research items the model may cite. */
export function renderResearchRefs(refs: ResearchRef[]): string {
  if (!refs.length) return "(no research items)";
  return refs.map((r) => `- ${r.ref} [${r.type}] ${r.claim} (confidence ${r.confidence}/10)`).join("\n");
}
