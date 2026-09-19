import { readFile } from "node:fs/promises";
import { expect, it } from "vite-plus/test";
import { extractVercelPricingInputs } from "../src/catalog/vercel-accounting.ts";

const fixture = (name: string) =>
  readFile(new URL(`./fixtures/vercel/${name}.md`, import.meta.url), "utf8");

it("recovers documented successful search counts across actual Markdown line wrapping", async () => {
  const path = "/docs/ai-gateway/models-and-providers/web-search.md";
  const body = await fixture("search-usage-wrapped");
  const facts = extractVercelPricingInputs(new Map([[path, body]]), "vercel-models");
  expect(facts.map(({ key }) => key).toSorted()).toEqual([
    "search.exa.successful_calls",
    "search.parallel.successful_calls",
    "search.perplexity.successful_calls",
    "search.tako.successful_calls",
  ]);
  expect(
    facts.every(
      ({ channel, availability }) => channel === "response" && availability === "terminal_only",
    ),
  ).toBe(true);
  expect(
    extractVercelPricingInputs(
      new Map([
        [path, body.replace("successful search-call counts", "attempted search-call counts")],
      ]),
      "vercel-models",
    ),
  ).toEqual([]);
  expect(
    extractVercelPricingInputs(
      new Map([[path, body.replace("\nfor successful", "\n\nfor successful")]]),
      "vercel-models",
    ),
  ).toEqual([]);
});

it("recognizes current standard-tier omission wording without treating absent client metadata as evidence", async () => {
  const path = "/docs/ai-gateway/models-and-providers/service-tiers.md";
  const body = await fixture("service-tier-usage");
  expect(extractVercelPricingInputs(new Map([[path, body]]), "vercel-models")).toEqual([
    expect.objectContaining({
      key: "gateway.served_service_tier",
      selector_absent_value: "standard",
    }),
  ]);
  expect(
    extractVercelPricingInputs(
      new Map([
        [
          path,
          body.replace(
            "If the provider reports the standard tier, AI Gateway omits this field.",
            "",
          ),
        ],
      ]),
      "vercel-models",
    ),
  ).toEqual([]);
});

it("recovers the documented default-region boundary across Markdown line wrapping", async () => {
  const path = "/docs/ai-gateway/security-and-compliance/regional-inference.md";
  expect(
    extractVercelPricingInputs(
      new Map([[path, await fixture("region-usage-wrapped")]]),
      "vercel-models",
    ),
  ).toEqual([
    expect.objectContaining({
      key: "gateway.served_region",
      selector_absent_value: "default",
      locator: {
        kind: "provider_field",
        value:
          "providerMetadata.gateway.routing.modelAttempts[successful].providerAttempts[successful].inferenceEndpoint.geoRegion",
      },
    }),
  ]);
});
