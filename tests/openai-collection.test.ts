import { readFile } from "node:fs/promises";
import { claimSources } from "../src/catalog/model-claim-details.ts";
import { describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import { linkedBundleSchema } from "../src/catalog/bundle.ts";
import { collectProvider } from "../src/catalog/collector.ts";
import { fetchSource } from "../src/catalog/fetch.ts";
import { sha256 } from "../src/catalog/io.ts";
import { manifests, type ProviderManifest } from "../src/catalog/manifests.ts";
import { modelPricingView } from "../src/catalog/pricing-presentation.ts";
import { emptyPricingCatalog } from "../src/catalog/pricing-schema.ts";
import { catalogSchema } from "../src/catalog/schema.ts";
import { websiteModelDetail } from "../src/catalog/website-data.ts";

vi.mock("../src/catalog/fetch.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/catalog/fetch.ts")>()),
  fetchSource: vi.fn(),
}));

const observedAt = "2026-07-21T00:00:00.000Z";
const fixture = (name: string) =>
  readFile(new URL("./fixtures/openai/" + name, import.meta.url), "utf8");
const accounting =
  "components:\n  schemas:\n    Response:\n      properties:\n        usage:\n          properties:\n            input_tokens:\n              type: integer";

it("projects reviewed API bindings and retains legacy cache scope when its guide is unavailable", async () => {
  const manifest: ProviderManifest | undefined = manifests.find(
    ({ provider }) => provider.id === "openai",
  );
  const source = manifest?.sources.find(({ id }) => id === "openai-models");
  if (manifest === undefined || manifest.notConfiguredReason !== undefined || source === undefined)
    throw new Error("Missing OpenAI model source");
  const selected: ProviderManifest = { ...manifest, sources: [source] };
  const bundle = linkedBundleSchema.parse(JSON.parse(await fixture("catalog.json")));
  const guide = {
    url: "https://developers.openai.com/api/docs/guides/prompt-caching.md",
    body: await fixture("cache-modes.md"),
  };
  const body = JSON.stringify({ ...bundle, documents: [...bundle.documents, guide] });
  const fetched = { dependencies: [], etag: undefined, lastModified: undefined };
  vi.mocked(fetchSource).mockResolvedValueOnce({ ...fetched, body, contentHash: sha256(body) });
  const prior = await collectProvider(selected, undefined, { sources: {} }, observedAt);
  const model = prior.models.find(({ model_id }) => model_id === "gpt-5.4");
  const cache = model?.capability_details?.find(
    ({ claim }) => claim === "responses_cache_breakpoints",
  );
  if (model === undefined || cache === undefined)
    throw new Error("Missing exact model cache claim");
  const projected = websiteModelDetail(emptyPricingCatalog(), model);
  // Website details cite sources; excerpts and document hashes stay in canonical storage.
  expect(projected.capability_details).toContainEqual({
    ...cache,
    evidence: claimSources(cache.evidence),
  });
  expect(cache.statements).toContainEqual(
    expect.objectContaining({
      mode: "explicit",
      applicability: {
        interface: "OpenAI Responses API",
        parameter: "prompt_cache_options.mode",
        condition: "Caller-selected prefix breakpoints",
        endpoint: "v1/responses",
      },
    }),
  );
  const legacyCache = {
    ...cache,
    statements: cache.statements.map(({ applicability: _structured, ...statement }) => statement),
  };
  const previous = catalogSchema.parse({
    catalog_version: "a".repeat(64),
    generated_at: observedAt,
    providers: [prior.provider],
    models: prior.models.map((entry) =>
      entry.uid === model.uid ? { ...entry, capability_details: [legacyCache] } : entry,
    ),
    sources: prior.sources,
    coverage: [prior.coverage],
    warnings: [],
  });
  const withoutGuide = JSON.stringify(bundle);
  vi.mocked(fetchSource).mockResolvedValueOnce({
    ...fetched,
    body: withoutGuide,
    contentHash: sha256(withoutGuide),
    dependencyFailures: [
      {
        dependency_id: "openai-models/prompt-cache-modes",
        impact: "claim",
        outcome: "fetch_failed",
        message: "HTTP 503",
      },
    ],
  });
  const next = await collectProvider(
    selected,
    previous,
    { sources: {} },
    "2026-07-22T00:00:00.000Z",
  );
  const refreshed = next.models.find(({ uid }) => uid === model.uid);
  if (refreshed === undefined) throw new Error("Missing refreshed exact model");
  const retained = websiteModelDetail(emptyPricingCatalog(), refreshed).capability_details;
  expect(retained).toContainEqual({ ...legacyCache, evidence: claimSources(legacyCache.evidence) });
  expect(retained?.find(({ claim }) => claim === "responses_effort")?.statements).toContainEqual(
    expect.objectContaining({
      applicability: {
        interface: "OpenAI Responses API",
        parameter: "reasoning.effort",
        endpoint: "v1/responses",
      },
    }),
  );
  expect(next.coverage.status).toBe("fresh");
});

it("keeps retired cards out of current inference and tool price books", async () => {
  const manifest: ProviderManifest | undefined = manifests.find(
    ({ provider }) => provider.id === "openai",
  );
  if (manifest === undefined || manifest.notConfiguredReason !== undefined)
    throw new Error("Missing OpenAI manifest");
  const id = "chatgpt-4o-latest";
  const url = `https://developers.openai.com/api/docs/models/${id}`;
  const modelRef = `openai/${id}`;
  const catalog = z
    .object({
      index: z.object({ url: z.string(), body: z.string() }),
      documents: z.array(z.object({ url: z.string(), body: z.string() })),
    })
    .parse(JSON.parse(await fixture("catalog.json")));
  const active = catalog.documents.find(({ url }) => url.endsWith("/gpt-5.4.md"));
  if (active === undefined) throw new Error("Missing GPT-5.4 card");
  active.body = active.body.replace(
    "## Supported tools\n",
    "## Supported tools\n\n- web_search\n- file_search\n",
  );
  catalog.index.body += `\n- [ChatGPT-4o](/api/docs/models/${id}.md): Shut down. GPT-4o model used in ChatGPT`;
  catalog.documents.push({
    url: url + ".md",
    body: [
      "# ChatGPT-4o",
      `Model ID: \`${id}\``,
      "Status: Shut down",
      "",
      "## Model details",
      "",
      "- Input modalities: text, image",
      "- Output modalities: text",
      "",
      "## Endpoints",
      "",
      "| Endpoint | Route | Support |",
      "| --- | --- | --- |",
      "| Responses | `v1/responses` | Supported |",
      "",
      "## Supported tools",
      "",
      "- web_search",
    ].join("\n"),
  });
  const responsesOnly = catalog.documents.find(
    ({ url: documentUrl }) => documentUrl === url + ".md",
  );
  if (responsesOnly === undefined) throw new Error("Missing ChatGPT-4o card");
  catalog.index.body += "\n- [Responses-only model](/api/docs/models/responses-only.md)";
  catalog.documents.push({
    url: "https://developers.openai.com/api/docs/models/responses-only.md",
    body: responsesOnly.body
      .replace(/\n## Supported tools[\s\S]*$/, "")
      .replace("# ChatGPT-4o", "# Responses-only model")
      .replaceAll(id, "responses-only")
      .replace("Status: Shut down\n", ""),
  });
  const bodies = new Map([
    ["openai-models", JSON.stringify(catalog)],
    ["openai-pricing", (await fixture("pricing.md")) + "\n" + (await fixture("fixed-search.md"))],
    [
      "openai-overview",
      (await fixture("pricing-catalog.json"))
        .replaceAll("gpt-5.4", id)
        .replaceAll("GPT-5.4", "ChatGPT-4o"),
    ],
  ]);
  vi.mocked(fetchSource).mockImplementation(async (source) => {
    const body = bodies.get(source.id);
    if (body === undefined) throw new Error("Simulated unavailable source");
    return {
      body,
      contentHash: sha256(body),
      dependencies: [],
      etag: undefined,
      lastModified: undefined,
    };
  });
  const sources = manifest.sources.filter(({ id }) => bodies.has(id));
  const lastSource = sources.pop();
  if (lastSource === undefined) throw new Error("Missing OpenAI sources");
  const selected: ProviderManifest = { ...manifest, sources: [...sources, lastSource] };
  bodies.set("openai-models", JSON.stringify(catalog).replaceAll("Shut down", "Deprecated"));
  const before = await collectProvider(selected, undefined, { sources: {} }, observedAt);
  expect(before.models.find(({ uid }) => uid === modelRef)?.status).toBe("deprecated");
  if (before.pricing === undefined) throw new Error(JSON.stringify(before.attempt));
  expect(
    before.pricing.books.find(({ book_key }) => book_key === `model:${modelRef}`),
  ).toBeDefined();
  expect(
    before.pricing.books.find(({ book_key }) => book_key === "service:web-search")?.scope
      .model_refs,
  ).toContain(modelRef);

  bodies.set("openai-models", JSON.stringify(catalog));
  const result = await collectProvider(selected, undefined, { sources: {} }, observedAt);

  const retired = result.models.find(({ uid }) => uid === modelRef);
  expect(retired).toMatchObject({
    status: "retired",
    api_endpoints: expect.arrayContaining([{ name: "Responses", path: "v1/responses" }]),
  });
  if (result.pricing === undefined || retired === undefined)
    throw new Error(JSON.stringify(result.attempt));
  expect(
    modelPricingView(
      {
        books: result.pricing.books,
        model_dispositions: result.pricing.model_dispositions,
        provider_snapshots: [result.pricing.snapshot],
        provider_vocabularies: [result.pricing.vocabulary],
      },
      retired,
    ),
  ).toMatchObject({ outcome: "not_applicable", optionalServices: [] });
  expect(result.pricing.books.some(({ scope }) => scope.model_refs.includes(modelRef))).toBe(false);
  for (const bookKey of ["service:web-search", "service:file-search"]) {
    expect(result.pricing.books.find(({ book_key }) => book_key === bookKey)?.scope).toMatchObject({
      kind: "provider_resource",
      model_refs: ["openai/gpt-5.4"],
    });
  }
});

describe("OpenAI optional accounting collection", () => {
  it.each(["unavailable", "unrecognized", "partial", "unused"])(
    "refreshes complete rates when accounting is %s",
    async (failure) => {
      const manifest: ProviderManifest | undefined = manifests.find(
        ({ provider }) => provider.id === "openai",
      );
      if (manifest === undefined || manifest.notConfiguredReason !== undefined)
        throw new Error("Missing OpenAI manifest");
      const bodies = new Map([
        ["openai-models", await fixture("catalog.json")],
        [
          "openai-pricing",
          (await fixture("pricing.md")) + "\n" + (await fixture("fixed-search.md")),
        ],
        ["openai-accounting", accounting],
      ]);
      const bundle = z
        .object({
          index: z.object({ url: z.string(), body: z.string() }),
          documents: z.array(z.object({ url: z.string(), body: z.string() })),
        })
        .parse(JSON.parse(bodies.get("openai-models") ?? ""));
      bundle.index.body += "\n- [GPT OSS](/api/docs/models/gpt-oss-20b.md)";
      bundle.documents.push({
        url: "https://developers.openai.com/api/docs/models/gpt-oss-20b.md",
        body: "# GPT OSS\nModel ID: `gpt-oss-20b`\nAn open-weight model.",
      });
      bodies.set("openai-models", JSON.stringify(bundle));
      bodies.set(
        "openai-overview",
        JSON.stringify({
          index: {
            url: "https://developers.openai.com/api/docs/models/all",
            body: '<a href="/api/docs/models/gpt-oss-20b">GPT OSS</a>',
          },
          documents: [
            {
              url: "https://developers.openai.com/api/docs/models/gpt-oss-20b",
              body: "<main>An open-weight model.</main>",
            },
          ],
        }),
      );
      const catalog = manifest.sources.find(({ id }) => id === "openai-models");
      const pricing = manifest.sources.find(({ id }) => id === "openai-pricing");
      const accountingSource = manifest.sources.find(({ id }) => id === "openai-accounting");
      const overview = manifest.sources.find(({ id }) => id === "openai-overview");
      if (
        catalog === undefined ||
        pricing === undefined ||
        accountingSource === undefined ||
        overview === undefined
      )
        throw new Error("Missing OpenAI sources");
      const selected: ProviderManifest = {
        ...manifest,
        sources: [catalog, overview, pricing, accountingSource],
      };
      let partial = false;
      const respond = () =>
        vi.mocked(fetchSource).mockImplementation(async (source) => {
          const body = bodies.get(source.id);
          if (body === undefined) throw new Error("Simulated unavailable optional source");
          return {
            body,
            contentHash: sha256(body),
            etag: undefined,
            lastModified: undefined,
            dependencies: [],
            ...(partial && source.id === "openai-accounting"
              ? {
                  dependencyFailures: [
                    {
                      dependency_id: "openai-accounting/usage",
                      impact: "bundle" as const,
                      outcome: "fetch_failed" as const,
                      message: "HTTP 404",
                      http_status: 404,
                    },
                  ],
                }
              : {}),
          };
        });
      respond();
      const prior = await collectProvider(selected, undefined, { sources: {} }, observedAt);
      if (prior.pricing === undefined) throw new Error(JSON.stringify(prior.attempt));
      expect(
        prior.pricing.books.some((book) =>
          book.offers.some((offer) =>
            offer.terms.some(
              (term) =>
                term.kind === "rate" &&
                term.variants.some((variant) =>
                  variant.charge_binding?.quantity_methods?.some((method) =>
                    method.input_sources?.some((source) => source.channel === "response"),
                  ),
                ),
            ),
          ),
        ),
      ).toBe(true);
      partial = failure === "partial";
      if (failure === "unavailable") bodies.delete("openai-accounting");
      else if (failure === "unused")
        bodies.set(
          "openai-accounting",
          "components:\n  schemas:\n    VideoResource:\n      properties:\n        seconds:\n          type: string",
        );
      else bodies.set("openai-accounting", "components: {}");
      const next = await collectProvider(selected, undefined, { sources: {} }, observedAt);
      expect(next.attempt.outcome).toBe("accepted");
      expect(next.pricingFailure).toBeUndefined();
      expect(next.pricing).toBeDefined();
      const prices = (result: typeof next) =>
        result.pricing?.books.flatMap(({ offers }) =>
          offers.flatMap(({ terms }) =>
            terms.flatMap((term) =>
              term.kind === "rate" ? term.variants.map(({ price }) => price) : [],
            ),
          ),
        );
      expect(prices(next)).toEqual(prices(prior));
      if (failure === "unused") {
        expect(
          next.models.every(({ source_refs }) => !source_refs.includes(accountingSource.id)),
        ).toBe(true);
        expect(next.sources.some(({ id }) => id === accountingSource.id)).toBe(true);
        expect(
          next.pricingReplaySources?.find(({ source_id }) => source_id === accountingSource.id),
        ).toMatchObject({
          models: [],
          pricing_inputs: [expect.objectContaining({ key: "responses.generated_seconds" })],
        });
        return;
      }
      expect(next.pricingReplaySources?.map(({ source_id }) => source_id)).toEqual([
        "openai-models",
        "openai-overview",
        "openai-pricing",
      ]);
      const required: ProviderManifest = {
        ...selected,
        sources: [catalog, overview, pricing, { ...accountingSource, pricingRequired: true }],
      };
      const retained = await collectProvider(required, undefined, { sources: {} }, observedAt);
      expect(retained.pricingFailure).toBe("source_unavailable");
      expect(retained.pricing).toBeUndefined();
      expect(retained.pricingReplaySources).toBeUndefined();
      bodies.delete("openai-overview");
      const missingRates = await collectProvider(selected, undefined, { sources: {} }, observedAt);
      expect(missingRates.pricingFailure).toBe("source_unavailable");
      expect(missingRates.pricing).toBeUndefined();
      expect(missingRates.pricingReplaySources).toBeUndefined();
    },
  );
});
