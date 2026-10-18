import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { manifests, type ProviderManifest } from "../src/catalog/manifests.ts";
import { baseModel } from "../src/catalog/model.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import { validatePricingCatalog } from "../src/catalog/pricing-validation.ts";
import { evaluateRateCost } from "../src/catalog/pricing-calculation.ts";
import type { SourceParseResult } from "../src/catalog/source-parse.ts";

const observedAt = "2026-10-19T00:00:00.000Z";
function configuration() {
  const value: ProviderManifest | undefined = manifests.find(
    ({ provider }) => provider.id === "gemini",
  );
  const source = value?.sources.find(({ id }) => id === "gemini-pricing");
  if (value === undefined || source === undefined) throw new Error("Missing Gemini manifest");
  return { value, source };
}
const { value, source } = configuration();
const provider = { ...value.provider, source_ids: value.sources.map(({ id }) => id) };
const catalogModels = ["gemini-4-argon", "gemini-3.8-flash", "gemini-2.5-pro"].map((id) =>
  baseModel({ providerId: provider.id, id, name: id, sourceId: source.id, observedAt }),
);
const fixture = (name: string) =>
  readFile(new URL(`./fixtures/gemini/${name}`, import.meta.url), "utf8");

async function parse(pricing?: string, maps?: string) {
  return parseSource({
    provider,
    source,
    observedAt,
    catalogModels,
    body: JSON.stringify({
      index: { url: source.url, body: pricing ?? (await fixture("grounding-current.html")) },
      documents: [
        {
          url: "https://ai.google.dev/gemini-api/docs/maps-grounding",
          body: maps ?? (await fixture("maps-grounding-current.html")),
        },
        {
          url: "https://ai.google.dev/api/interactions-api",
          body: await fixture("interactions-api.html"),
        },
      ],
    }),
  });
}

async function assemble(pricing?: string, maps?: string) {
  return assembleParsed(await parse(pricing, maps));
}

function assembleParsed(parsed: SourceParseResult) {
  const partition = assembleParsedProviderPricing(
    provider.id,
    observedAt,
    [{ source, ...parsed }],
    catalogModels,
    value.pricingCategoricalLabels,
  );
  if (partition === undefined) throw new Error("Missing grounding pricing");
  validatePricingCatalog(
    {
      provider_vocabularies: [partition.vocabulary],
      provider_snapshots: [partition.snapshot],
      books: partition.books,
      model_dispositions: partition.model_dispositions,
    },
    {
      providers: [provider],
      models: catalogModels,
      sources: [
        {
          id: source.id,
          provider_id: provider.id,
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

describe("Gemini grounding source policies", () => {
  it("keeps a shared monthly pool singular across Standard and Priority observations", async () => {
    const body = await fixture("grounding-current.html");
    const section = body.match(/<section>[\s\S]*?<\/section>/)?.[0];
    if (section === undefined) throw new Error("Missing tier section");
    const partition = await assemble(
      body.replace(section, `${section}\n${section.replace("Standard", "Priority")}`),
    );
    for (const book of partition.books) {
      const terms = book.offers.flatMap(({ terms }) =>
        terms.filter((term) => term.kind === "allowance"),
      );
      expect(terms).toHaveLength(1);
      const target = terms[0]?.variants[0]?.target;
      expect(target?.kind === "rate_terms" ? target.term_refs.length : 0).toBe(2);
      expect(terms[0]?.variants[0]?.benefit).toMatchObject({
        quantity: { value: { numerator: "5000", denominator: "1" } },
      });
    }
  });

  it("keeps an explicitly unshared daily prompt allowance distinct from the monthly query pool", async () => {
    const body = await fixture("grounding-current.html");
    const legacy = `<div class="models-section"><div class="heading-group"><code>gemini-2.5-pro</code></div></div>
      <table class="pricing-table"><thead><tr><th></th><th>Free Tier</th><th>Paid Tier, per 1M tokens in USD</th></tr></thead>
      <tbody><tr><td>Grounding with Google Search</td><td>Not available</td><td>1,500 RPD (free), then $35 / 1,000 grounded prompts</td></tr></tbody></table>`;
    const partition = await assemble(body.replace(/<\/div>\s*$/, `${legacy}</div>`));
    const book = partition.books.find(({ book_key }) => book_key === "service:google-search");
    const daily = book?.offers.find(({ terms }) =>
      terms.some(
        (term) =>
          term.kind === "allowance" && term.variants.some(({ reset }) => reset.value === "daily"),
      ),
    );
    expect(daily?.model_refs).toEqual(["gemini/gemini-2.5-pro"]);
    expect(daily?.terms[0]).toMatchObject({
      kind: "allowance",
      variants: [
        {
          benefit: {
            quantity: {
              value: { numerator: "1500", denominator: "1" },
              unit: { factors: [{ unit: { namespace: "kmodels", value: "request" }, power: 1 }] },
            },
          },
        },
      ],
    });
    expect(
      book?.offers.flatMap(({ terms }) => terms.filter((term) => term.kind === "allowance")),
    ).toHaveLength(2);
  });

  it("publishes current shared pools and query units for exact Gemini 3 and newer identities", async () => {
    const partition = await assemble();
    for (const service of ["google-search", "google-maps"]) {
      const book = partition.books.find(({ book_key }) => book_key === `service:${service}`);
      const rates = book?.offers.flatMap(({ terms }) =>
        terms.filter((term) => term.kind === "rate"),
      );
      expect(rates).toHaveLength(2);
      for (const rate of rates ?? [])
        expect(rate.variants.map(({ price }) => price.per)).toEqual([
          {
            factors: [
              {
                unit: { namespace: "provider", provider_id: "gemini", value: "search_unit" },
                power: 1,
              },
            ],
          },
        ]);
      const allowances = book?.offers.flatMap(({ terms }) =>
        terms.filter((term) => term.kind === "allowance"),
      );
      expect(allowances).toHaveLength(1);
      expect(allowances?.[0]?.variants[0]).toMatchObject({
        benefit: {
          kind: "quantity",
          quantity: {
            value: { numerator: "5000", denominator: "1" },
            unit: {
              factors: [
                {
                  unit: { namespace: "provider", provider_id: "gemini", value: "search_unit" },
                  power: 1,
                },
              ],
            },
          },
        },
        reset: { value: "monthly" },
        target: { kind: "rate_terms", term_refs: expect.any(Array) },
      });
      const target = allowances?.[0]?.variants[0]?.target;
      expect(target?.kind === "rate_terms" ? target.term_refs.length : 0).toBe(2);
    }
  });

  it("does not let an older-generation request-billing sentence change current Maps queries", async () => {
    const partition = await assemble();
    const maps = partition.books.find(({ book_key }) => book_key === "service:google-maps");
    const signals = maps?.offers.flatMap(({ terms }) =>
      terms.flatMap((term) =>
        term.kind === "rate"
          ? term.variants.map(({ charge_binding }) => charge_binding?.signal.value)
          : [],
      ),
    );
    expect(signals).toEqual(["maps_executed_queries", "maps_executed_queries"]);
  });

  it("retains conflicting native service prices instead of selecting the first row", async () => {
    const pricing = await fixture("grounding-current.html");
    const row = pricing.match(/<tr>\s*<td>Grounding with Google Search[\s\S]*?<\/tr>/)?.[0];
    if (row === undefined) throw new Error("Missing Search fixture row");
    const partition = await assemble(pricing.replace(row, `${row}\n${row.replace("$14", "$15")}`));
    const terms = partition.books
      .find(({ book_key }) => book_key === "service:google-search")
      ?.offers.flatMap(({ terms }) => terms.filter((term) => term.kind === "rate"));
    expect(terms).toHaveLength(2);
    for (const term of terms ?? []) {
      expect(term.variants).toEqual([]);
      expect(term.raw_variants).toContainEqual(
        expect.objectContaining({ reason: "conflicting_values" }),
      );
    }
  });

  it("emits canonical source allowances without model carriers or executable raw fragments", async () => {
    const result = await parse();
    expect(result.models).toEqual([]);
    expect(
      result.commercial_facts
        ?.flatMap(({ terms }) => terms ?? [])
        .filter(({ kind }) => kind === "allowance"),
    ).toHaveLength(2);
    const allowances = result.commercial_facts?.flatMap(({ terms }) => terms ?? []);
    for (const term of allowances ?? [])
      for (const variant of term.variants)
        for (const observation of variant.observations)
          observation.raw["fragment"] = "999,000 free requests per day.";
    const assembled = assembleParsed(result).books.flatMap(({ offers }) =>
      offers.flatMap(({ terms }) => terms.filter((term) => term.kind === "allowance")),
    );
    expect(assembled.map(({ variants }) => variants[0]?.benefit)).toEqual([
      expect.objectContaining({
        quantity: expect.objectContaining({ value: { numerator: "5000", denominator: "1" } }),
      }),
      expect.objectContaining({
        quantity: expect.objectContaining({ value: { numerator: "5000", denominator: "1" } }),
      }),
    ]);
  });

  it("prices two executed queries independently of the number of prompts", async () => {
    const partition = await assemble();
    for (const book of partition.books) {
      const variant = book.offers.flatMap(({ terms }) =>
        terms.flatMap((term) => (term.kind === "rate" ? term.variants : [])),
      )[0];
      if (variant?.charge_binding === undefined) throw new Error("Missing query binding");
      expect(
        evaluateRateCost(variant, [
          { signal: variant.charge_binding.signal, value: { numerator: "2", denominator: "1" } },
        ]),
      ).toMatchObject({
        kind: "resolved",
        amount: { numerator: "7", denominator: "250" },
        denomination: { kind: "fiat", currency: "USD" },
      });
    }
  });

  it.each(["unknown-sharing", "malformed-quantity"] as const)(
    "keeps a known overage price when the allowance is %s",
    async (scenario) => {
      const body = await fixture("grounding-current.html");
      const changed =
        scenario === "unknown-sharing"
          ? body.replace(
              "shared across all Gemini 3 and newer models",
              "shared across selected models",
            )
          : body.replace("5,000 free search requests", "5,,000 free search requests");
      const book = (await assemble(changed)).books.find(
        ({ book_key }) => book_key === "service:google-search",
      );
      expect(
        book?.offers.flatMap(({ terms }) => terms.filter((term) => term.kind === "allowance")),
      ).toEqual([]);
      expect(
        book?.offers.flatMap(({ terms }) => terms.filter((term) => term.kind === "raw")),
      ).toHaveLength(2);
      expect(
        book?.offers
          .flatMap(({ terms }) => terms.filter((term) => term.kind === "rate"))
          .every(({ variants }) => variants.length === 1),
      ).toBe(true);
    },
  );

  it("keeps ambiguous Search request wording raw when its owned query clarification is absent", async () => {
    const body = (await fixture("grounding-current.html")).replace(
      "You will be charged for each individual search query performed.",
      "Billing scope is not established.",
    );
    const book = (await assemble(body)).books.find(
      ({ book_key }) => book_key === "service:google-search",
    );
    expect(
      book?.offers.flatMap(({ terms }) => terms.filter((term) => term.kind === "rate")),
    ).toEqual([]);
    expect(
      book?.offers.flatMap(({ terms }) =>
        terms.filter(
          (term) =>
            term.kind === "raw" && term.variants.some(({ reason }) => reason === "unknown_unit"),
        ),
      ),
    ).toHaveLength(2);
  });

  it("keeps generic observed tool counters separate from billed query quantities", async () => {
    const result = await parse();
    expect(
      result.pricing_inputs?.some(({ key }) => key === "interaction.grounding.google_maps"),
    ).toBe(true);
    const partition = await assemble();
    for (const book of partition.books)
      for (const offer of book.offers)
        for (const term of offer.terms)
          if (term.kind === "rate")
            for (const variant of term.variants)
              expect(variant.charge_binding?.quantity_methods).toBeUndefined();
  });

  it.each(["missing", "outside-section", "legacy-only", "conflicting", "malformed"] as const)(
    "preserves Maps rate units when its allowance companion is unresolved: %s",
    async (scenario) => {
      let guide = await fixture("maps-grounding-current.html");
      switch (scenario) {
        case "missing":
          guide = "<main>Guide unavailable</main>";
          break;
        case "outside-section":
          guide = guide.replace("Pricing and rate limits", "Examples");
          break;
        case "legacy-only":
          guide = await fixture("maps-grounding.html");
          break;
        case "conflicting": {
          const rule = guide.match(/<li>\s*Gemini 3 and newer[\s\S]*?<\/li>/)?.[0];
          if (rule === undefined) throw new Error("Missing Maps policy fixture");
          guide = guide.replace(rule, `${rule}\n${rule.replace("5,000", "6,000")}`);
          break;
        }
        case "malformed":
          guide = guide.replace("5,000", "5,,000");
          break;
      }
      const partition = await assemble(undefined, guide);
      const book = partition.books.find(({ book_key }) => book_key === "service:google-maps");
      expect(book?.offers.some(({ terms }) => terms.some(({ kind }) => kind === "allowance"))).toBe(
        false,
      );
      expect(
        book?.offers.flatMap(({ terms }) => terms.filter((term) => term.kind === "raw")),
      ).toHaveLength(2);
      for (const offer of book?.offers ?? [])
        for (const term of offer.terms)
          if (term.kind === "rate")
            expect(term.variants[0]?.charge_binding?.signal.value).toBe("maps_executed_queries");
    },
  );
});
