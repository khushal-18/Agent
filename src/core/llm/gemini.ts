import type { LlmClient, LlmMessage } from "./types";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
/** Temporary conditions worth retrying: rate limit, server error, "high demand", timeout. */
const TRANSIENT = new Set([429, 500, 503, 504]);

export class GeminiApiError extends Error {
  constructor(
    public status: number,
    detail: string
  ) {
    super(`Gemini API error ${status}: ${detail}`);
    this.name = "GeminiApiError";
  }
}

export interface GeminiOptions {
  /** Used only if the main model keeps failing with a temporary error (or 404). */
  fallbackModel?: string;
  /** Retries per model. Default 5. */
  maxRetries?: number;
  /** Base delay in ms; doubles on every retry (2s, 4s, 8s, 16s, 32s by default). */
  retryDelayMs?: number;
  /** Progress messages. Defaults to console.error so a long wait is visible. */
  onRetry?: (message: string) => void;
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

/** Gemini via its REST API (no SDK). Patient with temporary errors, optional fallback model. */
export class GeminiLlm implements LlmClient {
  constructor(
    private apiKey: string,
    private model: string,
    private opts: GeminiOptions = {}
  ) {}

  private log(message: string) {
    (this.opts.onRetry ?? ((m: string) => console.error(m)))(message);
  }

  async complete(args: { system: string; messages: LlmMessage[]; maxTokens?: number }): Promise<string> {
    try {
      return await this.callModel(this.model, args);
    } catch (e) {
      const fallback = this.opts.fallbackModel;
      const canFallback =
        !!fallback &&
        fallback !== this.model &&
        e instanceof GeminiApiError &&
        (TRANSIENT.has(e.status) || e.status === 404);
      if (!canFallback) throw e;
      this.log(`Model "${this.model}" failed (${e.status}). Falling back to "${fallback}".`);
      try {
        return await this.callModel(fallback, args);
      } catch (fe) {
        // Report both failures so the original problem is not hidden behind the fallback's.
        const detail = fe instanceof Error ? fe.message : String(fe);
        throw new Error(`Both models failed.\n  main "${this.model}": ${e.message}\n  fallback "${fallback}": ${detail}`);
      }
    }
  }

  private async callModel(
    model: string,
    args: { system: string; messages: LlmMessage[]; maxTokens?: number }
  ): Promise<string> {
    const url = `${BASE_URL}/${encodeURIComponent(model)}:generateContent`;
    const body = {
      systemInstruction: { parts: [{ text: args.system }] },
      contents: args.messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      // Thinking models count their reasoning against this limit, so keep it generous.
      generationConfig: { maxOutputTokens: args.maxTokens ?? 8192, responseMimeType: "application/json" },
    };

    const maxRetries = this.opts.maxRetries ?? 5;
    const baseDelay = this.opts.retryDelayMs ?? 2000;

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

      if (TRANSIENT.has(res.status) && attempt < maxRetries) {
        const delay = baseDelay * 2 ** attempt;
        this.log(`Gemini busy (${res.status}) on "${model}". Retry ${attempt + 1}/${maxRetries} in ${Math.round(delay / 1000)}s...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      // Never include the API key in error text.
      throw new GeminiApiError(res.status, (await res.text()).slice(0, 300));
    }
  }
}
