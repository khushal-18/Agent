import Anthropic from "@anthropic-ai/sdk";
import type { LlmClient, LlmMessage } from "./types";

export class AnthropicLlm implements LlmClient {
  private client: Anthropic;

  constructor(
    apiKey: string,
    private model: string
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(args: { system: string; messages: LlmMessage[]; maxTokens?: number }): Promise<string> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: args.maxTokens ?? 4096,
      system: args.system,
      messages: args.messages,
    });
    return res.content.map((block) => (block.type === "text" ? block.text : "")).join("");
  }
}