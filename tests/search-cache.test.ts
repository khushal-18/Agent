import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterEach } from "vitest";
import { CachedSearchClient } from "../src/core/llm/searchCache";
import type { GroundedResult, SearchClient } from "../src/core/llm/types";

const grounded: GroundedResult = {
  text: "Answer.",
  searchQueries: ["q"],
  sources: [{ url: "https://a.example", title: "A" }],
  supports: [{ endIndex: 7, sourceIndices: [0] }],
};
const ungrounded: GroundedResult = { text: "Memory.", searchQueries: [], sources: [], supports: [] };

const counting = (result: GroundedResult) => {
  const c = { calls: 0 };
  const client: SearchClient = {
    async search() {
      c.calls++;
      return result;
    },
  };
  return { c, client };
};

const dirs: string[] = [];
const tmp = () => {
  const d = `./data/test-cache-${randomUUID()}`;
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const args = { system: "s", query: "best tools" };

describe("CachedSearchClient", () => {
  it("serves a repeat search from disk instead of calling the model again", async () => {
    const { c, client } = counting(grounded);
    const cache = new CachedSearchClient(client, { dir: tmp(), ttlHours: 24 });
    expect(await cache.search(args)).toEqual(grounded);
    expect(await cache.search(args)).toEqual(grounded);
    expect(c.calls).toBe(1);
  });

  it("treats a different query as a different search", async () => {
    const { c, client } = counting(grounded);
    const cache = new CachedSearchClient(client, { dir: tmp(), ttlHours: 24 });
    await cache.search(args);
    await cache.search({ ...args, query: "other" });
    expect(c.calls).toBe(2);
  });

  it("expires entries after the TTL", async () => {
    const { c, client } = counting(grounded);
    let now = 1_000_000;
    const cache = new CachedSearchClient(client, { dir: tmp(), ttlHours: 1, now: () => now });
    await cache.search(args);
    now += 30 * 60_000;
    await cache.search(args);
    expect(c.calls).toBe(1);
    now += 40 * 60_000;
    await cache.search(args);
    expect(c.calls).toBe(2);
  });

  it("never caches an answer that had no sources", async () => {
    const { c, client } = counting(ungrounded);
    const cache = new CachedSearchClient(client, { dir: tmp(), ttlHours: 24 });
    await cache.search(args);
    await cache.search(args);
    expect(c.calls).toBe(2);
  });

  it("is bypassed when the TTL is 0, and survives a corrupt cache file", async () => {
    const off = counting(grounded);
    const offCache = new CachedSearchClient(off.client, { dir: tmp(), ttlHours: 0 });
    await offCache.search(args);
    await offCache.search(args);
    expect(off.c.calls).toBe(2);

    const dir = tmp();
    const { c, client } = counting(grounded);
    const cache = new CachedSearchClient(client, { dir, ttlHours: 24 });
    await cache.search(args);
    for (const f of fs.readdirSync(dir)) fs.writeFileSync(`${dir}/${f}`, "{ not valid json");
    expect(await cache.search(args)).toEqual(grounded);
    expect(c.calls).toBe(2);
  });
});
