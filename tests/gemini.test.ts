import { describe, it, expect, vi, afterEach } from "vitest";
import { GeminiLlm } from "../src/core/llm/gemini";

const ok = (text: string) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });

afterEach(() => vi.unstubAllGlobals());

describe("GeminiLlm", () => {
  it("sends the key in a header, maps roles, and returns the text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok('{"a":1}'));
    vi.stubGlobal("fetch", fetchMock);

    const llm = new GeminiLlm("SECRET", "gemini-test", { retryDelayMs: 0 });
    const out = await llm.complete({
      system: "sys",
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "yo" },
      ],
    });

    expect(out).toBe('{"a":1}');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("models/gemini-test:generateContent");
    expect(String(url)).not.toContain("SECRET"); // key must not be in the URL
    expect(init.headers["x-goog-api-key"]).toBe("SECRET");
    const body = JSON.parse(init.body);
    expect(body.systemInstruction.parts[0].text).toBe("sys");
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(["user", "model"]);
  });

  it("retries on 429 and then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(ok("done"));
    vi.stubGlobal("fetch", fetchMock);
    const llm = new GeminiLlm("k", "m", { retryDelayMs: 0 });
    expect(await llm.complete({ system: "s", messages: [{ role: "user", content: "u" }] })).toBe("done");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails fast on a 400 without leaking the key", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad request", { status: 400 })));
    const llm = new GeminiLlm("SECRET", "m", { retryDelayMs: 0 });
    const err = await llm.complete({ system: "s", messages: [{ role: "user", content: "u" }] }).catch((e) => e);
    expect(String(err)).toMatch(/Gemini API error 400/);
    expect(String(err)).not.toContain("SECRET");
  });

  it("explains empty or blocked replies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } }), { status: 200 }))
    );
    const llm = new GeminiLlm("k", "m");
    await expect(llm.complete({ system: "s", messages: [{ role: "user", content: "u" }] })).rejects.toThrow(/SAFETY/);
  });
});