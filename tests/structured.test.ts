import { describe, it, expect } from "vitest";
import { z } from "zod";
import { extractJson, generateStructured } from "../src/core/llm/structured";
import type { LlmClient } from "../src/core/llm/types";

const fake = (replies: string[]): LlmClient & { calls: number } => {
  let i = 0;
  return {
    get calls() {
      return i;
    },
    async complete() {
      return replies[Math.min(i++, replies.length - 1)];
    },
  };
};

const Schema = z.object({ ok: z.boolean(), note: z.string() });

describe("extractJson", () => {
  it("handles fences and surrounding prose", () => {
    expect(extractJson('Sure!\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it("throws when there is no JSON", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});

describe("generateStructured", () => {
  it("returns validated data on the first try", async () => {
    const llm = fake(['{"ok":true,"note":"hi"}']);
    expect(await generateStructured(llm, { system: "s", user: "u", schema: Schema })).toEqual({ ok: true, note: "hi" });
    expect(llm.calls).toBe(1);
  });

  it("retries with feedback after invalid output", async () => {
    const llm = fake(["garbage", '{"ok":"yes","note":"x"}', '{"ok":true,"note":"fixed"}']);
    const out = await generateStructured(llm, { system: "s", user: "u", schema: Schema });
    expect(out.note).toBe("fixed");
    expect(llm.calls).toBe(3);
  });

  it("gives up after maxAttempts", async () => {
    const llm = fake(["nope"]);
    await expect(generateStructured(llm, { system: "s", user: "u", schema: Schema, maxAttempts: 2 })).rejects.toThrow(
      /failed after 2 attempts/
    );
  });
});