import { readFile } from "node:fs/promises";
import { load } from "cheerio";
import { htmlText } from "../src/catalog/html.ts";
import { describe, expect, it, vi } from "vite-plus/test";
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

async function fixture(name: string): Promise<string> {
  return readFile(new URL(`./fixtures/deepseek/${name}.html`, import.meta.url), "utf8");
}

describe("DeepSeek commercial dependency isolation", () => {
  it.each([
    "Chinese time",
    "USD time",
    "currency disagreement",
    "unbound column",
    "missing CNY",
    "service time",
    "service guide",
  ])(
    "retains accepted pricing/replay and compatible catalog facts after %s drift",
    async (failure) => {
      const manifest = manifests.find(({ provider }) => provider.id === "deepseek");
      const source = manifest?.sources.find(({ id }) => id === "deepseek-catalog");
      if (manifest === undefined || source === undefined)
        throw new Error("Missing DeepSeek source");
      const singleSource: ProviderManifest = { ...manifest, sources: [source] };
      const bundle = {
        index: { url: source.url, body: await fixture("catalog") },
        documents: await Promise.all(
          [
            ["api/create-chat-completion", "chat"],
            ["api/create-response", "responses"],
            ["api/create-completion", "fim"],
            ["guides/anthropic_api", "anthropic"],
            ["guides/vision", "vision"],
            ["api/list-models", "list-models"],
            ["zh-cn/quick_start/pricing/", "catalog-cny"],
          ].map(async ([path, name]) => {
            if (path === undefined || name === undefined)
              throw new Error("Invalid fixture mapping");
            return { url: `https://api-docs.deepseek.com/${path}`, body: await fixture(name) };
          }),
        ),
      };
      {
        for (const [body, name, heading] of [
          [bundle.index, "services-catalog", "Search & Fetch Pricing"],
          [
            bundle.documents.find((doc) => doc.url.includes("/zh-cn/")),
            "services-cny",
            "网页搜索与抓取价格",
          ],
        ] as const) {
          if (body === undefined) throw new Error("Missing service pricing owner");
          const $ = load(await fixture(name));
          const title = $("h2").filter((_, node) => htmlText($(node).text()) === heading);
          if (title.length !== 1) throw new Error("Missing native service heading");
          const target = load(body.body);
          target("article").append(title.toString() + title.nextUntil("h1,h2").toString());
          body.body = target.html();
        }
        bundle.documents.push({
          url: "https://api-docs.deepseek.com/guides/search/",
          body: await fixture("search-billing"),
        });
      }
      const respond = (hash: string) =>
        vi.mocked(fetchSource).mockResolvedValue({
          body: JSON.stringify(bundle),
          contentHash: hash.repeat(64),
          etag: undefined,
          lastModified: undefined,
          dependencies: [],
        });
      respond("1");
      const prior = await collectProvider(singleSource, undefined, { sources: {} }, previousAt);
      if (prior.pricing === undefined || prior.pricingReplaySources === undefined)
        throw new Error(JSON.stringify(prior.attempt));
      expect(
        prior.pricing.books.filter((book) => book.scope.kind === "provider_resource"),
      ).toHaveLength(2);
      const catalog = core(prior, previousAt);
      const pricing: PricingCatalog = {
        provider_vocabularies: [prior.pricing.vocabulary],
        provider_snapshots: [prior.pricing.snapshot],
        model_dispositions: prior.pricing.model_dispositions,
        books: prior.pricing.books,
      };
      const accepted = prepareCatalogPair(catalog, pricing);
      const replay = createPricingCompilationSnapshot(accepted, [
        { provider_id: "deepseek", sources: prior.pricingReplaySources },
      ]);
      const cny = bundle.documents.find(({ url }) => url.includes("/zh-cn/"));
      if (cny === undefined) throw new Error("Missing CNY fixture");
      if (failure === "Chinese time") cny.body = cny.body.replaceAll("12:00", "13:00");
      if (failure === "USD time")
        bundle.index.body = bundle.index.body.replaceAll("01:00", "02:00");
      if (failure === "currency disagreement")
        cny.body = cny.body.replace(
          /空闲时段价格为高峰时段价格的一半。[\s\S]*?统一按照低谷时段价格收取调用费用。/,
          "高峰时段为北京时间周一至周五 9:00 - 12:00、14:00 - 18:00（其余为空闲时段）。",
        );
      if (failure === "unbound column")
        bundle.index.body = bundle.index.body.replace(
          "deepseek-v4-pro</td>",
          "unbound model id</td>",
        );
      if (failure === "missing CNY")
        bundle.documents = bundle.documents.filter((document) => document !== cny);
      if (failure === "service time") cny.body = cny.body.replace("11 月 1 日", "11 月 2 日");
      if (failure === "service guide") {
        const guide = bundle.documents.find((doc) => doc.url.includes("/guides/search/"));
        if (guide === undefined) throw new Error("Missing service guide");
        guide.body = guide.body.replace("non-empty", "empty");
      }
      bundle.index.body = bundle.index.body.replace("DeepSeek-V4-Flash-0731", "Updated-Flash");
      respond("2");
      const next = await collectProvider(singleSource, catalog, { sources: {} }, currentAt);
      expect(next.attempt.outcome).toBe("accepted");
      expect(next.coverage.status).toBe("fresh");
      expect(next.models.find(({ model_id }) => model_id === "deepseek-v4-flash")?.name).toBe(
        "Updated-Flash",
      );
      expect(next.pricing).toBeUndefined();
      expect(next.pricingReplaySources).toBeUndefined();
      expect(next.pricingFailure).toBe("source_schema_changed");
      const transition = failedPricingTransition("deepseek", currentAt, "source_schema_changed");
      const composed = composeCatalogPair(catalog, core(next, currentAt), pricing, [transition]);
      if (failure === "unbound column") {
        expect(composed.catalog.models).toEqual(catalog.models);
        expect(
          composed.catalog.warnings.some(({ code }) => code === "retained_pricing_core_mismatch"),
        ).toBe(true);
      } else expect(composed.catalog.models).toEqual(next.models);
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
        new Map([["deepseek", transition]]),
        new Set(),
        replay,
      );
      expect(entries).toEqual(replay.providers);
      expect(createPricingCompilationSnapshot(candidate, entries).providers).toEqual(
        replay.providers,
      );
    },
  );
});
