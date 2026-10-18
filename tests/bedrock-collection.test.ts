import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import { collectProvider, pricingCompilationEntries } from "../src/catalog/collector.ts";
import { fetchSource } from "../src/catalog/fetch.ts";
import { manifests, type ProviderManifest } from "../src/catalog/manifests.ts";
import { composeCatalogPair } from "../src/catalog/pricing-pair-transition.ts";
import { prepareCatalogPair } from "../src/catalog/pricing-publication.ts";
import { createPricingCompilationSnapshot } from "../src/catalog/pricing-compilation.ts";
import { failedPricingTransition } from "../src/catalog/pricing-transition.ts";
import type { Catalog } from "../src/catalog/schema.ts";
import type { PricingCatalog } from "../src/catalog/pricing-schema.ts";

vi.mock("../src/catalog/fetch.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/catalog/fetch.ts")>()),
  fetchSource: vi.fn(),
}));

const previousAt = "2026-07-20T00:00:00.000Z";
const currentAt = "2026-07-21T00:00:00.000Z";

function core(result: Awaited<ReturnType<typeof collectProvider>>, at: string): Catalog {
  return {
    catalog_version: "1".repeat(64),
    generated_at: at,
    providers: [result.provider],
    models: result.models,
    sources: result.sources,
    coverage: [result.coverage],
    warnings: result.warnings,
  };
}

describe("Bedrock collection dependency isolation", () => {
  it.each([
    "invalid JSON",
    "rejected envelope",
    "wrong offer",
    "rejected product",
    "rejected term",
    "rejected dimension",
    "wrong SKU",
    "duplicate document",
  ])("advances the catalog and retains complete pricing after %s", async (failure) => {
    const manifest: ProviderManifest | undefined = manifests.find(
      ({ provider }) => provider.id === "amazon-bedrock",
    );
    const source = manifest?.sources[0];
    if (
      manifest === undefined ||
      source === undefined ||
      manifest.notConfiguredReason !== undefined
    )
      throw new Error("Missing Bedrock source");
    const singleSource: ProviderManifest = { ...manifest, sources: [source] };
    const bundle = z
      .object({
        index: z.object({ url: z.string(), body: z.string() }),
        documents: z.array(z.object({ url: z.string(), body: z.string() })),
      })
      .parse(
        JSON.parse(
          await readFile(new URL("./fixtures/document/bedrock.json", import.meta.url), "utf8"),
        ),
      );
    const list = bundle.documents.find(({ url }) => url.includes("/AmazonBedrock/current/"));
    if (list === undefined) throw new Error("Missing core list fixture");
    const prices = z
      .object({
        offerCode: z.string(),
        products: z.record(z.string(), z.unknown()),
        terms: z.object({ OnDemand: z.record(z.string(), z.unknown()) }),
      })
      .parse(JSON.parse(list.body));
    prices.products.ROUTING = {
      sku: "ROUTING",
      attributes: {
        feature: "Prompt Router",
        regionCode: "us-east-1",
        usagetype: "USE1-PromptRouter",
      },
    };
    prices.terms.OnDemand.ROUTING = {
      term: {
        priceDimensions: {
          rate: {
            description: "$0.001 per request",
            unit: "Requests",
            pricePerUnit: { USD: "0.001" },
          },
        },
      },
    };
    list.body = JSON.stringify(prices);
    const body = JSON.stringify(bundle);
    const respond = (body: string) =>
      vi.mocked(fetchSource).mockResolvedValue({
        body,
        contentHash: "1".repeat(64),
        etag: undefined,
        lastModified: undefined,
        dependencies: [],
      });
    respond(body);
    const prior = await collectProvider(singleSource, undefined, { sources: {} }, previousAt);
    if (prior.pricing === undefined || prior.pricingReplaySources === undefined)
      throw new Error(JSON.stringify(prior.attempt));
    const catalog = core(prior, previousAt);
    const pricing: PricingCatalog = {
      provider_vocabularies: [prior.pricing.vocabulary],
      provider_snapshots: [prior.pricing.snapshot],
      model_dispositions: prior.pricing.model_dispositions,
      books: prior.pricing.books,
    };
    const accepted = prepareCatalogPair(catalog, pricing);
    const previousReplay = createPricingCompilationSnapshot(accepted, [
      {
        provider_id: manifest.provider.id,
        sources: prior.pricingReplaySources,
      },
    ]);
    const url =
      "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrockFoundationModels/current/index.json";
    const product = {
      sku: failure === "wrong SKU" ? "OTHER" : "BROKEN",
      attributes: {
        model: "Claude Haiku 4.5",
        regionCode: "us-east-1",
        usagetype: "USE1-ClaudeHaiku45-input-tokens",
      },
    };
    const dimension = {
      description: "$99 per million input tokens",
      unit: "1M tokens",
      pricePerUnit: { USD: "99" },
    };
    const bad =
      failure === "invalid JSON"
        ? "{"
        : JSON.stringify({
            offerCode:
              failure === "wrong offer" ? "AmazonBedrockService" : "AmazonBedrockFoundationModels",
            products:
              failure === "rejected envelope"
                ? []
                : {
                    BROKEN: failure === "rejected product" ? null : product,
                  },
            terms: {
              OnDemand: {
                BROKEN: {
                  term:
                    failure === "rejected term"
                      ? null
                      : {
                          priceDimensions: {
                            rate: failure === "rejected dimension" ? null : dimension,
                          },
                        },
                },
              },
            },
          });
    // Keep the valid sibling list and add a separately observable catalog metadata update.
    const damaged = bundle.documents.find((document) => document.url === url);
    if (damaged === undefined) throw new Error("Missing Marketplace price list fixture");
    if (failure === "duplicate document") bundle.documents.push({ ...damaged });
    else damaged.body = bad;
    const nextBody = JSON.stringify(bundle).replace(
      "fast multimodal model.",
      "fast multimodal model with updated documentation.",
    );
    expect(nextBody).not.toBe(body);
    respond(nextBody);
    const next = await collectProvider(singleSource, catalog, { sources: {} }, currentAt);
    expect(next.attempt.outcome).toBe("accepted");
    expect(next.coverage.status).toBe("fresh");
    expect(
      next.models.find(({ model_id }) => model_id.includes("claude-haiku"))?.description,
    ).toContain("updated documentation");
    expect(next.pricing).toBeUndefined();
    expect(next.pricingReplaySources).toBeUndefined();
    expect(next.pricingFailure).toBe("source_schema_changed");
    const transition = failedPricingTransition(
      manifest.provider.id,
      currentAt,
      "source_schema_changed",
    );
    const composed = composeCatalogPair(catalog, core(next, currentAt), pricing, [transition]);
    expect(composed.catalog.models).toEqual(next.models);
    expect(composed.pricing.books).toEqual(pricing.books);
    expect(composed.pricing.provider_snapshots[0]).toMatchObject({
      publication: "retained",
      observed_at: previousAt,
      refresh_failure: { code: "source_schema_changed", attempted_at: currentAt },
    });
    const candidate = prepareCatalogPair(composed.catalog, composed.pricing);
    const entries = pricingCompilationEntries(
      candidate,
      [next],
      new Map([[manifest.provider.id, transition]]),
      new Set(),
      previousReplay,
    );
    expect(entries).toEqual(previousReplay.providers);
    expect(createPricingCompilationSnapshot(candidate, entries).providers).toEqual(
      previousReplay.providers,
    );
  });
});
