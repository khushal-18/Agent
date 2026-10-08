import { createSearchFromEnv } from "../src/core/llm/factory";

/** Usage: npm run search:ping -- "your query"   Checks that Google Search grounding works for your key and model. */
async function main() {
  const query = process.argv[2] ?? "best inventory forecasting apps for Shopify stores";
  const res = await createSearchFromEnv({ cache: false }).search({
    system: "You are a market researcher with live Google Search. Be brief and factual.",
    query,
    maxTokens: 2048,
  });
  console.log(`\nQuery: ${query}\n`);
  console.log(res.text.slice(0, 800), res.text.length > 800 ? "..." : "");
  console.log(`\nSearches Google ran: ${res.searchQueries.join(" | ") || "(none reported)"}`);
  console.log(`Sources (${res.sources.length}):`);
  res.sources.forEach((s, i) => console.log(`  [${i}] ${s.title || "(no title)"}\n       ${s.url || "(no url)"}`));
  console.log(`Citation spans: ${res.supports.length}`);
  if (!res.sources.length) console.log("\nNo sources came back: this answer was NOT grounded in search, so research would discard it.");
}

main().catch((e) => {
  console.error("Search ping failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
