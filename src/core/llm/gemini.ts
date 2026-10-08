import type { GroundedResult, LlmClient, LlmMessage, SearchClient } from "./types";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
/** Temporary conditions worth retrying: rate limit, server error, "high demand", timeout. */
const TRANSIENT = new Set([429, 500, 503, 504]);

export interface QuotaInfo {
  /** A per-day limit: retrying cannot help until the quota resets. */
  daily: boolean;
  /** The plan has zero quota for this model or feature (usually needs billing). */
  zero: boolean;
  /** How long Google asked us to wait, if it said. */
  retryAfterMs?: number;
  /** Short, human-readable explanation. */
  summary: string;
}

/** Turns Google's verbose 429 body into something decision-ready. Returns null for non-quota errors. */
export function parseQuotaError(status: number, body: string): QuotaInfo | null {
  if (status !== 429) return null;
  let json: { error?: { message?: string; details?: Record<string, unknown>[] } } = {};
  try {
    json = JSON.parse(body);
  } catch {
    return null;
  }
  const details = json.error?.details ?? [];
  const violations = details.flatMap((d) => (Array.isArray(d["violations"]) ? (d["violations"] as Record<string, unknown>[]) : []));
  const ids = violations.map((v) => String(v["quotaId"] ?? "")).filter(Boolean);
  const values = violations.map((v) => String(v["quotaValue"] ?? ""));
  const message = json.error?.message ?? "";

  const daily = ids.some((id) => /perday/i.test(id));
  const zero = values.includes("0") || /limit:\s*0\b/.test(message);

  const delayStr = details.map((d) => d["retryDelay"]).find((v): v is string => typeof v === "string");
  const delaySeconds = delayStr ? parseFloat(delayStr) : NaN;
  const retryAfterMs = Number.isFinite(delaySeconds) ? Math.ceil(delaySeconds * 1000) : undefined;

  const which = ids.length ? ` (${ids.join(", ")}${values[0] ? `, limit ${values[0]}` : ""})` : "";
  let summary = `quota exceeded${which}.`;
  if (zero) summary += " Your plan has no quota for this model or feature; billing may need to be enabled.";
  else if (daily) summary += " The daily quota for this model is used up; it resets around midnight Pacific time.";
  else if (retryAfterMs !== undefined) summary += ` Google asks to retry in ${Math.round(retryAfterMs / 1000)}s.`;
  summary += " Check your usage at https://ai.dev/rate-limit";
  return { daily, zero, retryAfterMs, summary };
}

export class GeminiApiError extends Error {
  constructor(
    public status: number,
    detail: string,
    public quota?: QuotaInfo
  ) {
    super(`Gemini API error ${status}: ${detail}`);
    this.name = "GeminiApiError";
  }
}

/** If Google asks for a longer wait than this, stop instead of freezing the terminal. */
const MAX_HINTED_WAIT_MS = 120_000;

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

interface GroundingMetadata {
  webSearchQueries?: string[];
  groundingChunks?: { web?: { uri?: string; title?: string } }[];
  groundingSupports?: { segment?: { startIndex?: number; endIndex?: number }; groundingChunkIndices?: number[] }[];
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
    groundingMetadata?: GroundingMetadata;
  }[];
  promptFeedback?: { blockReason?: string };
}

/** Gemini via its REST API (no SDK). Patient with temporary errors, optional fallback model. */
export class GeminiLlm implements LlmClient, SearchClient {
  constructor(
    private apiKey: string,
    private model: string,
    private opts: GeminiOptions = {}
  ) {}

  private log(message: string) {
    (this.opts.onRetry ?? ((m: string) => console.error(m)))(message);
  }

  async complete(args: { system: string; messages: LlmMessage[]; maxTokens?: number }): Promise<string> {
    const body = {
      systemInstruction: { parts: [{ text: args.system }] },
      contents: args.messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      // Thinking models count their reasoning against this limit, so keep it generous.
      generationConfig: { maxOutputTokens: args.maxTokens ?? 8192, responseMimeType: "application/json" },
    };
    return this.withFallback(async (model) => this.textOf(await this.request(model, body)));
  }

  /**
   * Google Search grounding. Returns the answer plus the real sources behind it.
   * JSON mode is deliberately NOT requested: it does not combine reliably with the search tool,
   * so structuring happens in a separate call.
   */
  async search(args: { system: string; query: string; maxTokens?: number }): Promise<GroundedResult> {
    const body = {
      systemInstruction: { parts: [{ text: args.system }] },
      contents: [{ role: "user", parts: [{ text: args.query }] }],
      tools: [{ google_search: {} }],
      generationConfig: { maxOutputTokens: args.maxTokens ?? 8192 },
    };
    return this.withFallback(async (model) => {
      const data = await this.request(model, body);
      const text = this.textOf(data);
      const gm = data.candidates?.[0]?.groundingMetadata;
      return {
        text,
        searchQueries: gm?.webSearchQueries ?? [],
        sources: (gm?.groundingChunks ?? []).map((c) => ({ url: c.web?.uri ?? "", title: c.web?.title ?? "" })),
        supports: (gm?.groundingSupports ?? [])
          .map((s) => ({ endIndex: s.segment?.endIndex ?? 0, sourceIndices: s.groundingChunkIndices ?? [] }))
          .filter((s) => s.endIndex > 0 && s.sourceIndices.length > 0),
      };
    });
  }

  private async withFallback<T>(fn: (model: string) => Promise<T>): Promise<T> {
    try {
      return await fn(this.model);
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
        return await fn(fallback);
      } catch (fe) {
        // Report both failures so the original problem is not hidden behind the fallback's.
        const detail = fe instanceof Error ? fe.message : String(fe);
        throw new Error(`Both models failed.\n  main "${this.model}": ${e.message}\n  fallback "${fallback}": ${detail}`);
      }
    }
  }

  private textOf(data: GeminiResponse): string {
    const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    if (!text) {
      const why = data.promptFeedback?.blockReason ?? data.candidates?.[0]?.finishReason ?? "no content returned";
      throw new Error(`Gemini returned no text (${why})`);
    }
    return text;
  }

  private async request(model: string, body: unknown): Promise<GeminiResponse> {
    const url = `${BASE_URL}/${encodeURIComponent(model)}:generateContent`;
    const maxRetries = this.opts.maxRetries ?? 5;
    const baseDelay = this.opts.retryDelayMs ?? 2000;

    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify(body),
      });

      if (res.ok) return (await res.json()) as GeminiResponse;

      // Never include the API key in error text.
      const bodyText = await res.text();
      const quota = parseQuotaError(res.status, bodyText);

      // A hard quota (daily, or zero on this plan) cannot be fixed by waiting a few seconds.
      if (quota && (quota.daily || quota.zero)) throw new GeminiApiError(res.status, quota.summary, quota);
      if (quota?.retryAfterMs !== undefined && quota.retryAfterMs > MAX_HINTED_WAIT_MS) {
        throw new GeminiApiError(res.status, quota.summary, quota);
      }

      if (TRANSIENT.has(res.status) && attempt < maxRetries) {
        // Prefer the wait Google asked for; otherwise back off exponentially. retryDelayMs: 0 disables waiting (tests).
        const delay = baseDelay === 0 ? 0 : (quota?.retryAfterMs ?? baseDelay * 2 ** attempt);
        const why = quota?.retryAfterMs !== undefined ? "as Google asked" : "backing off";
        this.log(`Gemini busy (${res.status}) on "${model}". Retry ${attempt + 1}/${maxRetries} in ${Math.round(delay / 1000)}s (${why})...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw new GeminiApiError(res.status, quota ? quota.summary : bodyText.slice(0, 600), quota ?? undefined);
    }
  }
}
