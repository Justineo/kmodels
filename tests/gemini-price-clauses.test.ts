import { readFile } from "node:fs/promises";
import { expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { captureInferencePriceSources } from "../src/catalog/inference-pricing-source.ts";
import { compileInferencePriceMapping } from "../src/catalog/inference-pricing-compilation.ts";
import { manifests, type ProviderManifest, type SourceManifest } from "../src/catalog/manifests.ts";
import { baseModel } from "../src/catalog/model.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import { priceDataExport } from "../src/catalog/pricing-lookup-export.ts";
import { modelPricingView } from "../src/catalog/pricing-presentation.ts";
import { prepareCatalogPair } from "../src/catalog/pricing-publication.ts";
import { providerModelSchema, type Modality } from "../src/catalog/schema.ts";
import { createCommercialPriceLookup } from "../src/pricing/commercial.ts";
import type { Selector } from "../src/pricing/schema.ts";

function configuration() {
  const manifest: ProviderManifest | undefined = manifests.find(
    ({ provider }) => provider.id === "gemini",
  );
  const source: SourceManifest | undefined = manifest?.sources.find(
    ({ id }) => id === "gemini-pricing",
  );
  if (!manifest || !source) throw new Error("Missing Gemini pricing configuration");
  return { manifest, source };
}
const { manifest, source } = configuration();
const provider = { ...manifest.provider, source_ids: manifest.sources.map(({ id }) => id) };
const at = "2026-11-17T15:13:45.343Z";
const discovery = await readFile(
  new URL("./fixtures/gemini/discovery.json", import.meta.url),
  "utf8",
);

function parse(body: string, id = "clause-model", input: Modality[] = ["text"]) {
  const model = {
    ...baseModel({ providerId: "gemini", id, name: id, sourceId: source.id, observedAt: at }),
    tasks: ["text_generation" as const],
    modalities: { input, output: ["text" as const, "audio" as const] },
    api_endpoints: [{ name: "generateContent", path: `/v1beta/models/${id}:generateContent` }],
  };
  const parsed = parseSource({
    provider,
    source,
    observedAt: at,
    catalogModels: [model],
    body: JSON.stringify({
      index: { url: source.url, body },
      documents: [
        {
          url: "https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta",
          body: discovery,
        },
      ],
    }),
  });
  return { model, parsed };
}

function assemble(body: string, id = "clause-model", input?: Modality[]) {
  const { model, parsed } = parse(body, id, input);
  const partition = assembleParsedProviderPricing(
    "gemini",
    at,
    [{ source, ...parsed }],
    [model],
    manifest.pricingCategoricalLabels,
  );
  if (!partition) throw new Error("Missing Gemini price partition");
  const sources = [
    {
      id: source.id,
      provider_id: "gemini",
      url: source.url,
      source: [source.type],
      stability: source.stability,
      scope: "global" as const,
      exhaustive: false,
      role: "overlay" as const,
      field_paths: source.fields,
      observed_at: at,
      content_hash: "1".repeat(64),
      extractor_version: source.extractorVersion,
      ...(source.pricingEvidence === undefined ? {} : { pricing_evidence: source.pricingEvidence }),
    },
  ];
  const core = {
    catalog_version: "a".repeat(64),
    generated_at: at,
    providers: [provider],
    models: [providerModelSchema.parse(model)],
    sources,
    coverage: [],
    warnings: [],
  };
  const pair = compileInferencePriceMapping(
    prepareCatalogPair(core, {
      books: partition.books,
      provider_vocabularies: [partition.vocabulary],
      provider_snapshots: [partition.snapshot],
      model_dispositions: partition.model_dispositions,
    }),
    captureInferencePriceSources([{ source, ...parsed }], sources),
  );
  const data = priceDataExport(pair.catalog, pair.pricing);
  return {
    parsed,
    partition,
    pair,
    data,
    model,
    lookup: createCommercialPriceLookup(data, pair.inference?.mapping),
  };
}

function html(
  cell: string,
  row = "Context caching price",
  header = "Paid Tier, per 1M tokens in USD",
) {
  return `<div class="devsite-article-body"><div class="models-section"><div class="heading-group"><code>clause-model</code></div></div><section><h3>Standard</h3><table class="pricing-table"><thead><tr><th>Feature</th><th>Free Tier</th><th>${header}</th></tr></thead><tbody><tr><td>${row}</td><td>Not available</td><td>${cell}</td></tr></tbody></table></section></div>`;
}

function selector(
  dimension: "account_eligibility" | "service_tier" | "served_service_tier",
  value: string,
): Selector {
  return {
    kind: "categorical",
    dimension: { namespace: "kmodels", value: dimension },
    value: { namespace: "provider", provider_id: "gemini", value },
  };
}

// Reduced owned pricing tables captured on 2026-11-17 from https://aistudio.google.com/docs/pricing.
it.each(["native", "two-space", "soft-wrap"])(
  "keeps native read and storage schedules distinct through public lookup (%s)",
  async (format) => {
    let body = await readFile(
      new URL("./fixtures/gemini/cache-storage-clauses.txt", import.meta.url),
      "utf8",
    );
    if (format === "two-space") body = body.replace(/\\+[ \t]*\n/g, "  \n");
    if (format === "soft-wrap") body = body.replace(/\\+[ \t]*\n/g, "\n");
    const id = "gemini-robotics-er-2-preview";
    const { parsed, partition, pair, data, lookup, model } = assemble(body, id, [
      "text",
      "image",
      "video",
      "audio",
    ]);
    expect(
      parsed.models[0]?.price_facts
        .filter(({ meter }) => meter === "cache_read_text")
        .map(({ price }) => price)
        .sort(),
    ).toEqual(["0.05", "0.10", "0.10", "0.20"]);
    const storageFacts = parsed.commercial_facts?.flatMap(({ price_facts }) => price_facts) ?? [];
    expect(storageFacts).toHaveLength(4);
    expect(
      storageFacts.every(
        ({ meter, unit, conditions }) =>
          meter === "cache_storage" &&
          unit === "million_tokens_per_hour" &&
          conditions.modality === undefined,
      ),
    ).toBe(true);
    expect(
      partition.books.flatMap(({ offers }) =>
        offers.flatMap(({ terms }) =>
          terms.flatMap((term) => (term.kind === "raw" ? term.variants : term.raw_variants)),
        ),
      ),
    ).toEqual([]);
    const storage = data.providers[0]?.books.find(
      ({ book_key }) => book_key === "service:context-cache-storage",
    );
    if (!storage) throw new Error("Missing storage resource");
    for (const [evaluated_at, storageDenominator, standardDenominator, batchDenominator] of [
      ["2026-11-18T15:00:00Z", "7200000000", "10000000", "20000000"],
      ["2027-01-05T15:00:00Z", "3600000000", "5000000", "10000000"],
    ] as const) {
      for (const [tier, execution, readDenominator] of [
        ["standard", "request", standardDenominator],
        ["batch", "batch", batchDenominator],
      ] as const) {
        const selectors = [selector("account_eligibility", "paid_tier")];
        const stored = lookup({
          subject: { kind: "resource", provider_id: "gemini", book_ref: storage.id },
          meter: { namespace: "kmodels", value: "storage" },
          evaluated_at,
          selectors: [
            ...selectors,
            selector("service_tier", tier),
            {
              kind: "categorical",
              dimension: { namespace: "kmodels", value: "model" },
              value: { namespace: "kmodels", value: model.uid },
            },
          ],
        });
        expect(stored.status).toBe("matched");
        expect(
          stored.candidates.flatMap((c) =>
            c.offer.terms.flatMap((t) => (t.kind === "rate" ? t.variants.map((v) => v.price) : [])),
          ),
        ).toEqual([
          {
            denomination: { kind: "fiat", currency: "USD" },
            value: { numerator: "1", denominator: storageDenominator },
            per: {
              factors: [
                { unit: { namespace: "kmodels", value: "second" }, power: 1 },
                { unit: { namespace: "kmodels", value: "token" }, power: 1 },
              ],
            },
          },
        ]);
        const read = lookup({
          subject: { kind: "model", provider_id: "gemini", model_id: id },
          choices: [{ dimension: "execution", value: { namespace: "kmodels", value: execution } }],
          meter: { namespace: "kmodels", value: "cache_read_text" },
          evaluated_at,
          selectors: [
            ...selectors,
            ...(tier === "standard" ? [selector("served_service_tier", tier)] : []),
          ],
        });
        expect(read.status).toBe("matched");
        expect(
          read.candidates.flatMap((c) =>
            c.offer.terms.flatMap((t) =>
              t.kind === "rate" ? t.variants.map((v) => v.price.value) : [],
            ),
          ),
        ).toEqual([{ numerator: "1", denominator: readDenominator }]);
      }
    }
    expect(
      modelPricingView(pair.pricing.data, providerModelSchema.parse(model)).optionalServices.some(
        ({ terms }) => terms.some((t) => t.kind === "rate" && t.meter.value === "storage"),
      ),
    ).toBe(true);
  },
);

it.each(["<br>", " ", "\n"])(
  "does not borrow a neighbor's storage meter or modality (%j)",
  (separator) => {
    const cell = `$0.37 through March 31, 2028.${separator}$2.40 / 1,000,000 tokens per hour (audio storage price) starting April 1, 2028.`;
    const { parsed } = parse(html(cell));
    expect(parsed.models[0]?.price_facts).toEqual([
      expect.objectContaining({
        meter: "cache_read_text",
        price: "0.37",
        unit: "million_tokens",
        conditions: {
          account_eligibility: "paid_tier",
          service_tier: "standard",
          effective_until: "2028-03-31",
        },
      }),
    ]);
    expect(parsed.commercial_facts?.flatMap((f) => f.price_facts)).toEqual([
      expect.objectContaining({
        meter: "cache_storage",
        price: "2.40",
        unit: "million_tokens_per_hour",
        conditions: {
          account_eligibility: "paid_tier",
          service_tier: "standard",
          modality: "audio",
          effective_from: "2028-04-01",
        },
      }),
    ]);
  },
);

it("bills the parent of an included modality and preserves separately priced audio", () => {
  const rates = (cell: string) =>
    parse(html(cell, "Output price")).parsed.models.flatMap((model) =>
      model.price_facts.map(({ meter, price }) => [meter, price]),
    );
  expect(rates("$9.00 (text)<br>$17.50 (video, audio included)")).toEqual([
    ["output_text", "9.00"],
    ["output_video", "17.50"],
  ]);
  expect(rates("$17.50 (video)<br>$6.00 (audio)")).toEqual([
    ["output_audio", "6.00"],
    ["output_video", "17.50"],
  ]);
});

it("keeps unqualified output on its own modality and excludes an adjacent equivalence", () => {
  const { parsed } = parse(
    html("$3.70 (text). $8.10 (audio). Equivalent to $0.002 per 10s audio", "Output price"),
  );
  expect(
    parsed.models[0]?.price_facts.map(({ meter, price, unit }) => ({ meter, price, unit })),
  ).toEqual([
    { meter: "output_audio", price: "8.10", unit: "million_tokens" },
    { meter: "output_text", price: "3.70", unit: "million_tokens" },
  ]);
});

it.each([false, true])("keeps a complete equivalence list non-billable (primary=%s)", (primary) => {
  const equivalence =
    "Equivalent to $0.0336 per 1K image, $0.0504 per 2K image, and $0.113 per 4K image";
  const cell = `${primary ? "$9.00 (audio). " : ""}${equivalence}`;
  const { parsed } = parse(html(cell, "Output price"));
  expect(
    parsed.models[0]?.price_facts.map(({ meter, price, unit }) => ({ meter, price, unit })),
  ).toEqual(primary ? [{ meter: "output_audio", price: "9.00", unit: "million_tokens" }] : []);
  expect(parsed.models[0]?.raw_price_facts).toEqual(
    primary
      ? []
      : [
          expect.objectContaining({
            reason: "unknown_unit",
            raw: expect.objectContaining({ fragment: equivalence }),
          }),
        ],
  );
});

it.each([
  ["$3.70 or $0.005/min (audio)", ["input_audio"]],
  ["$0.70 or $0.002/min (image/video)", ["input_image", "input_video"]],
])(
  "preserves the explicitly shared modality of a token/minute equivalence (%s)",
  (cell, meters) => {
    const { parsed } = parse(html(cell, "Input price"));
    expect(parsed.models[0]?.price_facts.map(({ meter }) => meter)).toEqual(meters);
    expect(parsed.models[0]?.price_facts.every(({ unit }) => unit === "million_tokens")).toBe(true);
  },
);

it.each(["Audio: $8.10", "$3.70 (text); Audio: $8.10"])(
  "keeps unreviewed prefix labels raw without assigning them to the preceding amount (%s)",
  (cell) => {
    const { parsed } = parse(html(cell, "Output price"));
    expect(parsed.models[0]?.price_facts.map(({ meter, price }) => ({ meter, price }))).toEqual(
      cell.startsWith("$") ? [{ meter: "output_text", price: "3.70" }] : [],
    );
    expect(parsed.models[0]?.raw_price_facts).toEqual([
      expect.objectContaining({
        reason: "unsupported_structure",
        raw: expect.objectContaining({ fragment: cell }),
      }),
    ]);
  },
);

it("preserves unknown-unit scope and complete raw evidence without borrowing storage applicability", () => {
  const cell =
    "$0.37 through March 31, 2028. $2.40 / 1,000,000 tokens per hour (storage price) starting April 1, 2028.";
  const { parsed } = parse(html(cell, "Context caching price", "Paid Tier, in USD"));
  expect(parsed.models[0]?.raw_price_facts).toEqual([
    expect.objectContaining({
      reason: "unknown_unit",
      conditions: {
        account_eligibility: "paid_tier",
        service_tier: "standard",
        effective_until: "2028-03-31",
      },
      raw: expect.objectContaining({ fragment: cell }),
    }),
  ]);
  expect(parsed.models[0]?.raw_price_facts[0]?.raw.meter).toBeUndefined();
  expect(parsed.commercial_facts?.flatMap((f) => f.raw_price_facts)).toEqual([]);
  expect(parsed.commercial_facts?.flatMap((f) => f.price_facts)).toEqual([
    expect.objectContaining({ meter: "cache_storage", price: "2.40" }),
  ]);
});

it("retains full mixed-cell evidence and keeps actual unequal same-scope quotes unresolved", () => {
  const cell = "$0.37 (text). $0.41 (text). $2.40 / 1,000,000 tokens per hour (storage price)";
  const { parsed, partition } = assemble(html(cell));
  expect(
    parsed.models[0]?.price_facts.every(({ source_locator }) => source_locator?.value === cell),
  ).toBe(true);
  const term = partition.books
    .find(({ book_key }) => book_key === "model:gemini/clause-model")
    ?.offers.flatMap((o) => o.terms)
    .find((t) => t.kind === "rate" && t.meter.value === "cache_read_text");
  if (!term || term.kind !== "rate") throw new Error("Missing cache read term");
  expect(term.variants).toEqual([]);
  expect(term.raw_variants).toContainEqual(
    expect.objectContaining({ reason: "conflicting_values" }),
  );
  expect(
    term.raw_variants
      .flatMap((v) => v.observations.map((o) => o.raw.amount))
      .sort((left, right) => (left ?? "").localeCompare(right ?? "")),
  ).toEqual(["0.37", "0.41"]);
  expect(
    partition.books
      .find(({ book_key }) => book_key === "service:context-cache-storage")
      ?.offers.flatMap((o) => o.terms)
      .flatMap((t) => (t.kind === "rate" ? t.variants : [])),
  ).toHaveLength(1);
});
