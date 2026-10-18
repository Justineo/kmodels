import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { manifests, type ProviderManifest } from "../src/catalog/manifests.ts";
import { baseModel } from "../src/catalog/model.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import { capturePricingReplaySources } from "../src/catalog/pricing-compilation.ts";
import { validatePricingCatalog } from "../src/catalog/pricing-validation.ts";
import type { SourceParseResult } from "../src/catalog/source-parse.ts";

const observedAt = "2026-10-19T00:00:00.000Z";
function configuration() {
  const value: ProviderManifest | undefined = manifests.find(
    ({ provider }) => provider.id === "vertex",
  );
  const source = value?.sources.find(({ id }) => id === "vertex-pricing");
  if (value === undefined || source === undefined) throw new Error("Missing Vertex manifest");
  return { value, source };
}
const { value, source } = configuration();
const provider = { ...value.provider, source_ids: value.sources.map(({ id }) => id) };
const sourceRecord = {
  id: source.id,
  provider_id: provider.id,
  url: source.url,
  source: source.source ?? [source.type],
  stability: source.stability,
  scope: source.scope ?? "global",
  exhaustive: source.exhaustive ?? false,
  role: source.role ?? "catalog",
  field_paths: source.fields,
  ...(source.pricingEvidence === undefined ? {} : { pricing_evidence: source.pricingEvidence }),
  observed_at: observedAt,
  content_hash: "1".repeat(64),
  extractor_version: source.extractorVersion,
};
const names = [
  ["gemini-4-argon", "Gemini 4 Argon"],
  ["gemini-3-test", "Gemini 3 Test"],
  ["gemini-3-other", "Gemini 3 Other"],
  ["gemini-2.5-flash", "Gemini 2.5 Flash"],
  ["gemini-2.5-flash-lite", "Gemini 2.5 Flash-Lite"],
  ["gemini-live-2.5-flash-native-audio", "Gemini 2.5 Flash with Gemini Live API native audio"],
  ["gemini-2.5-pro", "Gemini 2.5 Pro"],
  ["gemini-2.0-flash", "Gemini 2.0 Flash"],
];
const catalogModels = names.map(([id, name]) => {
  if (id === undefined || name === undefined) throw new Error("Missing model identity");
  return {
    ...baseModel({ providerId: provider.id, id, name, sourceId: source.id, observedAt }),
    service_families: ["publishers/google"],
  };
});
const fixture = () =>
  readFile(new URL("./fixtures/vertex/grounding-allowances.html", import.meta.url), "utf8");

function parse(pricing: string) {
  const supported = `<main><h2>Supported models</h2><ul>${names.map(([, label]) => `<li>${label}</li>`).join("")}</ul></main>`;
  return parseSource({
    provider,
    source,
    observedAt,
    catalogModels,
    body: JSON.stringify({
      index: { url: source.url, body: pricing },
      documents: ["google-search", "google-maps", "vertex-ai-search"].map((service) => ({
        url: `https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/grounding/grounding-with-${service}`,
        body: supported,
      })),
    }),
  });
}

function assemble(parsed: SourceParseResult) {
  const partition = assembleParsedProviderPricing(
    provider.id,
    observedAt,
    [{ source, ...parsed }],
    catalogModels,
    value.pricingCategoricalLabels,
  );
  if (partition === undefined) throw new Error("Missing Vertex pricing");
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
      sources: [sourceRecord],
    },
  );
  return partition;
}

function allowances(partition: ReturnType<typeof assemble>) {
  return partition.books.flatMap(({ offers }) =>
    offers.flatMap(({ terms }) => terms.filter((term) => term.kind === "allowance")),
  );
}

describe("Vertex native grounding contracts", () => {
  it("captures and replays independent service terms without catalog carrier models", async () => {
    const parsed = parse(await fixture());
    const captured = capturePricingReplaySources([{ source, ...parsed }], [sourceRecord])?.[0];
    if (captured === undefined) throw new Error("Missing captured Vertex input");
    expect(captured.models).toEqual([]);
    expect(assemble({ ...captured, models: [] })).toEqual(assemble(parsed));
  });

  it("publishes independent services and exact shared daily/monthly targets", async () => {
    const parsed = parse(await fixture());
    expect(parsed.models).toEqual([]);
    expect(parsed.commercial_facts?.length).toBeGreaterThan(0);
    const partition = assemble(parsed);
    expect(allowances(partition)).toHaveLength(5);
    const flash = partition.books
      .flatMap(({ offers }) => offers)
      .find(({ offer_key }) => offer_key === "allowance:google-search-flash-daily");
    expect(flash?.model_refs).toEqual([
      "vertex/gemini-2.0-flash",
      "vertex/gemini-2.5-flash",
      "vertex/gemini-2.5-flash-lite",
    ]);
    const monthly = allowances(partition).find(({ variants }) =>
      variants.some(
        ({ reset }) =>
          reset.value === "monthly" &&
          variants[0]?.target.kind === "rate_terms" &&
          variants[0].target.term_refs.length === 4,
      ),
    );
    expect(monthly?.variants[0]?.benefit).toMatchObject({
      quantity: { value: { numerator: "5000", denominator: "1" } },
    });
  });

  it("shares the current named Gemini 3 and Gemini 4 pool across both family sections", async () => {
    const original = await fixture();
    const section = original.match(/<h3>Gemini 3<\/h3>[\s\S]*?(?=<h3>Gemini 2\.5)/)?.[0];
    if (section === undefined) throw new Error("Missing monthly section");
    const current = section.replaceAll(
      /all Gemini 3\s+models/g,
      "all Gemini 3 and Gemini 4 models",
    );
    const partition = assemble(
      parse(
        original.replace(
          section,
          current + current.replace("<h3>Gemini 3</h3>", "<h3>Gemini 4</h3>"),
        ),
      ),
    );
    const monthly = allowances(partition).filter(({ variants }) =>
      variants.some(({ reset }) => reset.value === "monthly"),
    );
    expect(monthly).toHaveLength(2);
    expect(
      monthly
        .map(({ variants }) =>
          variants[0]?.target.kind === "rate_terms" ? variants[0].target.term_refs.length : 0,
        )
        .sort((left, right) => left - right),
    ).toEqual([3, 6]);
  });

  it("cannot change a recognized quota by editing passive raw evidence", async () => {
    const parsed = parse(await fixture());
    for (const fact of parsed.commercial_facts ?? []) {
      for (const raw of fact.raw_price_facts)
        raw.raw.fragment = "Includes 999,999 queries per month";
      for (const term of fact.terms ?? [])
        for (const variant of term.variants)
          for (const observation of variant.observations)
            observation.raw.fragment = "Includes 999,999 queries per month";
    }
    expect(allowances(assemble(parsed)).map(({ variants }) => variants[0]?.benefit)).toEqual(
      allowances(assemble(parse(await fixture()))).map(({ variants }) => variants[0]?.benefit),
    );
  });

  it.each(["5,00", "5,,000"])("withholds malformed grouped quantities: %s", async (quantity) => {
    const partition = assemble(parse((await fixture()).replaceAll("5,000", quantity)));
    expect(
      allowances(partition).filter(({ variants }) =>
        variants.some(({ reset }) => reset.value === "monthly"),
      ),
    ).toEqual([]);
    expect(
      partition.books
        .flatMap(({ offers }) =>
          offers.flatMap(({ terms }) =>
            terms.flatMap((term) => (term.kind === "raw" ? term.variants : [])),
          ),
        )
        .some(({ impact }) => impact === "allowance"),
    ).toBe(true);
  });

  it("withholds the entire shared web quota when peer cells disagree", async () => {
    const body = await fixture();
    const section = body.match(/<h3>Gemini 3<\/h3>[\s\S]*?(?=<h3>Gemini 2\.5)/)?.[0];
    if (section === undefined) throw new Error("Missing monthly section");
    const partition = assemble(
      parse(
        body.replace(
          section,
          section + section.replace("Includes 5,000 Grounding", "Includes 7,000 Grounding"),
        ),
      ),
    );
    expect(
      allowances(partition).filter(({ variants }) =>
        variants.some(({ reset }) => reset.value === "monthly"),
      ),
    ).toHaveLength(1);
  });

  it("retains unequal prices and localizes their conflict instead of choosing the first row", async () => {
    const body = await fixture();
    const row = body.match(
      /<tr>\s*<td>Grounding with Google Search &amp; Web Grounding[\s\S]*?<\/tr>/,
    )?.[0];
    if (row === undefined) throw new Error("Missing web grounding row");
    const parsed = parse(body.replace(row, row + row.replace("$14", "$17")));
    const sourceRates = parsed.commercial_facts?.find(
      ({ resource_key, offer_key }) =>
        resource_key === "google-search" && offer_key === "request:vertex/gemini-3-test",
    )?.price_facts;
    expect(sourceRates?.map(({ price }) => price)).toEqual(["14", "17"]);
    const partition = assemble(parsed);
    const rates = partition.books
      .find(({ book_key }) => book_key === "service:google-search")
      ?.offers.flatMap(({ terms }) => terms.filter((term) => term.kind === "rate"));
    const monthly = rates?.filter(
      ({ variants, raw_variants }) =>
        variants.length === 0 && raw_variants.some(({ reason }) => reason === "conflicting_values"),
    );
    expect(monthly).toHaveLength(2);
    expect(rates?.some(({ variants }) => variants.length > 0)).toBe(true);
  });

  it("does not inherit the previous family through an unknown Gemini section", async () => {
    const body = await fixture();
    const section = body.match(/<h3>Gemini 3<\/h3>[\s\S]*?(?=<h3>Gemini 2\.5)/)?.[0];
    if (section === undefined) throw new Error("Missing monthly section");
    const partition = assemble(
      parse(
        body.replace(
          section,
          section +
            section.replace("<h3>Gemini 3</h3>", "<h3>Gemini 5</h3>").replaceAll("$14", "$17"),
        ),
      ),
    );
    expect(
      partition.books.flatMap(({ offers }) =>
        offers.flatMap(({ terms }) =>
          terms.flatMap((term) => (term.kind === "rate" ? term.raw_variants : [])),
        ),
      ),
    ).toEqual([]);
  });

  it("keeps an ambiguous grounding denominator as local service raw evidence", async () => {
    const parsed = parse(
      (await fixture()).replaceAll("$14 per 1,000 queries", "$14 per 1,000 count"),
    );
    expect(parsed.models).toEqual([]);
    const partition = assemble(parsed);
    const maps = partition.books.find(({ book_key }) => book_key === "service:google-maps");
    const affected = maps?.offers.filter(({ offer_key }) => offer_key.includes("gemini-3-"));
    expect(affected).toHaveLength(2);
    for (const offer of affected ?? []) {
      expect(offer.terms.some((term) => term.kind === "rate" && term.variants.length > 0)).toBe(
        false,
      );
      expect(
        offer.terms.flatMap((term) => (term.kind === "raw" ? term.variants : [])),
      ).toContainEqual(expect.objectContaining({ impact: "base_price", reason: "unknown_unit" }));
    }
    expect(
      maps?.offers.some(({ terms }) =>
        terms.some((term) => term.kind === "allowance" && term.variants.length > 0),
      ),
    ).toBe(true);
  });

  it("takes the explicit grounded-prompt denominator over a family-name guess", async () => {
    const partition = assemble(
      parse((await fixture()).replaceAll("per 1,000 queries", "per 1,000 grounded prompts")),
    );
    const maps = partition.books.find(({ book_key }) => book_key === "service:google-maps");
    const rates = maps?.offers
      .filter(({ offer_key }) => offer_key.includes("gemini-3-"))
      .flatMap(({ terms }) => terms.filter((term) => term.kind === "rate"));
    expect(rates?.flatMap(({ variants }) => variants.map(({ price }) => price.per))).toEqual([
      { factors: [{ unit: { namespace: "kmodels", value: "request" }, power: 1 }] },
      { factors: [{ unit: { namespace: "kmodels", value: "request" }, power: 1 }] },
    ]);
    expect(
      maps?.offers.some(({ terms }) =>
        terms.some(
          (term) =>
            term.kind === "allowance" &&
            term.variants.some(({ reset }) => reset.value === "monthly"),
        ),
      ),
    ).toBe(false);
  });
});
