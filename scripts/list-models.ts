import { getEnv } from "../src/core/env";

interface ModelInfo {
  name: string;
  displayName?: string;
  supportedGenerationMethods?: string[];
}

async function main() {
  const env = getEnv();
  if (env.LLM_PROVIDER !== "gemini") {
    console.log("LLM_PROVIDER is not gemini; nothing to list.");
    return;
  }

  const models: ModelInfo[] = [];
  let pageToken = "";
  do {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=100${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const res = await fetch(url, { headers: { "x-goog-api-key": env.GEMINI_API_KEY! } });
    if (!res.ok) throw new Error(`Gemini API error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { models?: ModelInfo[]; nextPageToken?: string };
    models.push(...(data.models ?? []));
    pageToken = data.nextPageToken ?? "";
  } while (pageToken);

  const usable = models
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""))
    .sort();

  console.log(`Models your key can use with generateContent (${usable.length}):\n`);
  for (const name of usable) console.log(`  ${name}${name === env.GEMINI_MODEL ? "   <- current GEMINI_MODEL" : ""}`);
  console.log("\nSet GEMINI_MODEL and GEMINI_FALLBACK_MODEL in .env to names from this list.");
}

main().catch((e) => {
  console.error("Could not list models:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
