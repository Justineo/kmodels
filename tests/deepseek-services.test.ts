import { readFile } from "node:fs/promises";
import { load } from "cheerio";
import { describe, expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { manifests, type SourceManifest } from "../src/catalog/manifests.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import { createPricingCatalogEnvelope } from "../src/catalog/pricing-envelope.ts";
import { calculationExport } from "../src/catalog/pricing-calculator-export.ts";
import { catalogSchema } from "../src/catalog/schema.ts";
import { createCalculator } from "../src/pricing/index.ts";
import { capturePricingReplaySources } from "../src/catalog/pricing-compilation.ts";
import { websitePublication } from "../src/catalog/website-data.ts";
import { projectWebsitePricingTimeline } from "../src/catalog/website-pricing-query.ts";
import type { PricingReconciliationItem } from "../src/catalog/pricing-reconciliation.ts";
import type { SourceContractEvidence } from "../src/catalog/source-contract.ts";

const fixture = (name: string) =>
  readFile(new URL(`./fixtures/deepseek/${name}.html`, import.meta.url), "utf8");
function configuration() {
  const manifest = manifests.find((value) => value.provider.id === "deepseek");
  const source: SourceManifest | undefined = manifest?.sources.find(
    (value) => value.id === "deepseek-catalog",
  );
  if (manifest === undefined || source === undefined) throw new Error("Missing DeepSeek source");
  return {
    source,
    provider: { ...manifest.provider, source_ids: manifest.sources.map((value) => value.id) },
  };
}
const { source, provider } = configuration();
const observedAt = "2026-10-19T13:17:34.240Z";
const transition = "2026-10-31T16:00:00.000Z";
async function nativeBundle() {
  return {
    index: { url: source.url, body: await fixture("services-catalog") },
    documents: [
      {
        url: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/",
        body: await fixture("services-cny"),
      },
      {
        url: "https://api-docs.deepseek.com/guides/search/",
        body: await fixture("search-billing"),
      },
      {
        url: "https://api-docs.deepseek.com/api/list-models",
        body: await fixture("list-models-metadata"),
      },
    ],
  };
}
async function parsed(change?: (bundle: Awaited<ReturnType<typeof nativeBundle>>) => void) {
  const bundle = await nativeBundle();
  change?.(bundle);
  const diagnostics: PricingReconciliationItem[] = [],
    findings: SourceContractEvidence[] = [],
    failures: string[] = [];
  const result = parseSource({
    provider,
    source,
    observedAt,
    body: JSON.stringify(bundle),
    onContractFinding: (item) => findings.push(item),
    onPricingReconciliation: (item) => diagnostics.push(item),
    onPricingDependencyFailure: (url) => failures.push(url),
  });
  return { result, diagnostics, findings, failures };
}
async function compiled() {
  const { result, failures } = await parsed();
  expect(failures).toEqual([]);
  const partition = assembleParsedProviderPricing(
    "deepseek",
    observedAt,
    [{ source, ...result }],
    result.models,
  );
  if (partition === undefined) throw new Error("Missing DeepSeek partition");
  const core = catalogSchema.parse(
    JSON.parse(
      JSON.stringify({
        catalog_version: "a".repeat(64),
        generated_at: observedAt,
        providers: [provider],
        models: result.models,
        coverage: [],
        warnings: [],
        sources: [
          {
            id: source.id,
            provider_id: "deepseek",
            url: source.url,
            source: [source.type],
            stability: source.stability,
            scope: "global",
            exhaustive: true,
            role: "catalog",
            field_paths: source.fields,
            pricing_evidence: source.pricingEvidence,
            observed_at: observedAt,
            content_hash: "1".repeat(64),
            extractor_version: source.extractorVersion,
          },
        ],
      }),
    ),
  );
  const pricing = {
    books: partition.books,
    provider_snapshots: [partition.snapshot],
    provider_vocabularies: [partition.vocabulary],
    model_dispositions: partition.model_dispositions,
  };
  const exported = calculationExport(core, createPricingCatalogEnvelope(pricing, core));
  const calculator = createCalculator(exported);
  function calculate(
    api: "search" | "fetch",
    offerKey: string,
    currency: string,
    at: string,
    quantity?: string,
  ) {
    const book = exported.providers[0]?.books.find(
      (book) => book.scope.kind === "provider_resource" && book.scope.resource_key === `web-${api}`,
    );
    const offer = book?.offers.find((offer) => offer.offer_key === offerKey);
    const term = offer?.terms.find((term) => term.kind === "rate");
    const signal = term?.variants[0]?.charge_binding?.signal;
    if (offer === undefined || signal === undefined) throw new Error("Missing service offer");
    return calculator.calculate({
      evaluatedAt: at,
      components: [
        {
          id: api,
          offerRef: offer.id,
          quantities:
            quantity === undefined
              ? []
              : [{ signal, value: { numerator: quantity, denominator: "1" } }],
          selectors: [
            {
              kind: "categorical",
              dimension: { namespace: "kmodels", value: "billing_currency" },
              value: { namespace: "provider", provider_id: "deepseek", value: currency },
            },
          ],
        },
      ],
    });
  }
  return { partition, calculate, core, pricing };
}

describe("DeepSeek native Search and Fetch charges", () => {
  it("keeps standalone services independent of model compatibility and generation quantities", async () => {
    const { result, failures } = await parsed();
    expect(failures).toEqual([]);
    expect(result.commercial_facts).toHaveLength(4);
    expect(result.commercial_facts?.every((fact) => fact.model_refs.length === 0)).toBe(true);
    const detached = assembleParsedProviderPricing(
      "deepseek",
      observedAt,
      [{ source, ...result, models: [] }],
      [],
    );
    expect(detached?.books.map((book) => book.book_key).sort()).toEqual([
      "service:web-fetch",
      "service:web-search",
    ]);
    expect(
      detached?.books.every((book) =>
        book.offers.every((offer) =>
          offer.terms.every(
            (term) =>
              term.kind !== "rate" ||
              term.variants.every(
                (variant) => variant.charge_binding?.quantity_methods === undefined,
              ),
          ),
        ),
      ),
    ).toBe(true);
    const { core } = await compiled();
    const captured = capturePricingReplaySources(
      [{ source, ...result, models: [] }],
      core.sources,
    )?.[0];
    if (captured === undefined) throw new Error("Missing independent service capture");
    expect(captured.models).toEqual([]);
    expect(captured.commercial_facts).toEqual(result.commercial_facts);
    expect(
      assembleParsedProviderPricing("deepseek", observedAt, [{ source, ...captured }], []),
    ).toEqual(detached);
  });

  it("presents standalone services and their next change through the shared website timeline", async () => {
    const { core, pricing } = await compiled();
    const website = websitePublication(core, pricing, "b".repeat(64));
    expect(website.catalog.providers[0]?.pricing_coverage.standalone_resources).toBe(2);
    const resources = website.providerPricing.flatMap((chunk) => chunk.resources);
    expect(resources.map((resource) => resource.title).sort()).toEqual(["Web Fetch", "Web Search"]);
    for (const resource of resources) {
      expect(resource.offers).toHaveLength(2);
      const server = resource.offers.find((offer) => offer.title.includes("server tools"));
      if (server === undefined) throw new Error("Missing scoped server-tool presentation");
      const ref = server.offer_refs[0];
      const detail =
        ref === undefined
          ? undefined
          : website.offers.find(
              (chunk) => chunk.provider_id === "deepseek" && chunk.chunk === ref[0],
            )?.offers[ref[1]];
      if (detail === undefined) throw new Error("Missing deferred service offer");
      const timeline = projectWebsitePricingTimeline(detail, observedAt);
      expect(timeline.current.rates).toHaveLength(2);
      expect(timeline.next_change_at).toBe(transition);
      expect(timeline.upcoming?.effective_at).toBe(transition);
      expect(timeline.upcoming?.offer.rates).toHaveLength(2);
    }
  });

  it("uses the price pages for amounts while keeping guide quotes explicitly excluded", async () => {
    const { result, diagnostics, failures } = await parsed((bundle) => {
      const guide = bundle.documents.find((doc) => doc.url.includes("/guides/search/"));
      if (guide === undefined) throw new Error("Missing guide");
      guide.body = guide.body.replaceAll("$0.75", "$99.00");
    });
    expect(failures).toEqual([]);
    expect(
      result.commercial_facts?.every((fact) =>
        fact.price_facts
          .filter((rate) => rate.currency === "USD")
          .every((rate) => rate.price === "0" || rate.price === "0.75"),
      ),
    ).toBe(true);
    expect(
      diagnostics.filter((item) => item.reason_code === "service_amount_authority_price_page"),
    ).toHaveLength(2);
  });

  it.each(["search", "fetch"] as const)(
    "calculates %s per successful request across currency and the exact server-tool boundary",
    async (api) => {
      const { calculate } = await compiled();
      for (const [currency, numerator, denominator] of [
        ["USD", "3", "2000"],
        ["CNY", "1", "100"],
      ]) {
        if (currency === undefined || numerator === undefined || denominator === undefined)
          throw new Error("Invalid native quote case");
        for (const [offer, at, expected] of [
          ["standalone", observedAt, numerator],
          ["server_tools", "2026-10-31T15:59:59.999Z", "0"],
          ["server_tools", transition, numerator],
        ]) {
          if (offer === undefined || at === undefined || expected === undefined)
            throw new Error("Invalid native schedule case");
          const result = calculate(api, offer, currency, at, "2");
          expect(result.status).toBe("calculated");
          expect(result.totals).toEqual([
            {
              denomination: { kind: "fiat", currency },
              amount: { numerator: expected, denominator: expected === "0" ? "1" : denominator },
            },
          ]);
        }
        const unknown = calculate(api, "server_tools", currency, transition);
        expect(unknown.status).toBe("unknown");
        expect(unknown.totals).toBeUndefined();
        expect(
          calculate(api, "standalone", currency, observedAt, "0").totals?.[0]?.amount.numerator,
        ).toBe("0");
      }
    },
  );

  it.each(["time", "predicate", "quoted"])(
    "withholds unproved %s billing scope and signals the pricing dependency",
    async (failure) => {
      const { result, failures } = await parsed((bundle) => {
        const doc = bundle.documents.find((doc) =>
          doc.url.includes(failure === "time" ? "/zh-cn/" : "/guides/search/"),
        );
        if (doc === undefined) throw new Error("Missing native companion");
        if (failure === "time")
          doc.body = doc.body.replace("11 月 1 日", "11 月 2 日").replace("11月1日", "11月2日");
        else if (failure === "predicate") doc.body = doc.body.replace("non-empty", "empty");
        else doc.body = "<blockquote>" + doc.body + "</blockquote>";
      });
      expect(result.models).toHaveLength(4);
      expect(result.models.every((model) => model.price_facts.length === 12)).toBe(true);
      expect(result.commercial_facts ?? []).toEqual([]);
      expect(failures.length).toBeGreaterThan(0);
      if (failure === "time")
        expect(failures).toEqual(["https://api-docs.deepseek.com/zh-cn/quick_start/pricing/"]);
    },
  );

  it("preserves an unreadable native amount locally without replacing it with zero", async () => {
    const { result, diagnostics, failures } = await parsed((bundle) => {
      const doc = bundle.documents.find((doc) => doc.url.includes("/zh-cn/"));
      if (doc === undefined) throw new Error("Missing CNY source");
      const $ = load(doc.body);
      $("table").last().find("tr").last().children().last().text("pending");
      doc.body = $.html();
    });
    expect(failures).toEqual([]);
    const direct = result.commercial_facts?.find(
      (fact) => fact.resource_key === "web-fetch" && fact.offer_key === "standalone",
    );
    expect(direct?.raw_price_facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "unknown_amount",
          raw: expect.objectContaining({ amount: "pending" }),
        }),
      ]),
    );
    expect(
      direct?.price_facts.some((rate) => rate.currency === "USD" && rate.price === "0.75"),
    ).toBe(true);
    expect(direct?.price_facts.some((rate) => rate.currency === "CNY")).toBe(false);
    expect(diagnostics.some((item) => item.disposition === "raw")).toBe(true);
  });
});

describe("DeepSeek owned exact model limits", () => {
  it("does not select a last value from duplicate example properties", async () => {
    const { result, findings } = await parsed((bundle) => {
      const doc = bundle.documents.find((doc) => doc.url.includes("/api/list-models"));
      if (doc === undefined) throw new Error("Missing model reference");
      const $ = load(doc.body);
      $(".openapi-code__response-samples-container code").each((_, node) => {
        $(node).text(
          $(node)
            .text()
            .replace(/"context_window":\s*1048576/g, '"context_window":1,"context_window":1048576'),
        );
      });
      doc.body = $.html();
    });
    expect(result.models).toHaveLength(4);
    for (const model of result.models)
      expect(model.limits).toMatchObject({ context_tokens: 1000000, max_output_tokens: 384000 });
    expect(
      findings.some((item) =>
        item.diagnostics.some((diagnostic) =>
          diagnostic.path.includes("model_inventory_contract_drift"),
        ),
      ),
    ).toBe(true);
  });
  it("refines rounded table labels using the typed integer token fields, including explicit legacy targets", async () => {
    const { result } = await parsed();
    expect(result.models).toHaveLength(4);
    for (const model of result.models)
      expect(model.limits).toMatchObject({ context_tokens: 1048576, max_output_tokens: 393216 });
    expect(result.models.find((model) => model.model_id === "deepseek-flash")?.name).toBe(
      "DeepSeek-V4.1-Flash-1017",
    );
  });

  it.each(["type", "value", "nested"])(
    "withholds a %s context claim independently of the output limit",
    async (drift) => {
      const { result } = await parsed((bundle) => {
        const doc = bundle.documents.find((doc) => doc.url.includes("/api/list-models"));
        if (doc === undefined) throw new Error("Missing model reference");
        const $ = load(doc.body);
        const field = $("strong.openapi-schema__property")
          .filter((_, node) => $(node).text() === "context_window")
          .closest(".openapi-schema__list-item");
        if (drift === "type") field.find(".openapi-schema__name").first().text("string");
        else if (drift === "nested")
          field.wrap(
            '<div class="openapi-schema__list-item"><strong class="openapi-schema__property">metadata</strong><span class="openapi-schema__name">object</span></div>',
          );
        else
          $(".openapi-code__response-samples-container code").each((_, node) => {
            $(node).text($(node).text().replaceAll("1048576", "-1"));
          });
        doc.body = $.html();
      });
      for (const model of result.models)
        expect(model.limits).toMatchObject({ context_tokens: 1000000, max_output_tokens: 393216 });
    },
  );
});
