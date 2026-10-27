import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { linkedDocumentUrls } from "../src/catalog/fetch.ts";
import { applyGroups } from "../src/catalog/collector.ts";
import { manifests, type ProviderManifest, type SourceManifest } from "../src/catalog/manifests.ts";
import { baseModel } from "../src/catalog/model.ts";
import {
  extractMistralCommercialFacts,
  parseMistralPricingCards,
} from "../src/catalog/mistral-commercial-source.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import { capturePricingReplaySources } from "../src/catalog/pricing-compilation.ts";
import { validateAdoptedTopology } from "../src/catalog/pricing-adopted-topology.ts";
import { mistralCurrencyUrl, mistralPriorityUrl } from "../src/catalog/mistral-pricing-policy.ts";
import { evaluateRateCost } from "../src/catalog/pricing-calculation.ts";
import { projectPricingTableCell } from "../src/catalog/pricing-presentation.ts";
import { evaluateModelApplicability } from "../src/catalog/pricing-applicability.ts";
import { validatePricingCatalog } from "../src/catalog/pricing-validation.ts";
import { calculationExport } from "../src/catalog/pricing-calculator-export.ts";
import { createCalculator } from "../src/pricing/index.ts";
import type { PricingReconciliationItem } from "../src/catalog/pricing-reconciliation.ts";
import type { ParsedProviderModel as ProviderModel } from "../src/catalog/pricing-source.ts";
import type { Catalog, Provider } from "../src/catalog/schema.ts";
import type { SourceContractEvidence } from "../src/catalog/source-contract.ts";
import type { SourceParseResult } from "../src/catalog/source-parse.ts";

const observedAt = "2026-07-21T00:00:00.000Z";

async function fixture(path: string): Promise<string> {
  return readFile(new URL(`./fixtures/${path}`, import.meta.url), "utf8");
}

function manifest(providerId: string): ProviderManifest {
  const value = manifests.find((item) => item.provider.id === providerId);
  if (value === undefined) throw new Error(`Missing manifest ${providerId}`);
  return value;
}

function provider(value: ProviderManifest): Provider {
  return { ...value.provider, source_ids: value.sources.map((source) => source.id) };
}

async function mistralSource(
  overrides: {
    endpoints?: string;
    large?: string;
    medium?: string;
    omitDocument?: string;
    openapi?: string;
    pricing?: string;
    pricingDocuments?: readonly { url: string; body: string }[];
    schema?: string;
  } = {},
  onPricingReconciliation?: (item: PricingReconciliationItem) => void,
  onContractFinding?: (evidence: SourceContractEvidence) => void,
): Promise<SourceParseResult> {
  const value = manifest("mistral");
  const configured = value.sources[0];
  if (configured === undefined || configured.extractor.kind !== "mistral-catalog")
    throw new Error("Missing Mistral source");
  const source: SourceManifest = {
    ...configured,
    extractor: {
      kind: "mistral-catalog",
      minModels: 7,
      maxModels: 7,
    },
  };
  const slugs = [
    "mistral-medium-3-5-26-04",
    "codestral-embed-25-05",
    "ocr-4-0",
    "voxtral-tts-26-03",
    "voxtral-small-25-07",
    "mistral-large-2-0-24-07",
    "mistral-large-3-25-12",
  ];
  const fixedDocuments = [
    [
      "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/schema/models/schema.ts",
      "schema.ts",
      overrides.schema,
    ],
    [
      "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/schema/models/endpoints.ts",
      "endpoints.ts",
      overrides.endpoints,
    ],
    [
      "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/content/en/docs/studio/conversations/advanced/prompt-caching/page.mdx",
      "prompt-caching.md",
      undefined,
    ],
    [
      "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/content/en/docs/studio/batch-processing/page.mdx",
      "batch-processing.md",
      undefined,
    ],
  ] as const;
  const body = JSON.stringify({
    index: { url: source.url, body: await fixture("mistral/index.ts") },
    documents: [
      ...(await Promise.all(
        fixedDocuments
          .filter(([url]) => url !== overrides.omitDocument)
          .map(async ([url, path, override]) => ({
            url,
            body: override ?? (await fixture(`mistral/${path}`)),
          })),
      )),
      ...(await Promise.all(
        slugs.map(async (slug) => ({
          url: `https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/schema/models/models/${slug}.ts`,
          body:
            slug === "mistral-medium-3-5-26-04" && overrides.medium !== undefined
              ? overrides.medium
              : slug === "mistral-large-3-25-12" && overrides.large !== undefined
                ? overrides.large
                : await fixture(`mistral/${slug}.ts`),
        })),
      )),
    ],
  });
  const catalog = parseSource({
    provider: provider(value),
    source,
    body,
    observedAt,
    ...(onPricingReconciliation === undefined ? {} : { onPricingReconciliation }),
    ...(onContractFinding === undefined ? {} : { onContractFinding }),
  }).models;
  if (overrides.omitDocument === "https://mistral.ai/pricing/api/") return { models: catalog };
  const configuredPricing = value.sources.find(({ id }) => id === "mistral-pricing");
  if (configuredPricing === undefined || configuredPricing.extractor.kind !== "mistral-pricing")
    throw new Error("Missing Mistral pricing source");
  const pricingSource: SourceManifest = {
    ...configuredPricing,
    extractor: { kind: "mistral-pricing", minCards: 1, maxCards: 50 },
  };
  const pricingDocuments = [
    [
      "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/openapi.yaml",
      "openapi.yaml",
      overrides.openapi,
    ],
    [
      "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/content/en/docs/studio/conversations/advanced/prompt-caching/page.mdx",
      "prompt-caching.md",
      undefined,
    ],
    [
      "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/content/en/docs/studio/agents/agent-tools/code_interpreter/page.mdx",
      "code-interpreter.mdx",
      undefined,
    ],
    [
      "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/content/en/docs/studio/agents/agent-tools/websearch/page.mdx",
      "web-search.mdx",
      undefined,
    ],
    [
      "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/content/en/docs/studio/agents/agent-tools/image_generation/page.mdx",
      "image-generation.mdx",
      undefined,
    ],
    [
      "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/content/en/docs/studio/search/libraries/page.mdx",
      "libraries.mdx",
      undefined,
    ],
  ] as const;
  const pricing = parseSource({
    provider: provider(value),
    source: pricingSource,
    body: JSON.stringify({
      index: {
        url: pricingSource.url,
        body: overrides.pricing ?? (await fixture("mistral/pricing.html")),
      },
      documents: [
        ...(await Promise.all(
          pricingDocuments
            .filter(([url]) => url !== overrides.omitDocument)
            .map(async ([url, path, override]) => ({
              url,
              body: override ?? (await fixture(`mistral/${path}`)),
            })),
        )),
        ...(overrides.pricingDocuments ?? []),
      ],
    }),
    observedAt,
    catalogModels: catalog,
    ...(onPricingReconciliation === undefined ? {} : { onPricingReconciliation }),
    ...(onContractFinding === undefined ? {} : { onContractFinding }),
  });
  const pricingByUid = new Map(pricing.models.map((model) => [model.uid, model]));
  return {
    ...pricing,
    // Catalog merging resolves metadata; canonical pricing still needs every native price peer.
    models: applyGroups(catalog, [{ source: pricingSource, ...pricing }], false).map((model) => {
      const priced = pricingByUid.get(model.uid);
      return priced === undefined
        ? model
        : {
            ...model,
            pricing_state: priced.pricing_state,
            price_facts: priced.price_facts,
            raw_price_facts: priced.raw_price_facts,
          };
    }),
  };
}

async function mistralCatalog(...args: Parameters<typeof mistralSource>): Promise<ProviderModel[]> {
  return (await mistralSource(...args)).models;
}

function withoutMistralPrices(body: string): string {
  return body
    .replace('input: [{ type: "range", price: 1.5, denominator: "/M Tokens" }]', "input: []")
    .replace('output: [{ type: "range", price: 7.5, denominator: "/M Tokens" }]', "output: []");
}

function withoutMistralPublicMedium(body: string): string {
  return body.replaceAll("mistral-medium-latest", "unlisted-medium");
}

describe("Mistral adapters", () => {
  it("accounts for the regional control without inventing model availability or replacing missing service topology", async () => {
    const items: PricingReconciliationItem[] = [];
    const result = await mistralSource(
      {
        pricing: (await fixture("mistral/pricing-table.html")).replace(
          "<main>",
          "<main><label>Regional inference</label>",
        ),
      },
      (item) => items.push(item),
    );
    const models = result.models;
    expect(items).toContainEqual({
      disposition: "excluded",
      reason_code: "regional_pricing_requires_model_availability",
    });
    expect(
      models.every(({ price_facts }) =>
        price_facts.every(({ conditions }) => conditions.region === undefined),
      ),
    ).toBe(true);
    const source = manifest("mistral").sources.find(({ id }) => id === "mistral-pricing");
    if (source === undefined) throw new Error("Missing Mistral source");
    const partition = assembleParsedProviderPricing(
      "mistral",
      observedAt,
      [{ source, ...result }],
      models,
    );
    if (partition === undefined) throw new Error("Missing Mistral partition");
    expect(partition.books.some(({ scope }) => scope.kind === "provider_resource")).toBe(false);
    expect(() => validateAdoptedTopology(partition)).toThrow("commercial topology changed");
  });

  it.each(["before", "after"])(
    "withholds conflicting same-page prices %s the original row",
    async (order) => {
      const extra = `<mistral-block-card-model><mistral-atom-button-copy-clipboard data-text="mistral-medium-latest"></mistral-atom-button-copy-clipboard><div><p>Input (/M tokens)</p><mistral-atom-text-price data-prices='{"priceEur":1.4,"priceUsd":1.6}'></mistral-atom-text-price></div></mistral-block-card-model>`;
      const body = await fixture("mistral/pricing.html");
      const pricing =
        order === "before"
          ? body.replace("<main>", `<main>${extra}`)
          : body.replace("</main>", `${extra}</main>`);
      const result = await mistralSource({ pricing });
      const models = result.models;
      const value = manifest("mistral");
      const source = value.sources.find(({ id }) => id === "mistral-pricing");
      if (source === undefined) throw new Error("Missing Mistral pricing source");
      const partition = assembleParsedProviderPricing(
        "mistral",
        observedAt,
        [{ source, ...result }],
        models,
      );
      const sync = partition?.books
        .find(({ book_key }) => book_key === "model:mistral/mistral-medium-3-5@26.04")
        ?.offers.find(({ offer_key }) => offer_key === "sync");
      const input = sync?.terms.find(
        (term) => term.kind === "rate" && term.meter.value === "input_text",
      );
      if (input?.kind !== "rate") throw new Error("Missing input rate term");
      expect(input.variants).toEqual([]);
      expect(input.raw_variants.some(({ reason }) => reason === "conflicting_values")).toBe(true);
      const output = sync?.terms.find(
        (term) => term.kind === "rate" && term.meter.value === "output_text",
      );
      if (output?.kind !== "rate") throw new Error("Missing output rate term");
      expect(output.variants.length).toBeGreaterThan(0);
    },
  );

  it("derives current EUR and served Priority rates without applying Priority to Batch or non-completion models", async () => {
    const result = await mistralSource({
      pricing: await fixture("mistral/pricing-table.html"),
      pricingDocuments: [
        { url: mistralCurrencyUrl, body: await fixture("mistral/pricing-currency.ts") },
        { url: mistralPriorityUrl, body: await fixture("mistral/priority-tier.md") },
      ],
    });
    const models = result.models;
    const medium = models.find(({ model_id }) => model_id === "mistral-medium-3-5");
    if (medium === undefined) throw new Error("Missing Mistral medium");
    expect(medium.price_facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          meter: "input_text",
          currency: "EUR",
          price: "1.275",
          derived: true,
          conditions: { billing_currency: "EUR", service_tier: "standard" },
        }),
        expect.objectContaining({
          meter: "input_text",
          currency: "USD",
          price: "2.625",
          derived: true,
          conditions: {
            billing_currency: "USD",
            service_tier: "priority",
            endpoint: "/v1/chat/completions",
          },
        }),
        expect.objectContaining({
          meter: "cache_read_text",
          currency: "USD",
          price: "0.2625",
          conditions: {
            billing_currency: "USD",
            service_tier: "priority",
            endpoint: "/v1/chat/completions",
          },
        }),
        expect.objectContaining({
          meter: "input_text",
          currency: "EUR",
          price: "0.6375",
          conditions: { billing_currency: "EUR", service_tier: "batch" },
        }),
      ]),
    );
    expect(
      models
        .filter(({ model_id }) =>
          ["codestral-embed-2505", "mistral-ocr-4-0", "voxtral-mini-tts-2603"].includes(model_id),
        )
        .every(({ price_facts }) =>
          price_facts.every(({ conditions }) => conditions.service_tier !== "priority"),
        ),
    ).toBe(true);
    const source = manifest("mistral").sources.find(({ id }) => id === "mistral-pricing");
    if (source === undefined) throw new Error("Missing Mistral source");
    const partition = assembleParsedProviderPricing(
      "mistral",
      observedAt,
      [{ source, ...result }],
      models,
    );
    if (partition === undefined) throw new Error("Missing Mistral partition");
    const data = {
      books: partition.books,
      provider_snapshots: [partition.snapshot],
      provider_vocabularies: [partition.vocabulary],
      model_dispositions: partition.model_dispositions,
    };
    const core: Catalog = {
      catalog_version: "a".repeat(64),
      generated_at: observedAt,
      coverage: [],
      warnings: [],
      providers: [provider(manifest("mistral"))],
      models,
      sources: [source].map((entry) => ({
        id: entry.id,
        provider_id: "mistral",
        url: entry.url,
        source: entry.source ?? [entry.type],
        stability: entry.stability,
        scope: "global",
        exhaustive: false,
        role: entry.role ?? "catalog",
        field_paths: entry.fields,
        pricing_evidence: entry.pricingEvidence,
        observed_at: observedAt,
        content_hash: "1".repeat(64),
        extractor_version: entry.extractorVersion,
      })),
    };
    validatePricingCatalog(data, core);
    expect(projectPricingTableCell(data, medium, "input")).toBeUndefined();
    const sync = partition.books
      .find(({ book_key }) => book_key === `model:${medium.uid}`)
      ?.offers.find(({ offer_key }) => offer_key === "sync");
    const input = sync?.terms.find(
      (term) => term.kind === "rate" && term.meter.value === "input_text",
    );
    if (input?.kind !== "rate") throw new Error("Missing input term");
    const selections = (tier: string, endpoint = "/v1/chat/completions") => [
      {
        kind: "categorical" as const,
        dimension: { namespace: "kmodels" as const, value: "endpoint" as const },
        value: { namespace: "provider" as const, provider_id: "mistral", value: endpoint },
      },
      {
        kind: "categorical" as const,
        dimension: { namespace: "kmodels" as const, value: "served_service_tier" as const },
        value: { namespace: "provider" as const, provider_id: "mistral", value: tier },
      },
      {
        kind: "categorical" as const,
        dimension: { namespace: "kmodels" as const, value: "billing_currency" as const },
        value: { namespace: "provider" as const, provider_id: "mistral", value: "USD" },
      },
    ];
    const priority = input.variants.find(
      ({ applicability }) =>
        evaluateModelApplicability(applicability, medium.uid, selections("priority")).state ===
        "true",
    );
    if (priority === undefined) throw new Error("Missing Priority rate");
    expect(
      evaluateModelApplicability(
        priority.applicability,
        medium.uid,
        selections("priority", "/v1/conversations"),
      ).state,
    ).toBe("false");
    expect(
      priority.charge_binding?.quantity_methods
        ?.flatMap(({ input_sources }) => input_sources ?? [])
        .some(({ locator }) => locator.value === "/usage/connector_tokens"),
    ).toBe(false);
    expect(
      evaluateModelApplicability(priority.applicability, medium.uid, selections("auto")).state,
    ).toBe("false");
    expect(priority.selector_sources).toContainEqual(
      expect.objectContaining({
        dimension: { namespace: "kmodels", value: "served_service_tier" },
        channel: "response",
        locator: { kind: "json_pointer", value: "/usage/service_tier" },
      }),
    );
    expect(
      evaluateRateCost(priority, [
        {
          signal: { namespace: "kmodels", value: "input_tokens" },
          value: { numerator: "1000000", denominator: "1" },
        },
        {
          signal: { namespace: "kmodels", value: "cached_input_tokens" },
          value: { numerator: "0", denominator: "1" },
        },
      ]),
    ).toMatchObject({ kind: "resolved", amount: { numerator: "21", denominator: "8" } });
    if (sync === undefined) throw new Error("Missing synchronous offer");
    const calculator = createCalculator(
      calculationExport(core, {
        core_catalog_version: core.catalog_version,
        core_data_sha256: "c".repeat(64),
        pricing_data_version: "b".repeat(64),
        generated_at: observedAt,
        data,
      }),
    );
    const quantities = [
      {
        signal: { namespace: "kmodels" as const, value: "input_tokens" as const },
        value: { numerator: "1000000", denominator: "1" },
      },
      {
        signal: { namespace: "kmodels" as const, value: "cached_input_tokens" as const },
        value: { numerator: "0", denominator: "1" },
      },
      {
        signal: { namespace: "kmodels" as const, value: "output_tokens" as const },
        value: { numerator: "0", denominator: "1" },
      },
    ];
    const calculated = calculator.calculate({
      evaluatedAt: observedAt,
      components: [
        { id: "request", offerRef: sync.id, selectors: selections("priority"), quantities },
      ],
    });
    expect(calculated).toMatchObject({
      status: "calculated",
      totals: [
        {
          denomination: { kind: "fiat", currency: "USD" },
          amount: { numerator: "21", denominator: "8" },
        },
      ],
    });
    expect(() =>
      calculator.calculate({
        evaluatedAt: observedAt,
        components: [
          { id: "request", offerRef: sync.id, selectors: selections("auto"), quantities },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_REQUEST" }));
  });

  it("reads a per-million-token output cell published beside per-minute audio rates", async () => {
    const result = await mistralSource({
      pricing: await fixture("mistral/pricing-table.html"),
    });
    const small = result.models.find(({ model_id }) => model_id === "voxtral-small-2507");
    if (small === undefined) throw new Error("Missing Voxtral Small");
    expect(small.price_facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          meter: "output_text",
          unit: "million_tokens",
          price: "0.4",
          raw_price: "0.4",
        }),
      ]),
    );
  });

  it("counts only the currencies published for a library retrieval price", () => {
    const model = baseModel({
      providerId: "mistral",
      id: "example-model",
      name: "Example",
      sourceId: "mistral-models",
      observedAt,
    });
    const items: PricingReconciliationItem[] = [];
    const facts = extractMistralCommercialFacts(
      { models: [model], sourceId: "mistral-pricing", reconcile: (item) => items.push(item) },
      [
        {
          id: "",
          title: "Libraries",
          text: "",
          modelUrls: [],
          free: false,
          rows: [{ label: "Call", priceUsd: "0.01", prefix: null, suffix: "/call" }],
        },
      ],
    );
    expect(facts[0]?.price_facts).toMatchObject([
      { currency: "USD", price: "0.01", unit: "request" },
    ]);
    expect(items).toEqual([
      { disposition: "normalized", reason_code: "normalized_provider_service_price" },
    ]);
  });

  it("keeps accounting contracts when the first catalog model has no price-page row", async () => {
    const pricing = (await fixture("mistral/pricing-table.html")).replace(
      ">Codestral Embed <span",
      ">Unbound embedding <span",
    );
    const result = await mistralSource({ pricing });
    const models = result.models;
    expect(result.pricing_inputs).toHaveLength(20);
    expect(
      models.every(
        (model) =>
          !Object.hasOwn(model, "pricing_inputs") && !Object.hasOwn(model, "commercial_facts"),
      ),
    ).toBe(true);
    const value = manifest("mistral");
    const source = value.sources.find(({ id }) => id === "mistral-pricing");
    if (source === undefined) throw new Error("Missing Mistral pricing source");
    const partition = assembleParsedProviderPricing(
      value.provider.id,
      observedAt,
      [{ source, ...result }],
      models,
    );
    const input = partition?.books
      .find(({ book_key }) => book_key === "model:mistral/mistral-medium-3-5@26.04")
      ?.offers.find(({ offer_key }) => offer_key === "sync")
      ?.terms.find((term) => term.kind === "rate" && term.meter.value === "input_text");
    if (input?.kind !== "rate") throw new Error("Missing Mistral input rate");
    expect(
      input.variants.flatMap(
        ({ charge_binding }) =>
          charge_binding?.quantity_methods?.flatMap(({ input_sources }) => input_sources ?? []) ??
          [],
      ),
    ).toContainEqual(
      expect.objectContaining({ locator: { kind: "json_pointer", value: "/usage/prompt_tokens" } }),
    );
  });

  it("captures and replays a service-only pricing source without a model carrier", async () => {
    const value = manifest("mistral");
    const configured = value.sources.find(({ id }) => id === "mistral-pricing");
    if (configured === undefined) throw new Error("Missing Mistral pricing source");
    const source = {
      ...configured,
      extractor: { kind: "mistral-pricing", minCards: 1, maxCards: 1 },
    } satisfies SourceManifest;
    const parsed = parseSource({
      provider: provider(value),
      source,
      observedAt,
      catalogModels: [],
      body: JSON.stringify({
        index: {
          url: source.url,
          body: `<mistral-block-card-model><p>Libraries</p><div><p>Call</p><mistral-atom-text-price data-prices='{"priceUsd":0.01,"priceEur":0.009,"suffix":"/call"}'></mistral-atom-text-price></div></mistral-block-card-model>`,
        },
        documents: [],
      }),
    });
    expect(parsed.models).toEqual([]);
    expect(parsed.commercial_facts).toHaveLength(1);
    const record = {
      id: source.id,
      provider_id: value.provider.id,
      url: source.url,
      source: source.source ?? [source.type],
      stability: source.stability,
      scope: source.scope ?? "global",
      exhaustive: source.exhaustive ?? false,
      role: source.role ?? "catalog",
      field_paths: source.fields,
      ...(source.pricingEvidence === undefined ? {} : { pricing_evidence: source.pricingEvidence }),
      content_hash: "1".repeat(64),
      extractor_version: source.extractorVersion,
      observed_at: observedAt,
    };
    const captured = capturePricingReplaySources([{ source, ...parsed }], [record])?.[0];
    if (captured === undefined) throw new Error("Missing service-only compilation input");
    expect(captured.models).toEqual([]);
    const partition = assembleParsedProviderPricing(
      value.provider.id,
      observedAt,
      [{ source, ...parsed }],
      [],
      value.pricingCategoricalLabels,
    );
    expect(partition?.books.map(({ book_key }) => book_key)).toEqual(["service:library-retrieval"]);
    expect(
      assembleParsedProviderPricing(
        value.provider.id,
        observedAt,
        [{ source, ...captured }],
        [],
        value.pricingCategoricalLabels,
      ),
    ).toEqual(partition);
  });

  it("reports an unsupported repository denominator instead of a normalized rate", async () => {
    const items: PricingReconciliationItem[] = [];
    const models = await mistralCatalog(
      {
        medium: (await fixture("mistral/mistral-medium-3-5-26-04.ts")).replace(
          'price: 1.5, denominator: "/M Tokens"',
          'price: 1.5, denominator: "/M Bytes"',
        ),
        omitDocument: "https://mistral.ai/pricing/api/",
      },
      (item) => items.push(item),
    );
    const medium = models.find(({ model_id }) => model_id === "mistral-medium-3-5");
    expect(medium).toBeDefined();
    expect(medium?.price_facts.some(({ meter }) => meter === "input_text")).toBe(false);
    expect(medium?.price_facts.some(({ meter }) => meter === "output_text")).toBe(true);
    expect(items).toContainEqual(
      expect.objectContaining({
        disposition: "unsupported",
        reason_code: "repository_price_unit_unsupported",
        sample: "mistral-medium-3-5-26-04: /M Bytes",
      }),
    );
  });

  it.each([
    ['type: "future", price: 1.5, denominator: "/M Tokens"'],
    ['type: "range", price: 1.5, denominator: "/M Tokens", label: "Future input"'],
    ['type: "range", price: "quote", denominator: "/M Tokens"'],
  ])("accounts for an unsupported custom price row: %s", async (row) => {
    const items: PricingReconciliationItem[] = [];
    const models = await mistralCatalog(
      {
        medium: (await fixture("mistral/mistral-medium-3-5-26-04.ts")).replace(
          'type: "range", price: 1.5, denominator: "/M Tokens"',
          row,
        ),
        omitDocument: "https://mistral.ai/pricing/api/",
      },
      (item) => items.push(item),
    );
    const medium = models.find(({ model_id }) => model_id === "mistral-medium-3-5");
    expect(medium).toBeDefined();
    expect(medium?.price_facts.some(({ meter }) => meter === "input_text")).toBe(false);
    expect(medium?.price_facts.some(({ meter }) => meter === "output_text")).toBe(true);
    expect(items).toContainEqual({
      disposition: "unsupported",
      reason_code: "repository_price_shape_unsupported",
      sample: "mistral-medium-3-5-26-04",
    });
  });

  it("keeps an unreadable published price unknown rather than claiming no price is published", async () => {
    const models = await mistralCatalog({
      medium: (await fixture("mistral/mistral-medium-3-5-26-04.ts")).replaceAll(
        'denominator: "/M Tokens"',
        'denominator: "/M Bytes"',
      ),
      omitDocument: "https://mistral.ai/pricing/api/",
    });
    const medium = models.find(({ model_id }) => model_id === "mistral-medium-3-5");
    expect(medium).toMatchObject({ pricing_state: "unknown", price_facts: [] });
  });

  it("reads the table section unit when a row omits its own denominator", () => {
    const table = (unit: string, cells: readonly string[]) =>
      `<section><div><span>${unit}</span></div><table><tr><th>Model</th><th>Input</th><th>Cached input</th><th>Output</th></tr><tr><td><a href="/models/ocr-4-1">OCR 4.1</a></td>${cells
        .map((cell) => `<td>${cell}</td>`)
        .join("")}</tr></table></section>`;
    const pageRows = parseMistralPricingCards(table("Prices /1000 Pages", ["$4", "$0.4", "—"]));
    expect(pageRows[0]?.rows).toEqual([
      { label: "OCR", priceUsd: "4", prefix: null, suffix: "/ 1000 pages" },
      {
        label: "Cached input (/1000 pages)",
        priceUsd: "0.4",
        prefix: null,
        suffix: "/ 1000 pages",
      },
    ]);
    const tokenRows = parseMistralPricingCards(table("Prices /M Tokens", ["$4", "$0.4", "$8"]));
    expect(tokenRows[0]?.rows.map(({ label }) => label)).toEqual([
      "Input (/M tokens)",
      "Cached input (/M tokens)",
      "Output (/M tokens)",
    ]);
    const mixed = parseMistralPricingCards(table("Prices /1000 Pages", ["$4 /Min", "$0.4", "—"]));
    expect(mixed[0]?.rows.map(({ label, suffix }) => ({ label, suffix }))).toEqual([
      { label: "Audio Input/min", suffix: null },
      { label: "Cached input (/1000 pages)", suffix: "/ 1000 pages" },
    ]);
  });

  it("reads current sale amounts and keeps cached OCR cells separate from ordinary pages", async () => {
    const value = manifest("mistral");
    const configured = value.sources.find(({ id }) => id === "mistral-pricing");
    if (configured === undefined) throw new Error("Missing Mistral pricing source");
    const source: SourceManifest = {
      ...configured,
      extractor: { kind: "mistral-pricing", minCards: 1, maxCards: 50 },
    };
    const catalogModels = [
      {
        ...baseModel({
          providerId: "mistral",
          id: "mistral-large-4",
          name: "Mistral Large 4",
          sourceId: "mistral-models",
          observedAt,
        }),
        status: "active" as const,
      },
      {
        ...baseModel({
          providerId: "mistral",
          id: "mistral-ocr-4-1",
          name: "OCR 4.1",
          sourceId: "mistral-models",
          observedAt,
        }),
        status: "active" as const,
      },
    ];
    const body = await fixture("mistral/pricing-sale.html");
    expect(source.url).toBe("https://docs.mistral.ai/inference/pricing");
    expect(parseMistralPricingCards(body)[0]?.modelUrls).toEqual([
      "https://docs.mistral.ai/models/mistral-large-4-0",
    ]);
    expect(linkedDocumentUrls(body, source).map(({ href }) => href)).toContain(
      "https://docs.mistral.ai/models/mistral-large-4-0",
    );
    const parse = (html: string, context = catalogModels) => {
      const findings: PricingReconciliationItem[] = [];
      const models = parseSource({
        provider: provider(value),
        source,
        catalogModels: context,
        observedAt,
        body: JSON.stringify({ index: { url: source.url, body: html }, documents: [] }),
        onPricingReconciliation: (item) => findings.push(item),
      }).models;
      return { models, findings };
    };
    const result = parse(body);
    const large = result.models.find(({ model_id }) => model_id === "mistral-large-4");
    const ocr = result.models.find(({ model_id }) => model_id === "mistral-ocr-4-1");
    expect(large).toBeDefined();
    expect(
      large?.price_facts.map(({ meter, price, currency }) => ({ meter, price, currency })),
    ).toEqual([
      { meter: "input_text", price: "0.68", currency: "USD" },
      { meter: "cache_read_text", price: "0.07", currency: "USD" },
      { meter: "output_text", price: "2.09", currency: "USD" },
    ]);
    expect(ocr).toBeDefined();
    expect(ocr?.price_facts).toEqual([
      expect.objectContaining({ meter: "input_image", price: "4", unit: "thousand_pages" }),
    ]);
    expect(ocr?.raw_price_facts).toContainEqual(
      expect.objectContaining({
        reason: "unknown_meter",
        raw: expect.objectContaining({
          label: "Cached input (/1000 pages)",
          amount: "0.4",
          denomination: "USD",
        }),
      }),
    );
    const partition = assembleParsedProviderPricing(
      "mistral",
      observedAt,
      [{ source, models: result.models }],
      result.models,
    );
    const raw = partition?.books
      .filter(({ scope }) => scope.kind === "models" && scope.model_refs.includes(ocr?.uid ?? ""))
      .flatMap(({ offers }) =>
        offers.flatMap(({ terms }) =>
          terms.flatMap((term) =>
            term.kind === "raw"
              ? term.variants.flatMap(({ observations }) => observations.map(({ raw }) => raw))
              : [],
          ),
        ),
      );
    expect(raw).toContainEqual(
      expect.objectContaining({
        label: "Cached input (/1000 pages)",
        amount: "0.4",
        denomination: "USD",
      }),
    );
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        disposition: "raw",
        reason_code: "public_price_label_unsupported",
        sample: "mistral-ocr-4-1: Cached input (/1000 pages)",
      }),
    );
    const ambiguous = parse(body, [
      ...catalogModels,
      {
        ...baseModel({
          providerId: "mistral",
          id: "mistral-ocr-4-1",
          version: "alternate",
          name: "OCR 4.1",
          sourceId: "mistral-models",
          observedAt,
        }),
        status: "active",
      },
    ]);
    expect(
      ambiguous.models
        .flatMap(({ raw_price_facts }) => raw_price_facts)
        .some(({ raw }) => raw.label === "Cached input (/1000 pages)"),
    ).toBe(false);
    for (const bad of [
      body.replace("$0.68", "$oops"),
      body.replace("$0.68</ins>", "$0.68</ins><ins>$0.34</ins>"),
      body.replace("$0.68</ins>", "$0.68</ins>unreviewed"),
    ]) {
      const parsed = parse(bad);
      const model = parsed.models.find(({ model_id }) => model_id === "mistral-large-4");
      expect(model).toBeDefined();
      expect(model?.price_facts.some(({ meter }) => meter === "input_text")).toBe(false);
      expect(
        model?.price_facts.some(({ meter, price }) => meter === "output_text" && price === "2.09"),
      ).toBe(true);
    }
  });

  it("binds renamed price cards through their linked official API identity", () => {
    const value = manifest("mistral");
    const configured = value.sources.find(({ id }) => id === "mistral-pricing");
    if (configured === undefined) throw new Error("Missing pricing source");
    const source: SourceManifest = {
      ...configured,
      extractor: { kind: "mistral-pricing", minCards: 1, maxCards: 4 },
    };
    const model = {
      ...baseModel({
        providerId: "mistral",
        id: "zai-glm-5-3",
        name: "Z.ai GLM 5.3",
        sourceId: "mistral-models",
        observedAt,
      }),
      status: "active" as const,
    };
    const url = "https://docs.mistral.ai/models/zai-glm-5-3";
    const page =
      '<h1 data-slot="heading-title">Z.ai GLM 5.3</h1><button data-slot="badge" title="Click to copy: zai-glm-5-3">zai-glm-5-3<span><svg></svg></span></button>';
    const index = `<main><mistral-block-card-model><p>GLM 5.3</p><a href="${url}">Read documentation</a><div><p>Input (/M tokens)</p><mistral-atom-text-price data-prices='{"priceEur":1.4,"priceUsd":1.4}'></mistral-atom-text-price></div></mistral-block-card-model></main>`;
    const parse = (body: string, linked = url) =>
      parseSource({
        provider: provider(value),
        source,
        observedAt,
        catalogModels: [model],
        body: JSON.stringify({
          index: { url: source.url, body: index },
          documents: [{ url: linked, body }],
        }),
      }).models;
    expect(parse(page)[0]?.price_facts).toContainEqual(
      expect.objectContaining({ price: "1.4", meter: "input_text", currency: "USD" }),
    );
    expect(parse(page, "https://untrusted.test/models/zai-glm-5-3")).toEqual([]);
    expect(parse(page.replaceAll("zai-glm-5-3", "unlisted-id"))).toEqual([]);
    expect(
      parse(page.replace("Click to copy: zai-glm-5-3", "Click to copy: a-different-id")),
    ).toEqual([]);
    expect(
      parse(
        page + '<button data-slot="badge" title="Click to copy: another-id">another-id</button>',
      ),
    ).toEqual([]);
  });
  it("preserves published legacy EUR amounts when current policy companions are available", async () => {
    const models = await mistralCatalog({
      pricingDocuments: [
        { url: mistralCurrencyUrl, body: await fixture("mistral/pricing-currency.ts") },
        { url: mistralPriorityUrl, body: await fixture("mistral/priority-tier.md") },
      ],
    });
    const rates = models.find(({ model_id }) => model_id === "mistral-medium-3-5")?.price_facts;
    expect(
      rates?.filter(
        ({ meter, currency, conditions }) =>
          meter === "input_text" && currency === "EUR" && conditions.service_tier === "standard",
      ),
    ).toEqual([expect.objectContaining({ price: "1.25", derived: false })]);
    expect(rates).toContainEqual(
      expect.objectContaining({
        meter: "input_text",
        currency: "EUR",
        price: "2.1875",
        conditions: {
          billing_currency: "EUR",
          service_tier: "priority",
          endpoint: "/v1/chat/completions",
        },
      }),
    );
  });

  it("parses current USD rates while retaining unresolved EUR and Priority scopes without policy companions", async () => {
    const items: PricingReconciliationItem[] = [];
    const models = await mistralCatalog(
      { pricing: await fixture("mistral/pricing-table.html") },
      (item) => items.push(item),
    );
    const medium = models.find(({ model_id }) => model_id === "mistral-medium-3-5");
    expect(medium?.price_facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ meter: "input_text", price: "1.5", currency: "USD" }),
        expect.objectContaining({ meter: "cache_read_text", price: "0.15", currency: "USD" }),
        expect.objectContaining({ meter: "output_text", price: "7.5", currency: "USD" }),
      ]),
    );
    expect(
      medium?.price_facts.some(
        ({ source_ref, currency }) => source_ref === "mistral-pricing" && currency === "EUR",
      ),
    ).toBe(false);
    expect(medium?.raw_price_facts).toContainEqual(
      expect.objectContaining({
        impact: "base_price",
        conditions: { billing_currency: "EUR", service_tier: "standard" },
      }),
    );
    expect(medium?.raw_price_facts).toContainEqual(
      expect.objectContaining({
        impact: "base_price",
        conditions: {
          billing_currency: "USD",
          service_tier: "priority",
          endpoint: "/v1/chat/completions",
        },
      }),
    );
    expect(
      models.find(({ model_id }) => model_id === "voxtral-mini-tts-2603")?.price_facts,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ meter: "input_text", price: "0", unit: "million_characters" }),
        expect.objectContaining({ meter: "output_audio", price: "16", unit: "million_characters" }),
      ]),
    );
    expect(items).not.toContainEqual(
      expect.objectContaining({ reason_code: "commercial_companion_drift" }),
    );
  });
  it("recognizes paragraph pricing titles only through a unique exact active catalog name", async () => {
    const pricing = (await fixture("mistral/pricing.html"))
      .replaceAll("<h2>Mistral Medium 3.5</h2>", "<p>Mistral Medium 3.5</p>")
      .replaceAll('data-text="mistral-medium-latest"', 'data-unused="mistral-medium-latest"');
    const sourcePrices = (models: ProviderModel[]) =>
      models
        .find(({ model_id }) => model_id === "mistral-medium-3-5")
        ?.price_facts.filter(({ source_ref }) => source_ref === "mistral-pricing");
    expect(sourcePrices(await mistralCatalog({ pricing }))).toEqual(
      sourcePrices(await mistralCatalog()),
    );
    expect(sourcePrices(await mistralCatalog({ pricing }))).not.toHaveLength(0);
    expect(
      sourcePrices(
        await mistralCatalog({
          pricing: pricing.replaceAll("<p>Mistral Medium 3.5</p>", "<p>Mistral Medium</p>"),
        }),
      ),
    ).toEqual([]);
    const large = (await fixture("mistral/mistral-large-3-25-12.ts")).replace(
      'name: "Mistral Large 3"',
      'name: "Mistral Medium 3.5"',
    );
    expect(sourcePrices(await mistralCatalog({ pricing, large }))).toEqual([]);
  });
  it("parses exact API names, non-exclusive tasks, lifecycle, and native prices", async () => {
    const result = await mistralSource();
    const models = result.models;
    const medium = models.find((model) => model.model_id === "mistral-medium-3-5");
    const embed = models.find((model) => model.model_id === "codestral-embed-2505");
    const ocr = models.find((model) => model.model_id === "mistral-ocr-4-0");
    const speech = models.find((model) => model.model_id === "voxtral-mini-tts-2603");
    const retired = models.find((model) => model.model_id === "mistral-large-2407");
    const pricingInputs = result.pricing_inputs ?? [];
    expect(pricingInputs).toHaveLength(20);
    expect(pricingInputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "completion.response.prompt_tokens",
          channel: "response",
          locator: { kind: "json_pointer", value: "/usage/prompt_tokens" },
        }),
        expect.objectContaining({
          key: "completion.stream.cached_tokens",
          channel: "stream_event",
          absent_value: "zero",
          availability: "terminal_only",
        }),
        expect.objectContaining({
          key: "conversation.response.connector_tokens",
          locator: { kind: "json_pointer", value: "/usage/connector_tokens" },
        }),
        expect.objectContaining({
          key: "ocr.response.pages_processed",
          locator: { kind: "json_pointer", value: "/usage_info/pages_processed" },
        }),
        expect.objectContaining({
          key: "speech.request.input_characters",
          channel: "request",
          locator: {
            kind: "provider_field",
            value: "SpeechRequest.accepted_billing_characters",
          },
        }),
        expect.objectContaining({
          key: "service.image_generation.generated_images",
          locator: {
            kind: "provider_field",
            value: "ConversationResponse.completed_image_generation_files",
          },
        }),
      ]),
    );
    expect({
      count: models.length,
      medium: {
        name: medium?.name,
        version: medium?.version,
        release_stage: medium?.release_stage,
        aliases: medium?.aliases,
        tasks: medium?.tasks,
        api_endpoints: medium?.api_endpoints,
        modalities: medium?.modalities,
        limits: medium?.limits,
        release_date: medium?.release_date,
        pricing: medium?.price_facts
          .filter(({ currency }) => currency === "USD")
          .map(({ meter, price, unit, conditions, derived }) => ({
            meter,
            price,
            unit,
            conditions,
            derived,
          }))
          .sort((left, right) =>
            `${left.meter}:${JSON.stringify(left.conditions)}`.localeCompare(
              `${right.meter}:${JSON.stringify(right.conditions)}`,
            ),
          ),
        eur: medium?.price_facts
          .filter(({ currency }) => currency === "EUR")
          .map(({ meter, price, conditions, derived }) => ({ meter, price, conditions, derived })),
      },
      embed: {
        tasks: embed?.tasks,
        api_endpoints: embed?.api_endpoints,
      },
      ocr: {
        tasks: ocr?.tasks,
        api_endpoints: ocr?.api_endpoints,
        modalities: ocr?.modalities,
        pricing: ocr?.price_facts
          .filter(({ currency }) => currency === "USD")
          .map(({ meter, price, unit, conditions }) => ({
            meter,
            price,
            unit,
            conditions,
          }))
          .sort((left, right) =>
            JSON.stringify(left.conditions).localeCompare(JSON.stringify(right.conditions)),
          ),
        eur: ocr?.price_facts
          .filter(({ currency }) => currency === "EUR")
          .map(({ price, conditions }) => ({ price, conditions })),
      },
      speech: {
        tasks: speech?.tasks,
        api_endpoints: speech?.api_endpoints,
        modalities: speech?.modalities,
        pricing: speech?.price_facts
          .filter(({ currency }) => currency === "USD")
          .map(({ meter, price, unit }) => ({ meter, price, unit })),
        eur: speech?.price_facts
          .filter(({ currency }) => currency === "EUR")
          .map(({ meter, price, unit }) => ({ meter, price, unit })),
      },
      retired: {
        tasks: retired?.tasks,
        status: retired?.status,
        deprecated_at: retired?.deprecated_at,
        retired_at: retired?.retired_at,
        replacements: retired?.replacement_model_ids,
        api_endpoints: retired?.api_endpoints,
        pricing_state: retired?.pricing_state,
        price_count: retired?.price_facts.length,
      },
    }).toEqual({
      count: 7,
      medium: {
        name: "Mistral Medium 3.5",
        version: "26.04",
        release_stage: "stable",
        aliases: ["mistral-medium-3", "mistral-medium-latest"],
        tasks: ["text_generation"],
        api_endpoints: [
          { name: "Agents", path: "/v1/agents" },
          { name: "Batch", path: "/v1/batch" },
          { name: "Chat / Completions", path: "/v1/chat/completions" },
          { name: "Conversations", path: "/v1/conversations" },
        ],
        modalities: { input: ["text", "image"], output: ["text"] },
        limits: { context_tokens: 256_000, max_output_tokens: 32_000 },
        release_date: "2026-04-28",
        pricing: [
          {
            meter: "cache_read_text",
            price: "0.15",
            unit: "million_tokens",
            conditions: { billing_currency: "USD" },
            derived: true,
          },
          {
            meter: "input_text",
            price: "0.75",
            unit: "million_tokens",
            conditions: { billing_currency: "USD", service_tier: "batch" },
            derived: true,
          },
          {
            meter: "input_text",
            price: "1.5",
            unit: "million_tokens",
            conditions: { billing_currency: "USD" },
            derived: false,
          },
          {
            meter: "output_text",
            price: "3.75",
            unit: "million_tokens",
            conditions: { billing_currency: "USD", service_tier: "batch" },
            derived: true,
          },
          {
            meter: "output_text",
            price: "7.5",
            unit: "million_tokens",
            conditions: { billing_currency: "USD" },
            derived: false,
          },
        ],
        eur: [
          {
            meter: "input_text",
            price: "1.25",
            conditions: { billing_currency: "EUR" },
            derived: false,
          },
          {
            meter: "input_text",
            price: "0.625",
            conditions: { billing_currency: "EUR", service_tier: "batch" },
            derived: true,
          },
          {
            meter: "cache_read_text",
            price: "0.125",
            conditions: { billing_currency: "EUR" },
            derived: true,
          },
          {
            meter: "output_text",
            price: "6.4",
            conditions: { billing_currency: "EUR" },
            derived: false,
          },
          {
            meter: "output_text",
            price: "3.2",
            conditions: { billing_currency: "EUR", service_tier: "batch" },
            derived: true,
          },
        ],
      },
      embed: {
        tasks: ["embeddings"],
        api_endpoints: [
          { name: "Batch", path: "/v1/batch" },
          { name: "Embeddings", path: "/v1/embeddings" },
        ],
      },
      ocr: {
        tasks: ["ocr"],
        api_endpoints: [
          { name: "Batch", path: "/v1/batch" },
          { name: "OCR", path: "/v1/ocr" },
        ],
        modalities: { input: ["image", "pdf"], output: ["text", "image"] },
        pricing: [
          {
            meter: "input_image",
            price: "2.5",
            unit: "thousand_pages",
            conditions: {
              billing_currency: "USD",
              operation: "document_annotation",
              service_tier: "batch",
            },
          },
          {
            meter: "input_image",
            price: "5",
            unit: "thousand_pages",
            conditions: { billing_currency: "USD", operation: "document_annotation" },
          },
          {
            meter: "input_image",
            price: "2",
            unit: "thousand_pages",
            conditions: {
              billing_currency: "USD",
              operation: "ocr",
              service_tier: "batch",
            },
          },
          {
            meter: "input_image",
            price: "4",
            unit: "thousand_pages",
            conditions: { billing_currency: "USD", operation: "ocr" },
          },
        ],
        eur: [
          { price: "3.5", conditions: { billing_currency: "EUR", operation: "ocr" } },
          {
            price: "1.75",
            conditions: {
              billing_currency: "EUR",
              operation: "ocr",
              service_tier: "batch",
            },
          },
          {
            price: "4.38",
            conditions: { billing_currency: "EUR", operation: "document_annotation" },
          },
          {
            price: "2.19",
            conditions: {
              billing_currency: "EUR",
              operation: "document_annotation",
              service_tier: "batch",
            },
          },
        ],
      },
      speech: {
        tasks: ["speech_synthesis"],
        api_endpoints: [{ name: "Audio Speech", path: "/v1/audio/speech" }],
        modalities: { input: ["text", "audio"], output: ["audio"] },
        pricing: [{ meter: "output_audio", price: "16", unit: "million_characters" }],
        eur: [{ meter: "output_audio", price: "10", unit: "million_characters" }],
      },
      retired: {
        tasks: ["text_generation"],
        status: "retired",
        deprecated_at: "2024-11-30",
        retired_at: "2025-03-30",
        replacements: ["mistral-large-2512"],
        api_endpoints: undefined,
        pricing_state: "not_applicable",
        price_count: 0,
      },
    });
  });

  it("uses explicit lifecycle state and publishes no current offer for retired models", async () => {
    const medium = await fixture("mistral/mistral-medium-3-5-26-04.ts");
    const metadata =
      'metadata: { deprecationDate: "2026-01-01", retirementDate: "2026-02-01", replacement: "Mistral Large 3" }';
    const deprecated = (
      await mistralCatalog({
        medium: medium
          .replace('status: "GA"', 'status: "Deprecated"')
          .replace("metadata: {}", metadata),
      })
    ).find(({ model_id }) => model_id === "mistral-medium-3-5");
    const retired = (
      await mistralCatalog({
        medium: medium
          .replace('status: "GA"', 'status: "Retired"')
          .replace("metadata: {}", metadata),
      })
    ).find(({ model_id }) => model_id === "mistral-medium-3-5");
    expect(deprecated).toMatchObject({
      status: "deprecated",
      retired_at: "2026-02-01",
      pricing_state: "numeric",
    });
    expect(retired).toMatchObject({
      status: "retired",
      retired_at: "2026-02-01",
      pricing_state: "not_applicable",
      price_facts: [],
    });
  });

  it("keeps an empty current price definition unknown without a non-publication claim", async () => {
    const medium = withoutMistralPrices(await fixture("mistral/mistral-medium-3-5-26-04.ts"));
    const pricing = withoutMistralPublicMedium(await fixture("mistral/pricing.html"));
    const model = (await mistralCatalog({ medium, pricing })).find(
      ({ model_id }) => model_id === "mistral-medium-3-5",
    );
    expect(model).toMatchObject({ pricing_state: "unknown", price_facts: [] });
  });

  it("fills a repository price gap from the exact first-party public price card", async () => {
    const medium = withoutMistralPrices(await fixture("mistral/mistral-medium-3-5-26-04.ts"));
    const model = (await mistralCatalog({ medium })).find(
      ({ model_id }) => model_id === "mistral-medium-3-5",
    );
    expect(model).toMatchObject({
      pricing_state: "numeric",
      price_facts: expect.arrayContaining([
        expect.objectContaining({
          meter: "input_text",
          currency: "USD",
          price: "1.5",
          derived: false,
        }),
        expect.objectContaining({
          meter: "input_text",
          currency: "EUR",
          price: "1.25",
          derived: false,
        }),
      ]),
    });
  });

  it("reads an exact structural Free row even when adjacent card text has no separator", async () => {
    const medium = withoutMistralPrices(await fixture("mistral/mistral-medium-3-5-26-04.ts"));
    const pricing = withoutMistralPublicMedium(await fixture("mistral/pricing.html")).replace(
      "</main>",
      `<mistral-block-card-model><p>Classifier APIs</p><p>Free </p><mistral-atom-button-copy-clipboard data-text="mistral-medium-latest"></mistral-atom-button-copy-clipboard></mistral-block-card-model></main>`,
    );
    const model = (await mistralCatalog({ medium, pricing })).find(
      ({ model_id }) => model_id === "mistral-medium-3-5",
    );
    expect(model).toMatchObject({ pricing_state: "free", price_facts: [] });
  });

  it("lets the dedicated price page resolve a repository amount to Free", async () => {
    const pricing = withoutMistralPublicMedium(await fixture("mistral/pricing.html")).replace(
      "</main>",
      `<mistral-block-card-model><p>Free</p><mistral-atom-button-copy-clipboard data-text="mistral-medium-latest"></mistral-atom-button-copy-clipboard></mistral-block-card-model></main>`,
    );
    const items: PricingReconciliationItem[] = [];
    const model = (await mistralCatalog({ pricing }, (item) => items.push(item))).find(
      ({ model_id }) => model_id === "mistral-medium-3-5",
    );
    expect(model).toMatchObject({ pricing_state: "free", price_facts: [] });
    expect(model?.raw_price_facts).toContainEqual(
      expect.objectContaining({
        reason: "superseded_value",
        resolution_policy: "mistral_public_price_page_over_repository",
      }),
    );
    expect(items).toContainEqual({
      disposition: "raw",
      reason_code: "first_party_price_conflict_resolved",
      sample: "mistral-medium-latest: Free",
    });
  });

  it.each(["before", "after"])(
    "preserves explicit cached input %s its ordinary input row",
    async (order) => {
      const input = `    <div>
      <p>Input (/M tokens)</p>
      <mistral-atom-text-price
        data-prices='{"priceEur":1.25,"priceUsd":1.5,"prefix":null,"suffix":null}'
        data-discounts='["batch","cache"]'
      ></mistral-atom-text-price>
    </div>`;
      const cached = `    <div>
      <p>Cached input (/M tokens)</p>
      <mistral-atom-text-price
        data-prices='{"priceEur":0.22,"priceUsd":0.26,"prefix":null,"suffix":null}'
      ></mistral-atom-text-price>
    </div>`;
      const pricing = (await fixture("mistral/pricing.html")).replaceAll(
        input,
        order === "before" ? `${cached}\n${input}` : `${input}\n${cached}`,
      );
      const items: PricingReconciliationItem[] = [];
      const model = (await mistralCatalog({ pricing }, (item) => items.push(item))).find(
        ({ model_id }) => model_id === "mistral-medium-3-5",
      );
      expect(
        model?.price_facts
          .filter(({ meter }) => meter === "cache_read_text")
          .map(({ currency, price }) => ({ currency, price })),
      ).toEqual([
        { currency: "USD", price: "0.26" },
        { currency: "EUR", price: "0.22" },
      ]);
      expect(items).not.toContainEqual(
        expect.objectContaining({ reason_code: "public_price_label_unsupported" }),
      );
    },
  );

  it("classifies an explicit repository cached-input row without duplicating input", async () => {
    const medium = (await fixture("mistral/mistral-medium-3-5-26-04.ts")).replace(
      'input: [{ type: "range", price: 1.5, denominator: "/M Tokens" }]',
      `input: [
      { type: "range", price: 1.5, denominator: "/M Tokens", label: "Input" },
      { type: "range", price: 0.26, denominator: "/M Tokens", label: "Cached input" },
    ]`,
    );
    const model = (
      await mistralCatalog({
        medium,
        omitDocument: "https://mistral.ai/pricing/api/",
      })
    ).find(({ model_id }) => model_id === "mistral-medium-3-5");
    expect(
      model?.price_facts
        .filter(({ currency }) => currency === "USD")
        .map(({ meter, price, derived, conditions }) => ({
          meter,
          price,
          derived,
          conditions,
        })),
    ).toEqual([
      {
        meter: "input_text",
        price: "1.5",
        derived: false,
        conditions: { billing_currency: "USD" },
      },
      {
        meter: "cache_read_text",
        price: "0.26",
        derived: false,
        conditions: { billing_currency: "USD" },
      },
      {
        meter: "output_text",
        price: "7.5",
        derived: false,
        conditions: { billing_currency: "USD" },
      },
      {
        meter: "input_text",
        price: "0.75",
        derived: true,
        conditions: { billing_currency: "USD", service_tier: "batch" },
      },
      {
        meter: "output_text",
        price: "3.75",
        derived: true,
        conditions: { billing_currency: "USD", service_tier: "batch" },
      },
    ]);
  });

  it("accounts for every reviewed repository and public-page price observation", async () => {
    const items: PricingReconciliationItem[] = [];
    const result = await mistralSource({}, (item) => items.push(item));
    expect(items.filter(({ disposition }) => disposition === "normalized").length).toBeGreaterThan(
      20,
    );
    expect(
      items.filter(({ disposition }) =>
        ["unbound", "unsupported", "unresolved"].includes(disposition),
      ),
    ).toEqual([]);
    expect(result.commercial_facts?.map(({ book_key }) => book_key).sort()).toEqual(
      [
        "service:code-execution",
        "service:web-search",
        "service:premium-news",
        "service:image-generation",
        "service:library-retrieval",
      ].sort(),
    );
    expect(items).toContainEqual({
      disposition: "ambiguous",
      reason_code: "public_price_retired_model_conflict",
      sample: "mistral-large-2407: Input (/M tokens)",
    });
  });

  it("selects the dedicated price page while preserving a conflicting repository amount", async () => {
    const pricing = (await fixture("mistral/pricing.html")).replaceAll(
      '"priceUsd":1.5',
      '"priceUsd":1.6',
    );
    const items: PricingReconciliationItem[] = [];
    const model = (await mistralCatalog({ pricing }, (item) => items.push(item))).find(
      ({ model_id }) => model_id === "mistral-medium-3-5",
    );
    expect(model?.price_facts).toContainEqual(
      expect.objectContaining({
        meter: "input_text",
        currency: "USD",
        price: "1.6",
        resolution_policy: "mistral_public_price_page_over_repository",
      }),
    );
    expect(model?.price_facts).toContainEqual(
      expect.objectContaining({ meter: "input_text", currency: "EUR", price: "1.25" }),
    );
    expect(model?.raw_price_facts).toContainEqual(
      expect.objectContaining({
        reason: "superseded_value",
        raw: expect.objectContaining({ amount: "1.5", denomination: "USD" }),
      }),
    );
    expect(items).toContainEqual({
      disposition: "raw",
      reason_code: "first_party_price_conflict_resolved",
      sample: "mistral-medium-3-5: Input (/M tokens)",
    });
  });

  it("publishes distinct inference mechanisms and provider-resource price books", async () => {
    const value = manifest("mistral");
    const source = value.sources.find(({ id }) => id === "mistral-pricing");
    if (source === undefined) throw new Error("Missing Mistral source");
    const result = await mistralSource();
    const models = result.models;
    const pricing = assembleParsedProviderPricing(
      value.provider.id,
      observedAt,
      [{ source, ...result }],
      models,
      value.pricingCategoricalLabels,
    );
    const medium = pricing?.books.find(
      ({ book_key }) => book_key === "model:mistral/mistral-medium-3-5@26.04",
    );
    expect(medium?.offers.map(({ offer_key }) => offer_key)).toEqual(["batch", "sync"]);
    const sync = medium?.offers.find(({ offer_key }) => offer_key === "sync");
    const batch = medium?.offers.find(({ offer_key }) => offer_key === "batch");
    const syncRates = sync?.terms.filter((term) => term.kind === "rate") ?? [];
    const input = syncRates.find(({ meter }) => meter.value === "input_text");
    const cache = syncRates.find(({ meter }) => meter.value === "cache_read_text");
    expect(cache).toMatchObject({
      kind: "rate",
      variants: expect.arrayContaining([
        expect.objectContaining({
          charge_binding: expect.objectContaining({
            signal: { namespace: "kmodels", value: "cached_input_tokens" },
            quantity_methods: [
              {
                input_sources: expect.arrayContaining([
                  expect.objectContaining({
                    channel: "response",
                    locator: {
                      kind: "json_pointer",
                      value: "/usage/prompt_tokens_details/cached_tokens",
                    },
                    absent_value: "zero",
                  }),
                ]),
              },
            ],
          }),
        }),
      ]),
    });
    expect(input?.kind === "rate" ? input.variants[0]?.charge_binding : undefined).toMatchObject({
      signal: { namespace: "kmodels", value: "uncached_input_tokens" },
      quantity_methods: expect.arrayContaining([
        expect.objectContaining({
          calculation: expect.objectContaining({
            nodes: expect.arrayContaining([expect.objectContaining({ op: "subtract_floor_zero" })]),
          }),
        }),
        expect.objectContaining({
          calculation: expect.objectContaining({
            nodes: expect.arrayContaining([expect.objectContaining({ op: "sum" })]),
          }),
          input_sources: expect.arrayContaining([
            expect.objectContaining({
              locator: { kind: "json_pointer", value: "/usage/connector_tokens" },
            }),
          ]),
        }),
      ]),
    });
    expect(
      batch?.terms
        .filter((term) => term.kind === "rate")
        .flatMap(({ variants }) => variants)
        .every(
          ({ charge_binding }) =>
            charge_binding !== undefined && charge_binding.quantity_methods === undefined,
        ),
    ).toBe(true);
    expect(
      medium?.offers.every(
        ({ relations, enrollment, settlement }) =>
          relations.length + enrollment.length + settlement.length === 0,
      ),
    ).toBe(true);

    const ocrUid = models.find(({ model_id }) => model_id === "mistral-ocr-4-0")?.uid;
    const ocr = pricing?.books.find(
      ({ scope }) => scope.kind === "models" && scope.model_refs.includes(ocrUid ?? ""),
    );
    expect(
      ocr?.offers
        .find(({ offer_key }) => offer_key === "sync")
        ?.terms.flatMap((term) => (term.kind === "rate" ? term.variants : []))[0]?.charge_binding,
    ).toMatchObject({
      signal: { namespace: "kmodels", value: "processed_pages" },
      quantity_methods: [
        {
          input_sources: [
            expect.objectContaining({
              locator: { kind: "json_pointer", value: "/usage_info/pages_processed" },
            }),
          ],
        },
      ],
    });
    const speechUid = models.find(({ model_id }) => model_id === "voxtral-mini-tts-2603")?.uid;
    const speech = pricing?.books.find(
      ({ scope }) => scope.kind === "models" && scope.model_refs.includes(speechUid ?? ""),
    );
    expect(
      speech?.offers
        .find(({ offer_key }) => offer_key === "sync")
        ?.terms.flatMap((term) => (term.kind === "rate" ? term.variants : []))[0]?.charge_binding,
    ).toMatchObject({
      signal: { namespace: "kmodels", value: "input_characters" },
      quantity_methods: [
        {
          input_sources: [
            expect.objectContaining({
              locator: {
                kind: "provider_field",
                value: "SpeechRequest.accepted_billing_characters",
              },
            }),
          ],
        },
      ],
    });

    const code = pricing?.books.find(({ book_key }) => book_key === "service:code-execution");
    expect(code?.offers[0]?.terms[0]).toMatchObject({
      kind: "rate",
      meter: { namespace: "kmodels", value: "code_execution" },
      variants: expect.arrayContaining([
        expect.objectContaining({
          charge_binding: expect.objectContaining({
            quantity_methods: [
              {
                input_sources: expect.arrayContaining([
                  expect.objectContaining({
                    locator: {
                      kind: "json_pointer",
                      value: "/usage/connectors/code_interpreter",
                    },
                  }),
                ]),
              },
            ],
          }),
        }),
      ]),
    });
    expect(code?.offers[0]).toMatchObject({ relations: [], enrollment: [], settlement: [] });

    const library = pricing?.books.find(({ book_key }) => book_key === "service:library-retrieval");
    expect(library?.offers.map(({ offer_key }) => offer_key)).toEqual(["usage"]);
    expect(
      library?.offers
        .find(({ offer_key }) => offer_key === "usage")
        ?.terms.find(({ kind }) => kind === "rate"),
    ).toMatchObject({
      variants: expect.arrayContaining([
        expect.objectContaining({ charge_binding: expect.any(Object) }),
      ]),
    });
    expect(
      pricing?.books
        .filter(({ scope }) => scope.kind === "provider_resource")
        .map(({ book_key }) => book_key),
    ).toEqual([
      "service:web-search",
      "service:premium-news",
      "service:code-execution",
      "service:image-generation",
      "service:library-retrieval",
    ]);
    const image = pricing?.books.find(({ book_key }) => book_key === "service:image-generation");
    expect(
      image?.offers
        .flatMap(({ terms }) => terms)
        .flatMap((term) => (term.kind === "rate" ? term.variants : []))[0]?.charge_binding,
    ).toMatchObject({
      signal: { namespace: "kmodels", value: "generated_items" },
      quantity_methods: [
        {
          input_sources: expect.arrayContaining([
            expect.objectContaining({
              locator: {
                kind: "provider_field",
                value: "ConversationResponse.completed_image_generation_files",
              },
            }),
          ]),
        },
      ],
    });
    const premium = pricing?.books.find(({ book_key }) => book_key === "service:premium-news");
    expect(
      premium?.offers
        .flatMap(({ terms }) => terms)
        .flatMap((term) => (term.kind === "rate" ? term.variants : []))
        .every(({ charge_binding }) => charge_binding?.quantity_methods === undefined),
    ).toBe(true);
    expect(
      pricing?.books
        .flatMap(({ offers }) => offers)
        .flatMap(({ terms }) => terms)
        .some(
          (term) =>
            term.kind === "raw" &&
            (term.term_key === "charge_binding_unavailable" ||
              term.term_key.startsWith("accounting_binding_unavailable:")),
        ),
    ).toBe(false);
    expect(
      pricing?.books
        .flatMap(({ offers }) => offers)
        .flatMap(({ terms }) =>
          terms.flatMap((term) => (term.kind === "rate" ? term.variants : [])),
        )
        .flatMap(({ charge_binding }) => charge_binding?.observations ?? [])
        .some(
          ({ locator }) =>
            locator.kind === "provider_key" &&
            /^(?:batch|request|response|sync):/.test(locator.value),
        ),
    ).toBe(false);
  });

  it("keeps a provider-service amount when its execution-counter companion is unavailable", async () => {
    const value = manifest("mistral");
    const source = value.sources.find(({ id }) => id === "mistral-pricing");
    if (source === undefined) throw new Error("Missing Mistral source");
    const items: PricingReconciliationItem[] = [];
    const result = await mistralSource(
      {
        omitDocument:
          "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/content/en/docs/studio/agents/agent-tools/code_interpreter/page.mdx",
      },
      (item) => items.push(item),
    );
    const models = result.models;
    const pricing = assembleParsedProviderPricing(
      value.provider.id,
      observedAt,
      [{ source, ...result }],
      models,
      value.pricingCategoricalLabels,
    );
    const code = pricing?.books.find(({ book_key }) => book_key === "service:code-execution");
    const rate = code?.offers[0]?.terms.find(
      (term) => term.kind === "rate" && term.meter.value === "code_execution",
    );
    expect(
      rate?.kind === "rate" &&
        rate.variants.every(
          ({ charge_binding }) =>
            charge_binding !== undefined && charge_binding.quantity_methods === undefined,
        ),
    ).toBe(true);
    expect(code?.offers[0]?.terms).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "raw" })]),
    );
    expect(items).toContainEqual(
      expect.objectContaining({
        reason_code: "pricing_input_contract_partial",
        sample: "19/20 Mistral pricing inputs",
      }),
    );
  });

  it("keeps the catalog independently usable when the pricing overlay is unavailable", async () => {
    const items: PricingReconciliationItem[] = [];
    const models = await mistralCatalog(
      { omitDocument: "https://mistral.ai/pricing/api/" },
      (item) => items.push(item),
    );
    const medium = models.find(({ model_id }) => model_id === "mistral-medium-3-5");
    expect(medium?.price_facts).toContainEqual(
      expect.objectContaining({
        meter: "input_text",
        currency: "USD",
        price: "1.5",
      }),
    );
    expect(medium?.price_facts.some(({ currency }) => currency === "EUR")).toBe(false);
    expect(items).not.toContainEqual(expect.objectContaining({ sample: "/pricing/api/" }));
  });

  it("keeps valid pricing cards when one provider-service amount is malformed", async () => {
    const pricing = (await fixture("mistral/pricing.html")).replace(
      '{"priceEur":30,"priceUsd":30,"prefix":null,"suffix":null}',
      '{"priceEur":"quote","priceUsd":30,"prefix":null,"suffix":null}',
    );
    const items: PricingReconciliationItem[] = [];
    const result = await mistralSource({ pricing }, (item) => items.push(item));
    const facts = result.commercial_facts ?? [];
    expect(facts.some(({ book_key }) => book_key === "service:code-execution")).toBe(false);
    expect(facts.some(({ book_key }) => book_key === "service:web-search")).toBe(true);
    expect(items).toContainEqual(
      expect.objectContaining({
        disposition: "unsupported",
        reason_code: "public_price_shape_unsupported",
        sample: "Code execution: Price (per 1K calls)",
      }),
    );
  });

  it("ignores weight-distribution changes outside the gateway rate-book boundary", async () => {
    const large = (await fixture("mistral/mistral-large-3-25-12.ts")).replace(
      'url: "https://huggingface.co/mistralai/Mistral-Large-3-675B-Instruct-2512"',
      'download: "https://huggingface.co/mistralai/Mistral-Large-3-675B-Instruct-2512"',
    );
    const items: PricingReconciliationItem[] = [];
    const models = await mistralCatalog({ large }, (item) => items.push(item));
    const model = models.find(({ model_id }) => model_id === "mistral-large-2512");
    expect(model).toMatchObject({ status: "active", pricing_state: "numeric" });
    expect(model).not.toHaveProperty("commercial_facts");
    expect(items).not.toContainEqual(
      expect.objectContaining({ reason_code: "weight_distribution_drift" }),
    );
  });

  it("isolates first-party accounting drift while keeping identity guards strict", async () => {
    const openapi = (await fixture("mistral/openapi.yaml")).replace(
      "cached_tokens",
      "renamed_cached_tokens",
    );
    const openapiItems: PricingReconciliationItem[] = [];
    const result = await mistralSource({ openapi }, (item) => openapiItems.push(item));
    const retained = result.models;
    expect(retained).toHaveLength(7);
    const retainedInputs = result.pricing_inputs ?? [];
    expect(retainedInputs).toHaveLength(18);
    expect(retainedInputs.some(({ key }) => key.endsWith(".cached_tokens"))).toBe(false);
    expect(retainedInputs.some(({ key }) => key === "completion.response.prompt_tokens")).toBe(
      true,
    );
    expect(
      retained.some(({ raw_price_facts }) =>
        raw_price_facts.some(({ term_key }) =>
          term_key.startsWith("accounting_binding_unavailable:"),
        ),
      ),
    ).toBe(false);
    expect(openapiItems).toContainEqual(
      expect.objectContaining({
        disposition: "unbound",
        reason_code: "pricing_input_contract_partial",
        sample: "18/20 Mistral pricing inputs",
      }),
    );
    const value = manifest("mistral");
    const pricingSource = value.sources.find(({ id }) => id === "mistral-pricing");
    if (pricingSource === undefined) throw new Error("Missing Mistral pricing source");
    const partition = assembleParsedProviderPricing(
      value.provider.id,
      observedAt,
      [{ source: pricingSource, ...result }],
      retained,
      value.pricingCategoricalLabels,
    );
    const medium = partition?.books.find(
      ({ book_key }) => book_key === "model:mistral/mistral-medium-3-5@26.04",
    );
    const inputBinding = medium?.offers
      .find(({ offer_key }) => offer_key === "sync")
      ?.terms.flatMap((term) =>
        term.kind === "rate" && term.meter.value === "input_text" ? term.variants : [],
      )[0]?.charge_binding;
    expect(
      inputBinding?.quantity_methods?.some(({ calculation }) =>
        calculation?.nodes.some(({ op }) => op === "sum"),
      ),
    ).toBe(true);
    const cacheCalculation = inputBinding?.quantity_methods?.find(({ calculation }) =>
      calculation?.nodes.some(({ op }) => op === "subtract_floor_zero"),
    );
    expect(cacheCalculation).toBeDefined();
    expect(cacheCalculation?.input_sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ signal: { namespace: "kmodels", value: "input_tokens" } }),
      ]),
    );
    expect(
      cacheCalculation?.input_sources?.some(({ signal }) => signal.value === "cached_input_tokens"),
    ).toBe(false);

    const modelList = (await fixture("mistral/openapi.yaml")).replace(
      "list_models_v1_models_get",
      "list_available_models",
    );
    await expect(mistralCatalog({ openapi: modelList })).resolves.toHaveLength(7);

    const misleadingUsage = `${openapi}\n    UnrelatedCacheShape:\n      properties:\n        cached_tokens:\n          type: integer`;
    await expect(mistralCatalog({ openapi: misleadingUsage })).resolves.toHaveLength(7);
  });

  it("isolates feature, endpoint, and pricing drift", async () => {
    const medium = await fixture("mistral/mistral-medium-3-5-26-04.ts");
    const findings: SourceContractEvidence[] = [];
    const featureModels = await mistralCatalog(
      { medium: medium.replace('"chat-completions"', '"responses"') },
      undefined,
      (finding) => findings.push(finding),
    );
    expect(featureModels).toHaveLength(7);
    expect(findings).toContainEqual(expect.objectContaining({ disposition: "accept_with_signal" }));

    const schema = await fixture("mistral/schema.ts");
    expect(
      await mistralCatalog({
        schema: schema.replace(
          '"chat-completions": { endpoints: ["chat-completions"] }',
          '"chat-completions": { endpoints: ["responses"] }',
        ),
      }),
    ).toHaveLength(7);

    const endpoints = await fixture("mistral/endpoints.ts");
    const endpointModels = await mistralCatalog({
      endpoints: endpoints.replace(
        'path: "/v1/chat/completions"',
        'path: "https://api.mistral.ai/v1/chat/completions"',
      ),
    });
    expect(endpointModels).toHaveLength(7);
    expect(
      endpointModels
        .find(({ model_id }) => model_id === "mistral-medium-3-5")
        ?.api_endpoints?.some(({ path }) => path === "/v1/chat/completions"),
    ).toBe(false);

    const invalidFree = await mistralCatalog({
      medium: medium.replace("free: false", "free: true"),
    });
    expect(invalidFree).toHaveLength(7);
    expect(
      invalidFree.find(({ model_id }) => model_id === "mistral-medium-3-5")?.pricing_state,
    ).toBe("numeric");

    await expect(
      mistralCatalog({
        medium: withoutMistralPrices(medium),
        pricing: withoutMistralPublicMedium(await fixture("mistral/pricing.html")),
      }),
    ).resolves.toHaveLength(7);

    expect(
      (
        await mistralCatalog({
          medium: medium.replace('status: "GA"', 'status: "PublicPreview"'),
        })
      ).find(({ model_id }) => model_id === "mistral-medium-3-5"),
    ).toMatchObject({ status: "active", release_stage: "preview" });
  });

  it("excludes weights-only definitions before validating hosted API facets", async () => {
    const findings: SourceContractEvidence[] = [];
    const reconciliation: PricingReconciliationItem[] = [];
    const models = await mistralCatalog(
      {
        medium:
          'export default { slug: "timestral-1-0-209m", identifiers: { apiNames: [] }, capabilities: { input: ["timeseries"] } };',
      },
      (item) => reconciliation.push(item),
      (finding) => findings.push(finding),
    );
    expect(models).toHaveLength(6);
    expect(findings).toEqual([]);
    expect(reconciliation).toContainEqual({
      disposition: "excluded",
      reason_code: "definition_without_api_name",
      sample: "mistral-medium-3-5-26-04",
    });
    const invalid: SourceContractEvidence[] = [];
    await mistralCatalog(
      {
        medium:
          'export default { slug: "unrelated", identifiers: { apiNames: ["hosted-model"] } };',
      },
      undefined,
      (finding) => invalid.push(finding),
    );
    expect(invalid.length).toBeGreaterThan(0);
  });

  it("skips one malformed model definition without rejecting recognized siblings", async () => {
    const findings: SourceContractEvidence[] = [];
    const models = await mistralCatalog(
      {
        medium: (await fixture("mistral/mistral-medium-3-5-26-04.ts")).replace(
          'name: "Mistral Medium 3.5"',
          "name: 35",
        ),
      },
      undefined,
      (finding) => findings.push(finding),
    );
    expect(models).toHaveLength(6);
    expect(models.some(({ model_id }) => model_id === "mistral-medium-3-5")).toBe(false);
    expect(findings).toContainEqual(
      expect.objectContaining({
        disposition: "accept_with_signal",
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ path: "/models/mistral-medium-3-5-26-04" }),
        ]),
      }),
    );
  });

  it("validates structured base models and ignores private fine-tunes", async () => {
    const manifestValue = manifest("mistral");
    const apiSource = manifestValue.sources.find(({ id }) => id === "mistral-api");
    if (apiSource === undefined) throw new Error("Missing Mistral API source");
    const models = parseSource({
      provider: provider(manifestValue),
      source: apiSource,
      body: await fixture("mistral/api.json"),
      observedAt,
    }).models;
    expect(
      models.map(({ model_id, name, aliases, tasks, modalities, limits, status, source_refs }) => ({
        model_id,
        name,
        aliases,
        tasks,
        modalities,
        limits,
        status,
        source_refs,
      })),
    ).toEqual([
      {
        model_id: "mistral-medium-3-5",
        name: "Mistral Medium 3.5 API",
        aliases: ["mistral-medium-latest"],
        tasks: ["text_generation"],
        modalities: { input: ["text", "image"], output: ["text"] },
        limits: { context_tokens: 262_144 },
        status: "active",
        source_refs: ["mistral-api"],
      },
      {
        model_id: "mistral-ocr-4-0",
        name: "OCR 4",
        aliases: ["mistral-ocr-latest"],
        tasks: ["ocr"],
        modalities: { input: ["image", "pdf"], output: ["text"] },
        limits: {},
        status: "active",
        source_refs: ["mistral-api"],
      },
    ]);

    const api = (await fixture("mistral/api.json")).replace('      "type": "base",\n', "");
    const value = manifest("mistral");
    const source = value.sources.find(({ id }) => id === "mistral-api");
    if (source === undefined) throw new Error("Missing Mistral API source");
    expect(
      parseSource({
        provider: provider(value),
        source,
        body: api,
        observedAt,
      }).models.map(({ model_id }) => model_id),
    ).toEqual(["mistral-medium-3-5", "mistral-ocr-4-0"]);

    const findings: SourceContractEvidence[] = [];
    expect(
      parseSource({
        provider: provider(value),
        source,
        body: api.replace(
          '{\n  "object": "list",',
          '{\n  "object": "list",\n  "next_page_token": "unreviewed",',
        ),
        observedAt,
        onContractFinding: (finding) => findings.push(finding),
      }).models,
    ).toHaveLength(2);
    expect(findings).toContainEqual(
      expect.objectContaining({
        disposition: "accept_with_signal",
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ kind: "unknown_value", path: "/next_page_token" }),
        ]),
      }),
    );

    const capabilityFindings: SourceContractEvidence[] = [];
    expect(
      parseSource({
        provider: provider(value),
        source,
        body: api.replace(
          '"completion_chat": true,',
          '"completion_chat": true, "future_transport": true,',
        ),
        observedAt,
        onContractFinding: (finding) => capabilityFindings.push(finding),
      }).models,
    ).toHaveLength(2);
    expect(capabilityFindings).toContainEqual(
      expect.objectContaining({
        disposition: "accept_with_signal",
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ path: "/models/*/capabilities/future_transport" }),
        ]),
      }),
    );
  });

  it("declares a structured official catalog and non-persistent account inventory", () => {
    const value = manifest("mistral");
    expect(value.sources).toMatchObject([
      {
        extractor: {
          kind: "mistral-catalog",
          minModels: 50,
          maxModels: 90,
        },
        type: "repository",
        source: ["repository", "website"],
        fields: expect.arrayContaining(["api_endpoints"]),
        linkedDocuments: {
          indexFormat: "typescript",
          minDocuments: 55,
          maxDocuments: 90,
          documents: expect.arrayContaining([
            expect.objectContaining({ id: "model-schema" }),
            expect.objectContaining({ id: "model-endpoints" }),
            expect.objectContaining({
              id: "prompt-caching",
              url: expect.stringMatching(
                /\/studio\/conversations\/advanced\/prompt-caching\/page\.mdx$/,
              ),
            }),
            expect.objectContaining({
              id: "batch-processing",
              url: expect.stringMatching(/\/studio\/batch-processing\/page\.mdx$/),
            }),
          ]),
        },
      },
      {
        id: "mistral-pricing",
        url: "https://docs.mistral.ai/inference/pricing",
        extractor: { kind: "mistral-pricing", minCards: 13, maxCards: 50 },
        extractorVersion: "mistral-pricing-v10",
        fields: expect.arrayContaining(["pricing", "pricing_inputs"]),
        type: "website",
        scope: "global",
        role: "overlay",
        optional: true,
        pricingRequired: true,
        linkedDocuments: {
          documents: expect.arrayContaining([
            expect.objectContaining({ id: "api-schema", optional: true, claimLocal: true }),
            expect.objectContaining({
              id: "pricing-currency",
              url: mistralCurrencyUrl,
              optional: true,
              claimLocal: false,
            }),
            expect.objectContaining({
              id: "priority-tier",
              url: mistralPriorityUrl,
              optional: true,
              claimLocal: false,
            }),
            expect.objectContaining({ id: "prompt-caching", optional: true, claimLocal: true }),
            expect.objectContaining({ id: "code-interpreter", optional: true, claimLocal: true }),
            expect.objectContaining({ id: "web-search", optional: true, claimLocal: true }),
            expect.objectContaining({ id: "image-generation", optional: true, claimLocal: true }),
            expect.objectContaining({
              id: "libraries",
              optional: true,
              claimLocal: true,
              url: expect.stringMatching(/\/studio\/search\/libraries\/page\.mdx$/),
            }),
          ]),
        },
      },
      {
        extractor: { kind: "mistral-api", knownFields: expect.any(Array) },
        type: "api",
        scope: "account",
        role: "inventory",
      },
    ]);
  });
});
