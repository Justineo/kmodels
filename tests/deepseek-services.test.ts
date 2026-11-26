import { readFile } from "node:fs/promises";
import { load } from "cheerio";
import type { PricingSelection } from "../src/catalog/pricing-applicability.ts";
import { describe, expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { manifests, type SourceManifest } from "../src/catalog/manifests.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import { catalogSchema } from "../src/catalog/schema.ts";
import { capturePricingReplaySources } from "../src/catalog/pricing-compilation.ts";
import { websitePublication } from "../src/catalog/website-data.ts";
import { projectWebsitePricingTimeline } from "../src/catalog/website-pricing-query.ts";
import PricingOfferBreakdown from "../src/components/PricingOfferBreakdown.vue";
import PricingServiceOffer from "../src/components/PricingServiceOffer.vue";
import { renderComponent } from "./render-component.ts";
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
  return { partition, core, pricing };
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
  it("publishes the dated server-side exemption and keeps direct client searches billed", async () => {
    const { result, diagnostics, failures } = await parsed();
    expect(failures).toEqual([]);
    expect(result.commercial_facts).toHaveLength(4);
    expect(
      diagnostics.find((item) => item.reason_code === "service_server_tool_rule_verified")?.sample,
    ).toBe(
      "Searches performed by the model through server-side tools are not billed (text search, image search and page fetch). Only model token usage is billed. From 2026-11-18T04:00:00.000Z",
    );
    const serverOffers = (result.commercial_facts ?? []).filter(
      (fact) => fact.offer_key === "server_tools",
    );
    expect(serverOffers).toHaveLength(2);
    expect(serverOffers.every((fact) => fact.price_facts.length === 0)).toBe(true);
    expect(
      serverOffers.every(
        (fact) =>
          fact.state_facts?.length === 1 &&
          fact.state_facts[0]?.state === "free" &&
          fact.state_facts[0]?.conditions.effective_from === "2026-11-18T04:00:00.000Z" &&
          fact.state_facts[0]?.raw.fragment?.includes("no longer billed") === true,
      ),
    ).toBe(true);
    const standalone = (result.commercial_facts ?? []).filter(
      (fact) => fact.offer_key === "standalone",
    );
    expect(
      standalone.every(
        (fact) =>
          fact.price_facts.length === 2 &&
          fact.price_facts.every((rate) => rate.conditions.effective_until === undefined),
      ),
    ).toBe(true);
  });
  it("rejects a different client scope instead of guessing the server-tool tariff", async () => {
    const { result, diagnostics, failures } = await parsed((bundle) => {
      const doc = bundle.documents.find(({ url }) => url.includes("/guides/search/"));
      if (doc === undefined) throw new Error("Missing search guide");
      doc.body = doc.body.replace(
        "call the Search and Fetch APIs directly from the client",
        "call the Search and Fetch APIs directly from a server",
      );
    });
    expect(failures).toEqual(["https://api-docs.deepseek.com/guides/search/"]);
    expect(result.commercial_facts ?? []).toEqual([]);
    expect(
      diagnostics.some(
        (item) =>
          item.disposition === "unresolved" &&
          item.reason_code === "commercial_source_contract_drift",
      ),
    ).toBe(true);
  });
  it("presents the metered request tariff and the dated server-side exemption through the shared website timeline", async () => {
    const { core, pricing } = await compiled();
    const website = websitePublication(core, pricing, "b".repeat(64));
    expect(website.catalog.providers[0]?.pricing_coverage.standalone_resources).toBe(2);
    const resources = website.providerPricing.flatMap((chunk) => chunk.resources);
    expect(resources.map((resource) => resource.title).sort()).toEqual(["Web Fetch", "Web Search"]);
    for (const resource of resources) {
      expect(resource.offers).toHaveLength(1);
      const server = resource.offers[0];
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
      expect(timeline.current.states.map((state) => state.state)).not.toContain("free");
      expect(timeline.next_change_at).toBe("2026-11-18T04:00:00.000Z");
      expect(timeline.upcoming?.effective_at).toBe("2026-11-18T04:00:00.000Z");
      expect(timeline.upcoming?.offer.rates).toHaveLength(2);
      expect(timeline.upcoming?.offer.states.map((state) => state.state)).toEqual(["free"]);
      const granted = projectWebsitePricingTimeline(detail, "2026-11-18T04:00:00.000Z");
      expect(granted.current.rates).toHaveLength(2);
      expect(granted.current.states.map((state) => state.state)).toEqual(["free"]);
      expect(granted.next_change_at).toBeUndefined();
      expect(granted.upcoming).toBeUndefined();
      const html = await renderComponent(PricingServiceOffer, {
        offer: granted.current,
        resourceTitle: resource.title,
      });
      expect(html).toContain("Model tool call");
      expect(html).toContain("Successful direct API call");
      expect(html).toContain("Billing currency");
      expect(html).not.toMatch(/Public rates|No rates match|class="exact-rate"/);
      const operation = granted.current.selectors.find((s) => s.dimension.value === "operation");
      const currency = granted.current.selectors.find(
        (s) => s.dimension.value === "billing_currency",
      );
      if (operation?.kind !== "categorical" || currency?.kind !== "categorical")
        throw new Error("Missing service conditions");
      for (const { value } of operation.values) {
        const call = { kind: "categorical", dimension: operation.dimension, value } as const;
        const view = async (boundSelectors: readonly PricingSelection[]) =>
          load(
            await renderComponent(PricingOfferBreakdown, {
              offer: granted.current,
              service: true,
              boundSelectors,
            }),
          );
        const partial = await view([call]);
        if (value.value === "server_tools") {
          expect(partial(".state-label").text()).toBe("Free");
          expect(partial("fieldset")).toHaveLength(0);
          expect(partial(".exact-rate")).toHaveLength(0);
        } else {
          expect(partial("fieldset").text()).toContain("Billing currency");
          expect(partial(".exact-rate")).toHaveLength(0);
          for (const quote of currency.values) {
            const result = await view([
              call,
              { kind: "categorical", dimension: currency.dimension, value: quote.value },
            ]);
            expect(result(".exact-rate").text()).toBe(quote.label === "USD" ? "$0.75" : "CNY 5");
            expect(result(".charge-driver-facts")).toHaveLength(0);
          }
        }
      }
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
          .every((rate) => rate.price === "0.75"),
      ),
    ).toBe(true);
    expect(
      diagnostics.filter((item) => item.reason_code === "service_amount_authority_price_page"),
    ).toHaveLength(2);
  });
  it.each(["policy", "predicate", "quoted"])(
    "withholds unproved %s billing scope and signals the pricing dependency",
    async (failure) => {
      const { result, failures } = await parsed((bundle) => {
        const doc = bundle.documents.find((doc) => doc.url.includes("/guides/search/"));
        if (doc === undefined) throw new Error("Missing native companion");
        if (failure === "policy")
          doc.body = doc.body.replace(
            "server-side tools are not billed",
            "server-side tools are currently free of charge",
          );
        else if (failure === "predicate") doc.body = doc.body.replace("non-empty", "empty");
        else doc.body = "<blockquote>" + doc.body + "</blockquote>";
      });
      expect(result.models).toHaveLength(4);
      expect(result.models.every((model) => model.price_facts.length === 12)).toBe(true);
      expect(result.commercial_facts ?? []).toEqual([]);
      expect(failures).toEqual(["https://api-docs.deepseek.com/guides/search/"]);
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
  it.each(["heading", "header", "row"] as const)(
    "rejects the retired %s instead of reusing the previous price contract",
    async (drift) => {
      const { result, failures } = await parsed((bundle) => {
        const $ = load(bundle.index.body);
        const owned = $("h2")
          .filter((_, node) => $(node).text().includes("Search & Fetch API Pricing"))
          .first();
        const table = owned.nextAll("table").first();
        if (drift === "heading") owned.text("Web Search & Fetch Pricing");
        else if (drift === "header") table.find("th").first().text("API");
        else
          table
            .find("td")
            .filter((_, node) => $(node).text() === "Search API (text)")
            .first()
            .text("Search (text, image)");
        bundle.index.body = $.html();
      });
      expect(failures).toEqual([source.url]);
      expect(result.models).toHaveLength(4);
      expect(result.commercial_facts ?? []).toEqual([]);
    },
  );
  it("keeps standalone tariffs and attributes the revised token-billing notice to server tools", async () => {
    const { result, failures } = await parsed((bundle) => {
      bundle.index.body = bundle.index.body.replace(
        /server-side search and web\s+fetch triggered when calling the model are no longer billed; only model token usage is\s+billed\./,
        "the server-side search and web fetch tool calls triggered when calling the model are no longer billed; the results they return are appended to the model context and billed as model token usage.",
      );
      const cny = bundle.documents.find((doc) => doc.url.includes("/zh-cn/"));
      if (!cny) throw new Error("Missing CNY source");
      cny.body = cny.body.replace(
        /服务端搜索、网页抓取不再计费，仅按模型 Token\s+用量计费。/,
        "服务端搜索、网页抓取，其工具调用本身不再计费；工具返回的结果会拼接到模型上下文中参与推理，按模型 Token 用量计费。",
      );
    });
    expect(failures).toEqual([]);
    const facts = result.commercial_facts ?? [];
    expect(
      facts
        .filter((fact) => fact.offer_key === "standalone")
        .map((fact) => fact.price_facts.length),
    ).toEqual([2, 2]);
    expect(
      facts
        .flatMap((fact) => fact.state_facts ?? [])
        .filter((state) => state.raw.fragment?.includes("appended to the model context")),
    ).toHaveLength(2);
  });
  it("rejects a currency page that publishes a different exemption instant", async () => {
    const { result, diagnostics, failures } = await parsed((bundle) => {
      const doc = bundle.documents.find((doc) => doc.url.includes("/zh-cn/"));
      if (doc === undefined) throw new Error("Missing CNY source");
      doc.body = doc.body.replace(/11 月\s*18 日/, "11 月 25 日");
    });
    expect(failures).toEqual(["https://api-docs.deepseek.com/zh-cn/quick_start/pricing/"]);
    expect(result.commercial_facts ?? []).toEqual([]);
    expect(
      diagnostics.some(
        (item) =>
          item.disposition === "unresolved" &&
          item.reason_code === "commercial_source_contract_drift",
      ),
    ).toBe(true);
  });
  it.each([
    ["same paragraph", "An additional fee of USD 1 per server-side search call applies."],
    [
      "adjacent paragraph",
      "</p><p>An additional fee of USD 1 per server-side search call applies.",
    ],
  ])("withholds the exemption when a %s contradicts the notice", async (_, contradiction) => {
    const { result, failures } = await parsed((bundle) => {
      bundle.index.body = bundle.index.body.replace(
        /only model token usage is\s+billed\./,
        (match) => match + " " + contradiction,
      );
    });
    expect(failures).toEqual([source.url]);
    expect(result.commercial_facts ?? []).toEqual([]);
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
    const { result } = await parsed((bundle) => {
      const doc = bundle.documents.find(({ url }) => url.includes("/api/list-models"));
      if (!doc) throw new Error("Missing model reference");
      doc.body = doc.body.replaceAll(/\[(<code>(?:list|model)<\/code>)\]/g, "$1");
    });
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
