import { readFile } from "node:fs/promises";
import { auditSnapshot } from "../src/catalog/semantic-audit.ts";

export const searchUrl = "https://vercel.com/docs/ai-gateway/models-and-providers/web-search.md";
export const observedAt = "2026-09-19T00:00:00.000Z";
export const tools =
  "Built-in search tools: exaSearch (vercel:exa_search), parallelSearch (vercel:parallel_search), perplexitySearch (vercel:perplexity_search), takoSearch (vercel:tako_search).";
export const changedMeaning = `${tools}
## Current accounting
The Chat Completions response field choices[0].message.provider_metadata.gateway.gatewayToolCalls counts ALL attempted built-in search calls, including failures, for every tool listed above. It is NOT a successful-call counter.
## Obsolete guidance (do not use)
The old documentation said: inspect gatewayToolCalls for successful search-call counts. That statement is obsolete and incorrect for the current API.`;

export async function semanticFixture(body?: string, url = searchUrl) {
  return auditSnapshot(
    [
      {
        url,
        body:
          body ??
          (await readFile(
            new URL("./fixtures/vercel/search-usage-wrapped.md", import.meta.url),
            "utf8",
          )),
      },
    ],
    observedAt,
  );
}
