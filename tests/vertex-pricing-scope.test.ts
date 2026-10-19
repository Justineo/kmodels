import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { baseModel } from "../src/catalog/model.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import type { PricingReconciliationItem } from "../src/catalog/pricing-reconciliation.ts";
import { catalogSchema, type Catalog, type ModelTask } from "../src/catalog/schema.ts";
import { catalogRepairCandidates } from "../src/catalog/catalog-repair.ts";
import { sourcePricingReconciliation } from "../src/catalog/pricing-reconciliation.ts";
import { calculationExport } from "../src/catalog/pricing-calculator-export.ts";
import { createPricingCatalogEnvelope } from "../src/catalog/pricing-envelope.ts";
import { createCalculator, type Quantity } from "../src/pricing/index.ts";
import { canonicalJson } from "../src/catalog/canonical-json.ts";

const observedAt = "2026-10-19T07:12:03.562Z";
function configuration() {
  const value = manifests.find(({ provider }) => provider.id === "vertex");
  const source = value?.sources.find(({ id }) => id === "vertex-pricing");
  if (value === undefined || source === undefined) throw new Error("Missing Vertex pricing source");
  return { value, source };
}
const { value, source } = configuration();
const provider = { ...value.provider, source_ids: value.sources.map(({ id }) => id) };
const catalogModels = [
  ["claude-haiku-5-5", "Claude Haiku 5.5"],
  ["claude-sonnet-5-5", "Sonnet 5.5"],
].map(([id, name]) => {
  if (id === undefined || name === undefined) throw new Error("Missing fixture identity");
  return {
    ...baseModel({ providerId: "vertex", id, name, sourceId: source.id, observedAt }),
    tasks: ["text_generation"] satisfies ModelTask[],
    service_families: ["publishers/anthropic"],
  };
});

async function nativePricing() {
  return readFile(
    new URL("./fixtures/vertex/claude-context-pricing.html", import.meta.url),
    "utf8",
  );
}
function parse(body: string) {
  const findings: PricingReconciliationItem[] = [];
  const parsed = parseSource({
    provider,
    source,
    observedAt,
    body: JSON.stringify({ index: { url: source.url, body }, documents: [] }),
    catalogModels,
    onPricingReconciliation: (finding) => findings.push(finding),
  });
  return { ...parsed, findings };
}
async function coherentPricing() {
  return (await nativePricing()).replaceAll("longer than or equal to", "longer than");
}
function haiku(parsed: ReturnType<typeof parse>) {
  const model = parsed.models.find(({ model_id }) => model_id === "claude-haiku-5-5");
  if (model === undefined) throw new Error("Missing Haiku fixture model");
  return model;
}

function calculatorFor(parsed: ReturnType<typeof parse>) {
  const partition = assembleParsedProviderPricing(
    "vertex",
    observedAt,
    [{ source, ...parsed }],
    catalogModels,
  );
  if (partition === undefined) throw new Error("Missing pricing partition");
  const parsedCore: Catalog = {
    catalog_version: "a".repeat(64),
    generated_at: observedAt,
    coverage: [],
    warnings: [],
    providers: [provider],
    models: parsed.models,
    sources: [
      {
        id: source.id,
        provider_id: "vertex",
        url: source.url,
        source: ["website"],
        stability: source.stability,
        scope: source.scope ?? "global",
        exhaustive: false,
        role: "overlay",
        field_paths: source.fields,
        observed_at: observedAt,
        content_hash: "1".repeat(64),
        extractor_version: source.extractorVersion,
      },
    ],
  };
  const core = catalogSchema.parse(JSON.parse(JSON.stringify(parsedCore)));
  const exported = calculationExport(
    core,
    createPricingCatalogEnvelope(
      {
        provider_vocabularies: [partition.vocabulary],
        provider_snapshots: [partition.snapshot],
        model_dispositions: partition.model_dispositions,
        books: partition.books,
      },
      core,
    ),
  );
  const offer = exported.providers[0]?.books
    .find(({ scope }) => scope.model_refs.includes(haiku(parsed).uid))
    ?.offers.find(({ offer_key }) => offer_key === "sync");
  if (offer === undefined) throw new Error("Missing exported Haiku offer");
  return { calculator: createCalculator(exported), offer };
}

describe("Vertex native tariff scopes", () => {
  it.each([false, true])(
    "keeps independent 100K and 200K columns and endpoint locations (article=%s)",
    async (article) => {
      let body = await coherentPricing();
      if (article) body = `<div class="devsite-article-body">${body}</div>`;
      const parsed = parse(body);
      for (const [id, threshold, amount] of [
        ["claude-haiku-5-5", 100_000, "0.10"],
        ["claude-sonnet-5-5", 200_000, "2.00"],
      ] as const) {
        const model = parsed.models.find(({ model_id }) => model_id === id);
        expect(model?.raw_price_facts).toEqual([]);
        const rates = model?.price_facts.filter(({ meter }) => meter === "input_text");
        expect(rates?.length).toBeGreaterThan(0);
        expect(rates).toContainEqual(
          expect.objectContaining({
            price: amount,
            conditions: expect.objectContaining({
              region: "global",
              context_max_tokens: threshold,
            }),
          }),
        );
        expect(
          rates?.every(
            ({ conditions }) =>
              conditions.context_max_tokens === threshold ||
              conditions.context_min_tokens === threshold + 1,
          ),
        ).toBe(true);
        expect(
          rates?.every(
            ({ conditions }) =>
              ["global", "us"].includes(conditions.region ?? "") &&
              conditions.deployment_scope === undefined,
          ),
        ).toBe(true);
      }
      const partition = assembleParsedProviderPricing(
        "vertex",
        observedAt,
        [{ source, ...parsed }],
        catalogModels,
      );
      const terms =
        partition?.books.flatMap(({ offers }) => offers.flatMap(({ terms }) => terms)) ?? [];
      const rates = terms.filter((term) => term.kind === "rate");
      expect(rates.length).toBeGreaterThan(0);
      expect(
        rates.every(
          ({ variants, raw_variants }) => variants.length > 0 && raw_variants.length === 0,
        ),
      ).toBe(true);
    },
  );

  it("retains contradictory native threshold declarations as local raw evidence", async () => {
    const parsed = parse(await nativePricing());
    const haiku = parsed.models.find(({ model_id }) => model_id === "claude-haiku-5-5");
    expect(haiku?.price_facts).toEqual([]);
    expect(haiku?.raw_price_facts.length).toBeGreaterThan(0);
    expect(haiku?.raw_price_facts.every(({ reason }) => reason === "unknown_applicability")).toBe(
      true,
    );
    expect(haiku?.raw_price_facts.some(({ raw }) => raw.fragment?.includes("$0.10"))).toBe(true);
    expect(
      haiku?.raw_price_facts.some(({ raw }) =>
        raw.fragment?.includes("longer than or equal to 100k tokens"),
      ),
    ).toBe(true);
    expect(haiku?.raw_price_facts).toContainEqual(
      expect.objectContaining({
        raw: expect.objectContaining({
          amount: "0.10",
          denomination: "USD",
          meter: "input_text",
          unit: expect.stringContaining("1M tokens"),
        }),
      }),
    );
    expect(parsed.findings).toContainEqual(
      expect.objectContaining({
        disposition: "unresolved",
        reason_code: "pricing_context_scope_unresolved",
      }),
    );
  });

  it("does not borrow another endpoint's threshold declaration", async () => {
    const body = (await nativePricing())
      .replaceAll("longer than or equal to", "longer than")
      .replace("longer than 100k tokens", "longer than or equal to 100k tokens");
    const haiku = parse(body).models.find(({ model_id }) => model_id === "claude-haiku-5-5");
    expect(haiku?.price_facts.some(({ conditions }) => conditions.region === "us")).toBe(true);
    expect(haiku?.price_facts.some(({ conditions }) => conditions.region === "global")).toBe(false);
    expect(haiku?.raw_price_facts.length).toBeGreaterThan(0);
    expect(haiku?.raw_price_facts.every(({ conditions }) => conditions?.region === "global")).toBe(
      true,
    );
  });

  it("does not borrow a separately owned table's footnote in the same panel", async () => {
    const body = (await coherentPricing()).replace(
      '<div role="tabpanel" aria-labelledby="pricing-global">',
      '<div role="tabpanel" aria-labelledby="pricing-global"><div><table><tr><th>Unrelated table</th></tr><tr><td>Not a price</td></tr></table><p>** If a query input context is longer than 200K tokens, all tokens (input and output) are charged at long context rates.</p></div>',
    );
    const model = haiku(parse(body));
    expect(model.raw_price_facts).toEqual([]);
    expect(
      model.price_facts.some(
        ({ conditions }) =>
          conditions.region === "global" && conditions.context_max_tokens === 100_000,
      ),
    ).toBe(true);
  });

  it.each(["0.5K", "10,00K", "9007199254740991K", "-100K"])(
    "keeps an unsafe native context count raw (%s)",
    async (count) => {
      const result = parse((await coherentPricing()).replaceAll("100K", count));
      expect(haiku(result).price_facts).toEqual([]);
      expect(haiku(result).raw_price_facts.some(({ raw }) => raw.fragment?.includes("$0.10"))).toBe(
        true,
      );
      expect(
        result.models.find(({ model_id }) => model_id === "claude-sonnet-5-5")?.price_facts.length,
      ).toBeGreaterThan(0);
    },
  );

  it.each(["short", "long"])("keeps a %s bound independent of the opposite quote", async (band) => {
    const body = (await coherentPricing()).replace(
      band === "short" ? "<td>$0.50</td>" : "<td>$0.10</td>",
      "<td></td>",
    );
    const prices = haiku(parse(body)).price_facts;
    expect(prices).toContainEqual(
      expect.objectContaining({
        price: band === "short" ? "0.10" : "0.50",
        conditions: expect.objectContaining(
          band === "short" ? { context_max_tokens: 100_000 } : { context_min_tokens: 100_001 },
        ),
      }),
    );
  });

  it.each(["missing", "malformed", "duplicate"])(
    "withholds only a broken owned footnote (%s)",
    async (change) => {
      const original = await coherentPricing();
      const note = original.match(/<p>\s*\*\* If a query input context[\s\S]*?<\/p>/)?.[0];
      if (note === undefined) throw new Error("Missing owned footnote");
      const body = original.replace(
        note,
        change === "missing"
          ? ""
          : change === "malformed"
            ? note.replace("longer than", "in a context class of")
            : note + note.replace("100k", "200K"),
      );
      const model = haiku(parse(body));
      expect(model.price_facts.some(({ conditions }) => conditions.region === "global")).toBe(
        false,
      );
      expect(model.price_facts.some(({ conditions }) => conditions.region === "us")).toBe(true);
      expect(model.raw_price_facts.length).toBeGreaterThan(0);
      expect(model.raw_price_facts.every(({ conditions }) => conditions?.region === "global")).toBe(
        true,
      );
    },
  );

  it("ignores a quoted tab label and quoted contradictory rule", async () => {
    const body = (await coherentPricing())
      .replace(
        "<main>",
        '<main><blockquote><div role="tab" id="pricing-global">Elsewhere</div><p>** If a query input context is longer than or equal to 100k tokens, all tokens (input and output) are charged at long context rates.</p></blockquote>',
      )
      .replace(
        '<div role="tabpanel" aria-labelledby="pricing-global">',
        '<div role="tabpanel" aria-labelledby="pricing-global"><blockquote><table><tr><th>Example</th></tr><tr><td>Not a tariff</td></tr></table></blockquote>',
      );
    const model = haiku(parse(body));
    expect(model.raw_price_facts).toEqual([]);
    expect(model.price_facts.some(({ conditions }) => conditions.region === "global")).toBe(true);
  });

  it.each(["duplicate", "unknown"])("withholds a broken owned location (%s)", async (change) => {
    const body = (await coherentPricing()).replace(
      '<div role="tab" id="pricing-global">Global</div>',
      change === "duplicate"
        ? '<div role="tab" id="pricing-global">Global</div><div role="tab" id="pricing-global">US</div>'
        : '<div role="tab" id="pricing-global">All locations</div>',
    );
    const result = parse(body);
    expect(haiku(result).price_facts.some(({ conditions }) => conditions.region === "us")).toBe(
      true,
    );
    expect(haiku(result).price_facts.some(({ conditions }) => conditions.region === "global")).toBe(
      false,
    );
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        reason_code: "pricing_location_scope_unresolved",
        disposition: "unresolved",
      }),
    );
  });

  it("keeps a Region-column wildcard separate from a named endpoint location", () => {
    const model = haiku(
      parse(
        "<main><table><tr><th>Model</th><th>Type</th><th>Region</th><th>Price (/1M tokens)</th></tr><tr><td>Claude Haiku 5.5</td><td>Input</td><td>Global</td><td>$0.10</td></tr><tr><td>Claude Haiku 5.5</td><td>Input</td><td>Non-global</td><td>$0.11</td></tr></table></main>",
      ),
    );
    expect(model.price_facts.map(({ conditions }) => conditions)).toEqual(
      expect.arrayContaining([
        { service_tier: undefined, deployment_scope: "global" },
        { service_tier: undefined, deployment_scope: "non-global" },
      ]),
    );
  });

  it("rejects a contradictory multi-region label", async () => {
    const result = parse(
      (await coherentPricing()).replace("US Multi-Region (US)", "US Multi-Region (EU)"),
    );
    expect(haiku(result).price_facts.some(({ conditions }) => conditions.region === "eu")).toBe(
      false,
    );
    expect(haiku(result).raw_price_facts.length).toBeGreaterThan(0);
  });

  it("does not accept a synthetic scope attribute as native evidence", () => {
    const model = haiku(
      parse(
        '<main><table data-kmodels-pricing-scope="Global"><tr><th>Model</th><th>Type</th><th>Price (/1M tokens)</th></tr><tr><td>Claude Haiku 5.5</td><td>Input</td><td>$0.10</td></tr></table></main>',
      ),
    );
    expect(model.price_facts).toHaveLength(1);
    expect(model.price_facts[0]?.conditions.region).toBeUndefined();
    expect(model.price_facts[0]?.conditions.deployment_scope).toBeUndefined();
  });

  it("binds labeled token cells to the same independently declared context bands", () => {
    const model = haiku(
      parse(
        "<main><h3>Global</h3><table><tr><th>Model</th><th>Price (/1M tokens) &lt;= 100K input tokens</th><th>Price (/1M tokens) &gt; 100K input tokens</th></tr><tr><td>Claude Haiku 5.5</td><td>Input: $0.10 Output: $0.50</td><td>Input: $0.50 Output: $2.50</td></tr></table></main>",
      ),
    );
    expect(model.price_facts).toHaveLength(4);
    expect(model.price_facts).toContainEqual(
      expect.objectContaining({
        price: "0.10",
        conditions: expect.objectContaining({ region: "global", context_max_tokens: 100_000 }),
      }),
    );
    expect(model.price_facts).toContainEqual(
      expect.objectContaining({
        price: "0.50",
        meter: "input_text",
        conditions: expect.objectContaining({ region: "global", context_min_tokens: 100_001 }),
      }),
    );
  });

  it("does not borrow a short-column label sequence to resolve an ambiguous long column", () => {
    const table = (operator: string, cell: string) =>
      `<table><tr><th>Model</th><th>Price (/1M tokens) ${operator} 100K input tokens **</th></tr><tr><td>Claude Haiku 5.5</td><td>${cell}</td></tr></table><p>** If a query input context is longer than 100K tokens, all tokens (input and output) are charged at long context rates.</p>`;
    const short = table("&lt;=", "Input: $0.10 Output: $0.50");
    const model = haiku(
      parse(
        `<div class="devsite-article-body"><h3>Global</h3>${short}${short}${table("&gt;", "Input: $0.50 Output: $2.50 Input: $0.60 Output: $3.00")}</div>`,
      ),
    );
    expect(model.price_facts).toHaveLength(2);
    expect(
      model.price_facts.every(({ conditions }) => conditions.context_max_tokens === 100_000),
    ).toBe(true);
    expect(model.raw_price_facts).toContainEqual(
      expect.objectContaining({
        impact: "base_price",
        conditions: expect.objectContaining({ context_min_tokens: 100_001 }),
        raw: expect.objectContaining({ fragment: expect.stringContaining("Input: $0.60") }),
      }),
    );
  });

  it.each(["context", "location"])(
    "admits owned %s failures to repair even when the source is unchanged",
    async (contract) => {
      const result = parse(
        contract === "context"
          ? await nativePricing()
          : (await coherentPricing()).replace(
              'id="pricing-global">Global',
              'id="pricing-global">All locations',
            ),
      );
      const reconciliation = sourcePricingReconciliation(result.models, result.findings, true);
      const candidates = catalogRepairCandidates({
        schema_version: 2,
        generated_at: observedAt,
        providers: [
          {
            provider_id: "vertex",
            signals: [],
            attempt: {
              outcome: "accepted",
              sources: [
                {
                  source_id: source.id,
                  outcome: "unchanged",
                  content_changed: false,
                  pricing_reconciliation: reconciliation,
                },
              ],
            },
          },
        ],
      });
      expect(candidates).toContainEqual(
        expect.objectContaining({
          source_id: source.id,
          trigger: "source_pricing_structure",
          message: expect.stringContaining(`pricing_${contract}_scope_unresolved`),
        }),
      );
    },
  );

  it.each([
    [100_000, "global", { numerator: "1", denominator: "100" }],
    [100_001, "global", { numerator: "100001", denominator: "2000000" }],
    [100_000, "us", { numerator: "11", denominator: "1000" }],
  ] as const)(
    "calculates coherent source scopes through the portable export (%s, %s)",
    async (context, region, expected) => {
      const { calculator, offer } = calculatorFor(parse(await coherentPricing()));
      const quantities = new Map<string, Quantity>();
      for (const term of offer.terms) {
        if (term.kind !== "rate") continue;
        for (const { charge_binding } of term.variants) {
          if (charge_binding === undefined) continue;
          quantities.set(canonicalJson(charge_binding.signal), {
            signal: charge_binding.signal,
            value: {
              numerator: term.meter.value === "input_text" ? String(context) : "0",
              denominator: "1",
            },
          });
        }
      }
      const result = calculator.calculate({
        evaluatedAt: observedAt,
        components: [
          {
            id: "coherent",
            offerRef: offer.id,
            quantities: [...quantities.values()],
            selectors: [
              {
                kind: "categorical",
                dimension: { namespace: "kmodels", value: "region" },
                value: { namespace: "provider", provider_id: "vertex", value: region },
              },
              {
                kind: "decimal",
                dimension: { namespace: "kmodels", value: "context_tokens" },
                value: String(context),
                unit: { factors: [{ unit: { namespace: "kmodels", value: "token" }, power: 1 }] },
              },
            ],
          },
        ],
      });
      expect(result).toMatchObject({
        status: "calculated",
        totals: [{ denomination: { kind: "fiat", currency: "USD" }, amount: expected }],
      });
    },
  );

  it("keeps the contradictory native schedule unknown through the portable export", async () => {
    const { calculator, offer } = calculatorFor(parse(await nativePricing()));
    const result = calculator.calculate({
      evaluatedAt: observedAt,
      components: [
        {
          id: "native",
          offerRef: offer.id,
          quantities: [],
          selectors: [
            {
              kind: "categorical",
              dimension: { namespace: "kmodels", value: "region" },
              value: { namespace: "provider", provider_id: "vertex", value: "global" },
            },
          ],
        },
      ],
    });
    expect(result.status).toBe("unknown");
    expect(result.totals).toBeUndefined();
  });

  it.each([
    "Standard Model",
    "Standard",
    "Priority",
    "Flex/Batch",
    "Token-based pricing",
    "Modality-based pricing",
  ])("does not turn a native %s processing or unit tab into a region", (label) => {
    const model = haiku(
      parse(
        `<main><div role="tab" id="prices">${label}</div><div role="tabpanel" aria-labelledby="prices"><table><tr><th>Model</th><th>Type</th><th>Price (/1M tokens)</th></tr><tr><td>Claude Haiku 5.5</td><td>Input</td><td>$0.10</td></tr></table></div></main>`,
      ),
    );
    expect(model.raw_price_facts).toEqual([]);
    expect(model.price_facts.length).toBeGreaterThan(0);
    expect(
      model.price_facts.every(
        ({ conditions }) =>
          conditions.region === undefined && conditions.deployment_scope === undefined,
      ),
    ).toBe(true);
    if (label === "Standard" || label === "Standard Model")
      expect(model.price_facts[0]?.conditions.service_tier).toBe("standard");
  });
});
