import { describe, it, expect, vi, afterEach } from "vitest";
import { GeminiLlm } from "../src/core/llm/gemini";

const ok = (text: string) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
const call = { system: "s", messages: [{ role: "user" as const, content: "u" }] };
const quiet = { retryDelayMs: 0, onRetry: () => {} };

afterEach(() => vi.unstubAllGlobals());

describe("GeminiLlm resilience", () => {
  it("keeps retrying a busy model before giving up", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(ok("finally"));
    vi.stubGlobal("fetch", fetchMock);
    expect(await new GeminiLlm("k", "main", quiet).complete(call)).toBe("finally");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("falls back to the second model when the first stays unavailable", async () => {
    const fetchMock = vi.fn(async (url: string | URL) =>
      String(url).includes("models/main:") ? new Response("busy", { status: 503 }) : ok("from fallback")
    );
    vi.stubGlobal("fetch", fetchMock);
    const logs: string[] = [];
    const llm = new GeminiLlm("k", "main", { ...quiet, maxRetries: 1, fallbackModel: "backup", onRetry: (m) => logs.push(m) });
    expect(await llm.complete(call)).toBe("from fallback");
    expect(fetchMock).toHaveBeenCalledTimes(3); // main x2, backup x1
    expect(logs.some((l) => l.includes("Falling back"))).toBe(true);
  });

  it("throws when there is no fallback", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("busy", { status: 503 })));
    await expect(new GeminiLlm("k", "main", { ...quiet, maxRetries: 1 }).complete(call)).rejects.toThrow(/Gemini API error 503/);
  });

  it("does not fall back on a client error such as a bad key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad key", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new GeminiLlm("k", "main", { ...quiet, fallbackModel: "backup" }).complete(call)).rejects.toThrow(/400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back when the main model has been retired (404)", async () => {
    const fetchMock = vi.fn(async (url: string | URL) =>
      String(url).includes("models/old:") ? new Response("gone", { status: 404 }) : ok("new model")
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await new GeminiLlm("k", "old", { ...quiet, fallbackModel: "new" }).complete(call)).toBe("new model");
  });

  it("reports both failures when the fallback fails too", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) =>
        String(url).includes("models/main:") ? new Response("busy", { status: 503 }) : new Response("retired", { status: 404 })
      )
    );
    const llm = new GeminiLlm("k", "main", { ...quiet, maxRetries: 1, fallbackModel: "backup" });
    const err = await llm.complete(call).catch((e) => e);
    expect(String(err)).toMatch(/Both models failed/);
    expect(String(err)).toMatch(/main "main": Gemini API error 503/);
    expect(String(err)).toMatch(/fallback "backup": Gemini API error 404/);
  });
});
