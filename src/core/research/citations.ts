import type { GroundedSupport } from "../llm/types";

/** Stable ids (S1, S2, ...) for every distinct source URL seen during research. */
export class SourceTable {
  private byUrl = new Map<string, string>();
  private rows: { id: string; url: string; title: string }[] = [];

  /** Returns the source id, or null if there is no usable URL. */
  add(url: string, title: string): string | null {
    const u = url.trim();
    if (!u) return null;
    const existing = this.byUrl.get(u);
    if (existing) return existing;
    const id = `S${this.rows.length + 1}`;
    this.byUrl.set(u, id);
    this.rows.push({ id, url: u, title: title.trim() || u });
    return id;
  }

  get(id: string) {
    return this.rows.find((r) => r.id === id);
  }

  has(id: string): boolean {
    return this.get(id) !== undefined;
  }

  list() {
    return [...this.rows];
  }
}

/**
 * Inserts "[S1, S2]" markers after the text the search provider says each source supports.
 * Offsets are UTF-8 byte positions, so this works on a Buffer and never splits a character.
 */
export function annotateWithCitations(
  text: string,
  supports: GroundedSupport[],
  idForIndex: (sourceIndex: number) => string | null
): string {
  const buf = Buffer.from(text, "utf8");
  const markers = new Map<number, Set<string>>();

  for (const s of supports) {
    let end = Math.min(Math.max(s.endIndex, 0), buf.length);
    while (end > 0 && end < buf.length && (buf[end] & 0xc0) === 0x80) end--; // stay on a character boundary
    const ids = s.sourceIndices.map(idForIndex).filter((x): x is string => x !== null);
    if (!ids.length) continue;
    const set = markers.get(end) ?? new Set<string>();
    ids.forEach((id) => set.add(id));
    markers.set(end, set);
  }

  const parts: Buffer[] = [];
  let cursor = 0;
  for (const end of [...markers.keys()].sort((a, b) => a - b)) {
    parts.push(buf.subarray(cursor, end), Buffer.from(` [${[...markers.get(end)!].join(", ")}]`, "utf8"));
    cursor = end;
  }
  parts.push(buf.subarray(cursor));
  return Buffer.concat(parts).toString("utf8");
}
