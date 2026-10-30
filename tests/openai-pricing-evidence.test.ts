import { describe, expect, it } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { parseSource } from "../src/catalog/adapters.ts";
import { manifests, type ProviderManifest } from "../src/catalog/manifests.ts";
import { baseModel } from "../src/catalog/model.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import { validatePricingCatalog } from "../src/catalog/pricing-validation.ts";
import type { SourceManifest } from "../src/catalog/manifests.ts";
import type { SourceParseResult } from "../src/catalog/source-parse.ts";
import {
  sourcePricingReconciliation,
  type PricingReconciliationItem,
} from "../src/catalog/pricing-reconciliation.ts";
import { z } from "zod";

const observedAt = "2026-07-21T00:00:00.000Z";
function validatedPricing(result: SourceParseResult, source: SourceManifest) {
  const { models } = result;
  const partition = assembleParsedProviderPricing(
    "openai",
    observedAt,
    [{ source, ...result }],
    models,
  );
  if (partition === undefined) throw new Error("Missing parsed OpenAI pricing");
  const { provider } = fixtureSource(source.id);
  validatePricingCatalog(
    {
      provider_vocabularies: [partition.vocabulary],
      provider_snapshots: [partition.snapshot],
      model_dispositions: partition.model_dispositions,
      books: partition.books,
    },
    {
      models,
      providers: [provider],
      sources: [
        {
          id: source.id,
          provider_id: "openai",
          url: source.url,
          source: source.source ?? [source.type],
          stability: source.stability,
          scope: source.scope ?? "global",
          exhaustive: source.exhaustive ?? false,
          role: source.role ?? "catalog",
          field_paths: source.fields,
          ...(source.pricingEvidence === undefined
            ? {}
            : { pricing_evidence: source.pricingEvidence }),
          observed_at: observedAt,
          content_hash: "1".repeat(64),
          extractor_version: source.extractorVersion,
        },
      ],
    },
  );
  return partition;
}
function fixtureSource(id = "openai-pricing") {
  const manifest: ProviderManifest | undefined = manifests.find(
    ({ provider }) => provider.id === "openai",
  );
  const source = manifest?.sources.find((source) => source.id === id);
  if (manifest === undefined || source === undefined) throw new Error("Missing OpenAI source");
  return {
    manifest,
    source,
    provider: { ...manifest.provider, source_ids: manifest.sources.map(({ id }) => id) },
  };
}
function parse(body: string) {
  const { provider, source } = fixtureSource();
  const items: PricingReconciliationItem[] = [];
  const result = parseSource({
    provider,
    source,
    body,
    observedAt,
    catalogModels: [
      baseModel({
        providerId: "openai",
        id: "gpt-test",
        name: "Test",
        sourceId: "openai-models",
        observedAt,
      }),
    ],
    onPricingReconciliation: (item) => items.push(item),
  });
  return {
    ...result,
    items,
    source,
    report: sourcePricingReconciliation(result.models, items, true),
  };
}
const tokenTable = (input: string, output: string) =>
  [
    "Flagship models",
    "Standard",
    "| Model | Short context input | Short context output |",
    "| --- | --- | --- |",
    "| gpt-test | " + input + " | " + output + " |",
  ].join("\n");

it("signals an unreadable owned price table without admitting an unreviewed new identity", () => {
  const result = parse(
    tokenTable("$2", "$10") +
      "\n\n| Model | Unreviewed rate |\n| --- | --- |\n| gpt-test | $3 |\n| gpt-unreviewed-new | $4 |",
  );
  expect(result.report.reason_counts).toMatchObject({
    public_price_shape_unsupported: 1,
    unreviewed_pricing_table: 1,
  });
  expect(result.models.map(({ model_id }) => model_id)).toEqual(["gpt-test"]);
  expect(result.models[0]?.price_facts).toHaveLength(2);
});

it("retains the two native write lifetimes and context bands as independent charge partitions", () => {
  const result = parse(
    [
      "Flagship models",
      "Standard",
      "| Model | Short context input | Short context output | Short context cached input | Short context 30m write | Short context 12h write | Long context input | Long context output | Long context cached input | Long context 30m write | Long context 12h write |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      "| gpt-test | $2.00 | $10.00 | $0.10 | $2.50 | $5.00 | $4.00 | $15.00 | $0.20 | $5.00 | $10.00 |",
    ].join("\n"),
  );
  expect(result.models[0]?.price_facts).toHaveLength(10);
  expect(result.models[0]?.raw_price_facts).toEqual([]);
  expect(
    result.models[0]?.price_facts
      .filter(({ meter }) => meter === "cache_write_text")
      .map(({ price, conditions }) => [
        price,
        conditions.cache_ttl_seconds,
        conditions.context_max_tokens,
        conditions.context_min_tokens,
      ]),
  ).toEqual([
    ["2.50", 1800, 272000, undefined],
    ["5.00", 43200, 272000, undefined],
    ["5.00", 1800, undefined, 272001],
    ["10.00", 43200, undefined, 272001],
  ]);
  const partition = validatedPricing(result, result.source);
  const offer = partition.books[0]?.offers.find(({ offer_key }) => offer_key === "sync");
  expect(offer).toBeDefined();
  const writes = offer?.terms.filter(
    (term) => term.kind === "rate" && term.meter.value === "cache_write_text",
  );
  expect(writes).toHaveLength(2);
  expect(
    writes
      ?.flatMap((term) => (term.kind === "rate" ? term.variants : []))
      .every((variant) =>
        variant.applicability.any_of.every(({ all_of }) =>
          all_of.every(({ dimension }) => dimension.value !== "cache_ttl_seconds"),
        ),
      ),
  ).toBe(true);
  expect(
    writes
      ?.flatMap((term) => (term.kind === "rate" ? term.variants : []))
      .every((variant) => variant.charge_binding?.quantity_methods === undefined),
  ).toBe(true);
});

it.each([
  ["| Model | Input | Output | Cached input |", "| gpt-test | $2 | $10 | $0.1 |"],
  ["| Model | Cached input | Output | Input |", "| gpt-test | $0.1 | $10 | $2 |"],
])("binds reordered text columns by their owned labels: %s", (headers, row) => {
  const result = parse(
    ["Flagship models", "Standard", headers, "| --- | --- | --- | --- |", row].join("\n"),
  );
  expect(result.models[0]?.price_facts.map(({ meter, price }) => [meter, price])).toEqual([
    ["input_text", "2"],
    ["cache_read_text", "0.1"],
    ["output_text", "10"],
  ]);
});

it("preserves an unreviewed write lifetime with its context and admits it to repair", () => {
  const result = parse(
    [
      "Flagship models",
      "Standard",
      "| Model | Short context input | Long context 24h write |",
      "| --- | --- | --- |",
      "| gpt-test | $2 | $8 |",
    ].join("\n"),
  );
  expect(result.models[0]?.raw_price_facts).toEqual([
    expect.objectContaining({
      reason: "unknown_meter",
      conditions: { service_tier: "standard", context_min_tokens: 272001 },
      raw: expect.objectContaining({ amount: "$8" }),
    }),
  ]);
  expect(result.report.reason_counts?.unsupported_pricing_cell_preserved).toBe(1);
});

async function parseCards(change: (body: string) => string) {
  const { source, provider } = fixtureSource("openai-overview");
  const body = await readFile(
    new URL("./fixtures/openai/current-price-cards.json", import.meta.url),
    "utf8",
  );
  const bundle = z
    .object({
      index: z.object({ url: z.string(), body: z.string() }),
      documents: z.array(z.object({ url: z.string(), body: z.string() })),
    })
    .parse(JSON.parse(body));
  const doc = bundle.documents.find(({ url }) => url.endsWith("gpt-6-sol"));
  if (doc === undefined) throw new Error("Missing Sol fixture");
  doc.body = change(doc.body);
  const items: PricingReconciliationItem[] = [];
  const result = parseSource({
    provider,
    source,
    body: JSON.stringify(bundle),
    observedAt,
    catalogModels: ["gpt-6-sol", "gpt-live-1"].map((id) =>
      baseModel({ providerId: "openai", id, name: id, sourceId: "openai-models", observedAt }),
    ),
    onPricingReconciliation: (item) => items.push(item),
  });
  return {
    ...result,
    items,
    source,
    report: sourcePricingReconciliation(result.models, items, true),
  };
}

describe("OpenAI source pricing evidence", () => {
  it("rejects a service-only page whose pricing positions contain no quote", () => {
    const { provider, source } = fixtureSource();
    expect(() =>
      parseSource({
        provider,
        source,
        observedAt,
        catalogModels: [],
        body: "Tools\n| Tool | Details | Pricing |\n| --- | --- | --- |\n| Web search | Web search (all models) | - |",
      }),
    ).toThrow("contained no admitted facts");
  });

  it("keeps a service-only price source without inventing a model carrier", () => {
    const { provider, source } = fixtureSource();
    const result = parseSource({
      provider,
      source,
      observedAt,
      catalogModels: [],
      body: "Tools\n| Tool | Details | Pricing |\n| --- | --- | --- |\n| Web search | Web search (all models) | $10 / 1k calls |",
    });
    expect(result.models).toEqual([]);
    expect(result.commercial_facts).toEqual([
      expect.objectContaining({
        resource_key: "web-search",
        model_refs: [],
        price_facts: [expect.objectContaining({ price: "10", unit: "thousand_events" })],
      }),
    ]);
    const partition = assembleParsedProviderPricing(
      "openai",
      observedAt,
      [{ source, ...result }],
      [],
    );
    expect(partition?.books).toEqual([
      expect.objectContaining({
        book_key: "service:web-search",
        scope: expect.objectContaining({ kind: "provider_resource", model_refs: [] }),
      }),
    ]);
  });

  it.each(["$2", "EUR 2"])("counts the same two source cells for %s", (output) => {
    const { report, models } = parse(tokenTable("$1", output));
    expect(report.basis).toBe("source_item");
    expect(report.observed_items).toBe(2);
    if (output !== "$2")
      expect(models[0]?.raw_price_facts).toContainEqual(
        expect.objectContaining({
          impact: "base_price",
          raw: expect.objectContaining({ amount: "EUR 2", meter: "output_text" }),
        }),
      );
  });

  it("preserves raw cell scope through canonical assembly", () => {
    const modelsSource = parse(
      [
        "Flagship models",
        "Standard",
        "| Model | Short context input | Short context output | Long context input | Long context output |",
        "| --- | --- | --- | --- | --- |",
        "| gpt-test | $1 | $2 | $3 | EUR 9 |",
      ].join("\n"),
    );
    const { source } = modelsSource;
    const partition = validatedPricing(modelsSource, source);
    expect(
      partition?.books[0]?.offers
        .flatMap(({ terms }) => terms)
        .filter((term) => term.kind === "raw")
        .flatMap(({ variants }) => variants),
    ).toContainEqual(
      expect.objectContaining({
        impact: "base_price",
        observations: expect.arrayContaining([
          expect.objectContaining({ raw: expect.objectContaining({ amount: "EUR 9" }) }),
        ]),
        possible_scope: expect.objectContaining({
          any_of: expect.arrayContaining([
            expect.objectContaining({
              all_of: expect.arrayContaining([
                expect.objectContaining({
                  kind: "decimal_range",
                  lower: { value: "272001", inclusive: true },
                }),
              ]),
            }),
          ]),
        }),
      }),
    );
  });

  it("does not replace malformed native token pricing with an estimated duration rate", () => {
    const { models } = parse(
      [
        "Transcription models",
        "| Model | Use case | Input | Output | Estimated cost |",
        "| --- | --- | --- | --- | --- |",
        "| gpt-test | Transcription | EUR 2 | - | $0.006 / minute |",
      ].join("\n"),
    );
    expect(models[0]?.price_facts).toEqual([]);
    expect(models[0]?.raw_price_facts).toContainEqual(
      expect.objectContaining({ raw: expect.objectContaining({ amount: "EUR 2" }) }),
    );
  });

  it("does not reinterpret a token-column denominator from a conflicting cell suffix", () => {
    const { models } = parse(tokenTable("$2 / minute", "$3"));
    expect(models[0]?.price_facts).not.toContainEqual(
      expect.objectContaining({ meter: "input_text" }),
    );
    expect(models[0]?.raw_price_facts).toContainEqual(
      expect.objectContaining({
        reason: "unknown_unit",
        raw: expect.objectContaining({ amount: "$2 / minute", unit: "per 1M tokens" }),
      }),
    );
  });

  it("does not infer an audio meter from an unreadable modality", () => {
    const { models } = parse(
      [
        "Realtime and audio generation models",
        "| Model | Modality | Input | Cached input | Output |",
        "| --- | --- | --- | --- | --- |",
        "| gpt-test | Unreviewed | $2 / minute | - | - |",
      ].join("\n"),
    );
    expect(models[0]?.price_facts).toEqual([]);
    expect(models[0]?.raw_price_facts).toContainEqual(
      expect.objectContaining({
        reason: "unknown_meter",
        raw: expect.objectContaining({ amount: "$2 / minute" }),
      }),
    );
  });

  it("keeps an explicit free output partition", () => {
    const { models } = parse(tokenTable("$1", "Free"));
    expect(models[0]?.price_facts).toContainEqual(
      expect.objectContaining({ meter: "output_text", price: "0", raw_price: "Free" }),
    );
    expect(models[0]?.pricing_state).toBe("numeric");
  });

  it("does not turn a free input cell into a model-wide free state", () => {
    const { models } = parse(tokenTable("Free", "-"));
    expect(models[0]?.pricing_state).toBe("numeric");
    expect(models[0]?.price_facts).toContainEqual(
      expect.objectContaining({
        meter: "input_text",
        price: "0",
        raw_price: "Free",
      }),
    );
  });

  it("preserves a Free quote when regional applicability cannot be established", () => {
    const modelsSource = parse(tokenTable("Free", "$3").replace("Standard", "Fast"));
    const { models, report, source } = modelsSource;
    expect(report.observed_items).toBe(2);
    expect(report.disposition_counts.raw).toBe(2);
    expect(models[0]?.raw_price_facts).toContainEqual(
      expect.objectContaining({
        conditions: { service_tier: "fast", context_max_tokens: 272000 },
        raw: expect.objectContaining({ amount: "Free", unit: "per 1M tokens" }),
      }),
    );
    validatedPricing(modelsSource, source);
  });

  it.each([
    ["File search", "Tool call", "EUR 2 / 1k calls", "unknown_amount"],
    ["File search", "Tool call", "$2 / 1M calls", "unknown_unit"],
    ["Web search", "Web search (all models)", "EUR 10 / 1k calls", "unknown_amount"],
  ])("preserves unsupported %s invocation prices (%s, %s)", (tool, details, price, reason) => {
    const modelsSource = parse(
      tokenTable("$1", "$2") +
        "\n\nTools\n" +
        [
          "| Tool | Details | Pricing |",
          "| --- | --- | --- |",
          `| ${tool} | ${details} | ${price} |`,
        ].join("\n"),
    );
    const { source, report } = modelsSource;
    expect(report.observed_items).toBe(3);
    expect(report.disposition_counts.raw).toBe(1);
    expect(
      (modelsSource.commercial_facts ?? []).flatMap(({ raw_price_facts }) => raw_price_facts),
    ).toContainEqual(
      expect.objectContaining({ reason, raw: expect.objectContaining({ fragment: price }) }),
    );
    expect(() => validatedPricing(modelsSource, source)).not.toThrow();
  });

  it("counts each declared container capacity and preserves an unreadable sibling", () => {
    const modelsSource = parse(
      tokenTable("$1", "$2") +
        "\n\nTools\n" +
        [
          "| Tool | Details | Pricing |",
          "| --- | --- | --- |",
          "| Containers | Hosted Shell and Code Interpreter | 1 GB $0.03, 4 GB EUR 0.12, 16 GB $0.48, 64 GB $1.92 per 20-minute session per container. |",
        ].join("\n"),
    );
    const { report } = modelsSource;
    expect(report.observed_items).toBe(6);
    const container = (modelsSource.commercial_facts ?? []).find(
      ({ resource_key }) => resource_key === "containers",
    );
    expect(container?.price_facts).toHaveLength(3);
    expect(container?.raw_price_facts).toContainEqual(
      expect.objectContaining({
        conditions: { capacity: "4 GiB" },
        raw: expect.objectContaining({ amount: "EUR 0.12" }),
      }),
    );
  });

  it("keeps malformed fine-tuned inference evidence in its service book", () => {
    const modelsSource = parse(
      [
        "Finetuning",
        "Standard",
        "| Model | Training | Input | Cached input | Output |",
        "| --- | --- | --- | --- | --- |",
        "| gpt-test | $5 | EUR 2 | - | $3 |",
      ].join("\n"),
    );
    const { source, report } = modelsSource;
    expect(report.observed_items).toBe(4);
    const service = (modelsSource.commercial_facts ?? [])[0];
    expect(service?.raw_price_facts).toContainEqual(
      expect.objectContaining({
        raw: expect.objectContaining({ amount: "EUR 2", meter: "input_text" }),
        conditions: { service_tier: "standard", account_eligibility: "default" },
      }),
    );
    expect(() => validatedPricing(modelsSource, source)).not.toThrow();
  });

  it.each([
    ["Free", "$2"],
    ["$2", "Free"],
  ])("keeps Free and paid conflicts in either order (%s, %s)", (first, second) => {
    const modelsSource = parse(tokenTable(first, "$3") + "\n| gpt-test | " + second + " | $3 |");
    const { source } = modelsSource;
    const partition = validatedPricing(modelsSource, source);
    const input = partition?.books[0]?.offers
      .flatMap(({ terms }) => terms)
      .find(({ term_key }) => term_key === "input_text");
    expect(input).toMatchObject({ kind: "rate", variants: [] });
    if (input?.kind !== "rate") throw new Error("Missing input term");
    expect(
      input.raw_variants.flatMap(({ observations }) => observations.map(({ raw }) => raw.amount)),
    ).toEqual(expect.arrayContaining(["Free", "2"]));
  });

  it("preserves a bad HTML cell while counting actual card cells", async () => {
    const modelsSource = await parseCards((body) => body.replace("$10.00", "EUR 10"));
    const { models, report, source } = modelsSource;
    expect(report).toMatchObject({
      basis: "source_item",
      // Four Sol prices, two explicit multiplier rules, and one Live price.
      observed_items: 7,
    });
    expect(models.find(({ model_id }) => model_id === "gpt-6-sol")?.raw_price_facts).toContainEqual(
      expect.objectContaining({
        raw: expect.objectContaining({ amount: "EUR 10", meter: "output_text" }),
      }),
    );
    expect(() => validatedPricing(modelsSource, source)).not.toThrow();
  });

  it.each([
    ["Per 1M tokens", "Per 1B tokens", "unknown_unit"],
    ["<div>Output</div>", "<div>Unreviewed charge</div>", "unknown_meter"],
  ])("keeps HTML drift local (%s)", async (before, after, reason) => {
    const { models, report } = await parseCards((body) => body.replace(before, after));
    expect(report.observed_items).toBe(7);
    expect(models.find(({ model_id }) => model_id === "gpt-6-sol")?.raw_price_facts).toContainEqual(
      expect.objectContaining({ reason, raw: expect.objectContaining({ amount: "$10.00" }) }),
    );
    expect(models.find(({ model_id }) => model_id === "gpt-live-1")?.price_facts).toHaveLength(1);
  });

  it("counts derived HTML context rates once per source rule", async () => {
    const { models, report } = await parseCards((body) => body);
    expect(report.observed_items).toBe(7);
    expect(report.disposition_counts).toMatchObject({ normalized: 6, excluded: 1 });
    expect(models.find(({ model_id }) => model_id === "gpt-6-sol")?.price_facts).toHaveLength(8);
  });

  it("keeps HTML quotes raw when a tier switch loses its state", async () => {
    const { models, report } = await parseCards((body) =>
      body.replace(
        "<div>Text tokens</div><div>",
        "<div>Text tokens</div><div><button role='switch'></button>",
      ),
    );
    expect(report.observed_items).toBe(7);
    const sol = models.find(({ model_id }) => model_id === "gpt-6-sol");
    expect(sol?.price_facts).toEqual([]);
    expect(sol?.raw_price_facts).toContainEqual(
      expect.objectContaining({
        reason: "unknown_applicability",
        conditions: {},
        raw: expect.objectContaining({ amount: "$10.00" }),
      }),
    );
  });
});
