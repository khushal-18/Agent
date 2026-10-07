export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

/** Everything the rest of the system knows about an LLM. Easy to fake in tests. */
export interface LlmClient {
  complete(args: { system: string; messages: LlmMessage[]; maxTokens?: number }): Promise<string>;
}