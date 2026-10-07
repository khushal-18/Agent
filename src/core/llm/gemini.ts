import type { LlmClient, LlmMessage } from "./types";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const RETRYABLE = new Set([429, 500, 503]);

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

/**
 * Gemini via its REST API (no SDK needed). Retries briefly on rate limits (429)
 * and transient server errors, which are common on the free tier.
 */
export class GeminiLlm implements LlmClient {
  constructor(
    private apiKey: string,
    private model: string,
    private opts: { maxRetries?: number; retryDelayMs?: number } = {}
  ) {}

  async complete(args: { system: string; messages: LlmMessage[]; maxTokens?: number }): Promise<string> {
    const url = `${BASE_URL}/${encodeURIComponent(this.model)}:generateContent`;
    const body = {
      systemInstruction: { parts: [{ text: args.system }] },
      contents: args.messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      // Thinking models count their reasoning against this limit, so keep it generous.
      generationConfig: { maxOutputTokens: args.maxTokens ?? 8192, responseMimeType: "application/json" },
    };

    const maxRetries = this.opts.maxRetries ?? 3;
    const baseDelay = this.opts.retryDelayMs ?? 1500;

    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = (await res.json()) as GeminiResponse;
        const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
        if (!text) {
          const why = data.promptFeedback?.blockReason ?? data.candidates?.[0]?.finishReason ?? "no content returned";
          throw new Error(`Gemini returned no text (${why})`);
        }
        return text;
      }

      if (RETRYABLE.has(res.status) && attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, baseDelay * (attempt + 1)));
        continue;
      }
      // Never include the API key in error text.
      const detail = (await res.text()).slice(0, 300);
      throw new Error(`Gemini API error ${res.status}: ${detail}`);
    }
  }
}