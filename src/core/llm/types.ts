export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

/** Everything the rest of the system knows about an LLM. Easy to fake in tests. */
export interface LlmClient {
  complete(args: { system: string; messages: LlmMessage[]; maxTokens?: number }): Promise<string>;
}

/** One web source behind a grounded answer. */
export interface GroundedSource {
  url: string;
  title: string;
}

/** "The text up to endIndex (UTF-8 bytes) is supported by these sources (indices into `sources`)." */
export interface GroundedSupport {
  endIndex: number;
  sourceIndices: number[];
}

/** `sources` keeps the provider's index order, so a source with no URL has url "". */
export interface GroundedResult {
  text: string;
  searchQueries: string[];
  sources: GroundedSource[];
  supports: GroundedSupport[];
}

/** A model that can search the live web and report which sources backed its answer. */
export interface SearchClient {
  search(args: { system: string; query: string; maxTokens?: number }): Promise<GroundedResult>;
}
