import { describe, it, expect, vi, afterEach } from "vitest";
import { GeminiLlm } from "../src/core/llm/gemini";

const quiet = { retryDelayMs: 0, onRetry: () => {} };
afterEach(() => vi.unstubAllGlobals());

const grounded = (extra: object = {}) =>
  new Response(
    JSON.stringify({
      candidates: [
        {
          content: { parts: [{ text: "Stocky is free. Prices start at $20." }] },
          groundingMetadata: {
            webSearchQueries: ["stocky shopify pricing"],
            groundingChunks: [
              { web: { uri: "https://stocky.example/pricing", title: "Stocky pricing" } },
              { web: { title: "No uri here" } },
            ],
            groundingSupports: [
              { segment: { startIndex: 0, endIndex: 15 }, groundingChunkIndices: [0] },
              { segment: { startIndex: 0, endIndex: 0 }, groundingChunkIndices: [0] },
              { segment: { endIndex: 36 }, groundingChunkIndices: [] },
            ],
          },
          ...extra,
        },
      ],
    }),
    { status: 200 }
  );

describe("GeminiLlm.search", () => {
  it("enables Google Search, does not force JSON mode, and parses the grounding metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue(grounded());
    vi.stubGlobal("fetch", fetchMock);

    const res = await new GeminiLlm("SECRET", "m", quiet).search({ system: "sys", query: "stocky pricing" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain("SECRET");
    const body = JSON.parse(init.body);
    expect(body.tools).toEqual([{ google_search: {} }]);
    expect(body.generationConfig.responseMimeType).toBeUndefined();
    expect(body.contents[0].parts[0].text).toBe("stocky pricing");

    expect(res.text).toMatch(/Stocky is free/);
    expect(res.searchQueries).toEqual(["stocky shopify pricing"]);
    // Index alignment is preserved: a chunk without a URL stays in place with an empty url.
    expect(res.sources).toEqual([
      { url: "https://stocky.example/pricing", title: "Stocky pricing" },
      { url: "", title: "No uri here" },
    ]);
    // Supports with no usable offset or no sources are dropped.
    expect(res.supports).toEqual([{ endIndex: 15, sourceIndices: [0] }]);
  });

  it("returns empty sources when the answer was not grounded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "From memory." }] } }] }), { status: 200 }))
    );
    const res = await new GeminiLlm("k", "m", quiet).search({ system: "s", query: "q" });
    expect(res.sources).toEqual([]);
    expect(res.supports).toEqual([]);
  });

  it("uses the same retry and fallback behaviour as complete()", async () => {
    const fetchMock = vi.fn(async (url: string | URL) =>
      String(url).includes("models/main:") ? new Response("busy", { status: 503 }) : grounded()
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await new GeminiLlm("k", "main", { ...quiet, maxRetries: 1, fallbackModel: "backup" }).search({ system: "s", query: "q" });
    expect(res.sources).toHaveLength(2);
  });

  it("complete() still requests JSON mode", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await new GeminiLlm("k", "m", quiet).complete({ system: "s", messages: [{ role: "user", content: "u" }] });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).generationConfig.responseMimeType).toBe("application/json");
  });
});
