import { describe, it, expect, vi, afterEach } from "vitest";
import { GeminiLlm, parseQuotaError } from "../src/core/llm/gemini";

const quiet = { retryDelayMs: 0, onRetry: () => {} };
const call = { system: "s", messages: [{ role: "user" as const, content: "u" }] };
const ok = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });

afterEach(() => vi.unstubAllGlobals());

const quotaBody = (opts: { quotaId?: string; quotaValue?: string; retryDelay?: string; message?: string } = {}) =>
  JSON.stringify({
    error: {
      code: 429,
      message: opts.message ?? "You exceeded your current quota, please check your plan and billing details.",
      status: "RESOURCE_EXHAUSTED",
      details: [
        { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: opts.quotaId ?? "GenerateRequestsPerMinutePerProjectPerModel", quotaValue: opts.quotaValue ?? "10" }] },
        ...(opts.retryDelay ? [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: opts.retryDelay }] : []),
      ],
    },
  });

const DAILY = quotaBody({ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier", quotaValue: "20" });

describe("parseQuotaError", () => {
  it("reads the limit, whether it is daily, and the retry hint", () => {
    const q = parseQuotaError(429, quotaBody({ retryDelay: "37.5s" }))!;
    expect(q.daily).toBe(false);
    expect(q.retryAfterMs).toBe(37500);
    expect(q.summary).toMatch(/limit 10/);

    const d = parseQuotaError(429, DAILY)!;
    expect(d.daily).toBe(true);
    expect(d.summary).toMatch(/midnight Pacific/);
    expect(d.summary).toMatch(/ai\.dev\/rate-limit/);
  });

  it("detects a zero quota and ignores non-quota errors", () => {
    expect(parseQuotaError(429, quotaBody({ quotaValue: "0" }))!.zero).toBe(true);
    expect(parseQuotaError(429, quotaBody({ quotaValue: "10", message: "Quota exceeded, limit: 0" }))!.zero).toBe(true);
    expect(parseQuotaError(503, DAILY)).toBeNull();
    expect(parseQuotaError(429, "not json")).toBeNull();
  });
});

describe("GeminiLlm quota handling", () => {
  it("does not retry a daily quota, and moves straight to the fallback", async () => {
    const fetchMock = vi.fn(async (url: string | URL) =>
      String(url).includes("models/main:") ? new Response(DAILY, { status: 429 }) : ok("from fallback")
    );
    vi.stubGlobal("fetch", fetchMock);
    const out = await new GeminiLlm("k", "main", { ...quiet, fallbackModel: "backup" }).complete(call);
    expect(out).toBe("from fallback");
    expect(fetchMock).toHaveBeenCalledTimes(2); // 1 for main (no retries), 1 for backup
  });

  it("reports which quota both models hit", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(DAILY, { status: 429 })));
    const err = await new GeminiLlm("k", "main", { ...quiet, fallbackModel: "backup" }).complete(call).catch((e) => e);
    expect(String(err)).toMatch(/Both models failed/);
    expect(String(err)).toMatch(/GenerateRequestsPerDayPerProjectPerModel-FreeTier/);
    expect(String(err)).toMatch(/midnight Pacific/);
  });

  it("fails fast with a billing hint when the plan has zero quota", async () => {
    const fetchMock = vi.fn(async () => new Response(quotaBody({ quotaValue: "0" }), { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    const err = await new GeminiLlm("k", "main", quiet).complete(call).catch((e) => e);
    expect(String(err)).toMatch(/billing may need to be enabled/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("waits the time Google asked for on a per-minute limit, then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(quotaBody({ retryDelay: "2s" }), { status: 429 }))
      .mockResolvedValueOnce(ok("done"));
    vi.stubGlobal("fetch", fetchMock);
    const logs: string[] = [];
    const out = await new GeminiLlm("k", "main", { retryDelayMs: 0, onRetry: (m) => logs.push(m) }).complete(call);
    expect(out).toBe("done");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(logs[0]).toMatch(/as Google asked/);
  });

  it("gives up instead of freezing when Google asks for a very long wait", async () => {
    const fetchMock = vi.fn(async () => new Response(quotaBody({ retryDelay: "900s" }), { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new GeminiLlm("k", "main", quiet).complete(call)).rejects.toThrow(/retry in 900s/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still backs off and retries a 429 whose body is not structured", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("rate limited", { status: 429 })).mockResolvedValueOnce(ok("fine"));
    vi.stubGlobal("fetch", fetchMock);
    expect(await new GeminiLlm("k", "main", quiet).complete(call)).toBe("fine");
  });
});
