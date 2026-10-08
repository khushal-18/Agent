import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { GroundedResult, SearchClient } from "./types";

const CachedSchema = z.object({
  savedAt: z.number(),
  result: z.object({
    text: z.string(),
    searchQueries: z.array(z.string()),
    sources: z.array(z.object({ url: z.string(), title: z.string() })),
    supports: z.array(z.object({ endIndex: z.number(), sourceIndices: z.array(z.number()) })),
  }),
});

export interface SearchCacheOptions {
  dir: string;
  /** 0 disables the cache. */
  ttlHours: number;
  now?: () => number;
}

/**
 * Saves grounded search results on disk so reruns, challenges and failed syntheses do not
 * spend quota repeating identical searches. Only results that carry real sources are cached.
 */
export class CachedSearchClient implements SearchClient {
  constructor(
    private inner: SearchClient,
    private opts: SearchCacheOptions
  ) {}

  async search(args: { system: string; query: string; maxTokens?: number }): Promise<GroundedResult> {
    if (this.opts.ttlHours <= 0) return this.inner.search(args);

    const now = (this.opts.now ?? Date.now)();
    const key = createHash("sha256").update(JSON.stringify([args.system, args.query, args.maxTokens ?? null])).digest("hex").slice(0, 32);
    const file = path.join(this.opts.dir, `${key}.json`);

    try {
      const cached = CachedSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
      if (now - cached.savedAt < this.opts.ttlHours * 3_600_000) return cached.result;
    } catch {
      /* missing, corrupt or expired: fall through to a live search */
    }

    const result = await this.inner.search(args);
    if (result.sources.some((s) => s.url)) {
      fs.mkdirSync(this.opts.dir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ savedAt: now, result }));
    }
    return result;
  }
}
