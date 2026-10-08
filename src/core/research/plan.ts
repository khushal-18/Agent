/**
 * Mirrors the doctrine's competitor research order:
 * positioning, GTM, what they do well, what they do badly, complaints, messaging, gaps.
 */
export const RESEARCH_TYPE_PRIORITY = [
  "competitor_positioning",
  "gtm",
  "strength",
  "weakness",
  "complaint",
  "messaging",
  "gap",
  "market",
] as const;

const normalize = (q: string) => q.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Picks up to `max` queries, one per research type per round in priority order, so a budget of 6
 * can never be spent entirely on one kind of question. Skips duplicates and anything already run.
 */
export function selectQueries<T extends { query: string; type: string }>(
  queries: T[],
  max: number,
  alreadyRun: Set<string> = new Set()
): T[] {
  const seen = new Set(alreadyRun);
  const unique: T[] = [];
  for (const q of queries) {
    const key = normalize(q.query);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(q);
  }

  const order = [...RESEARCH_TYPE_PRIORITY, ...new Set(unique.map((q) => q.type))].filter(
    (t, i, all) => all.indexOf(t) === i
  );
  const queues = new Map<string, T[]>(order.map((t) => [t, unique.filter((q) => q.type === t)]));

  const picked: T[] = [];
  while (picked.length < max && [...queues.values()].some((q) => q.length)) {
    for (const t of order) {
      const next = queues.get(t)?.shift();
      if (next) picked.push(next);
      if (picked.length >= max) break;
    }
  }
  return picked;
}

export const normalizeQuery = normalize;
