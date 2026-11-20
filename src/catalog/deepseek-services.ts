import { load } from "cheerio";
import type { LinkedBundle } from "./bundle.ts";
import { htmlTables, htmlText } from "./html.ts";
import { deepseekPrice, type DeepseekCurrency } from "./deepseek-pricing-policy.ts";
import { commercialResource, publishedRate, rawPricingFact } from "./pricing.ts";
import type { SourceCommercialPricingFact, SourcePricingFacts } from "./pricing-source.ts";
import type { ProviderAtomRegistryEntry, RawPriceObservation } from "./pricing-schema.ts";
import type { SourceParseInput } from "./source-parse.ts";

const guideUrl = "https://api-docs.deepseek.com/guides/search/";
const cnyUrl = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/";
const requestUnit = {
  factors: [{ unit: { namespace: "kmodels" as const, value: "request" as const }, power: 1 }],
};

// Only a direct, unquoted document section can own tariffs or billing policy.
export function section(body: string, title: string): string | undefined {
  const $ = load(body);
  const article = $("article");
  if (article.length !== 1 || article.parents("blockquote,pre,code,aside").length > 0) return;
  const markdown = article.find(".theme-doc-markdown");
  if (markdown.length > 1) return;
  const root = markdown.length === 1 ? markdown : article;
  const headings = root
    .find("h2")
    .filter(
      (_, node) =>
        !$(node).parentsUntil(root).is("blockquote,pre,code,aside,section") &&
        htmlText($(node).text()) === title,
    );
  if (headings.length !== 1) return;
  const owned = $("<div></div>").append(headings.nextUntil("h1,h2").clone());
  owned.find("blockquote,pre,aside,script,style,template").remove();
  return owned.html() ?? undefined;
}

export function document(bundle: LinkedBundle, url: string): string | undefined {
  const matches = bundle.documents.filter(
    (value) => value.url.replace(/\/$/, "") === url.replace(/\/$/, ""),
  );
  return matches.length === 1 ? matches[0]?.body : undefined;
}

const standaloneBillingRule =
  "A standalone request is billable only when it returns HTTP 200 and produces a result (Search must return a non-empty results array, and Fetch must return page content). Failed requests, empty search results, and timeouts are not billed. count only controls how many results are returned and does not affect the per-request price.";
const serverToolFreeRule =
  "Searches performed by the model through server-side tools are not billed (text search, image search and page fetch). Only model token usage is billed.";
const clientDirectRule =
  "Searches that call the Search and Fetch APIs directly from the client are billed at the prices above, such as search in DeepSeek Harness when Web search provider is DeepSeek Search API, and Codex Alpha Search.";
const usdServerToolChange =
  "Starting 12:00 on November 18, 2026 (Beijing Time, UTC+8), server-side search and web fetch triggered when calling the model are no longer billed; only model token usage is billed.";
const cnyServerToolChange =
  "自北京时间 2026 年 11 月 18 日 12:00 起，调用模型时触发的服务端搜索、网页抓取不再计费，仅按模型 Token 用量计费。";
const serviceNotices = {
  USD: {
    intro:
      "The Search and Fetch APIs are billed per use. For the billing rules, see Search & Fetch.",
    notices: [
      usdServerToolChange,
      "Starting 12:00 on November 18, 2026 (Beijing Time, UTC+8), the server-side search and web fetch tool calls triggered when calling the model are no longer billed; the results they return are appended to the model context and billed as model token usage.",
    ],
    scope:
      "Server-side search is triggered when you use the web tools, the web_search tool in the Anthropic API or the web_search tool in the Responses API.",
  },
  CNY: {
    intro: "Search 与 Fetch API 按次计费。 计费规则见 网页搜索与抓取。",
    notices: [
      cnyServerToolChange,
      "自北京时间 2026 年 11 月 18 日 12:00 起，调用模型时触发的服务端搜索、网页抓取，其工具调用本身不再计费；工具返回的结果会拼接到模型上下文中参与推理，按模型 Token 用量计费。",
    ],
    scope:
      "使用以下接口时会触发服务端搜索：联网工具、Anthropic API 的 web_search 工具、Responses API 的 web_search 工具。",
  },
};

// Compare the whole owned policy. A matching sentence can be qualified or revoked later.
export function billingProse(body: string): string {
  const $ = load(body);
  $("table").remove();
  $("p,li").append(" ");
  return htmlText($.text());
}

function serviceNotice(body: string, currency: DeepseekCurrency) {
  const text = billingProse(body);
  const { intro, notices, scope } = serviceNotices[currency];
  return notices.find(
    (notice) => text === intro + " " + notice + (currency === "USD" ? " " : "") + scope,
  );
}
// Both reviewed price pages specify noon in Beijing (UTC+8).
const freeFrom = "2026-11-18T04:00:00.000Z";

interface ServiceQuote {
  api: "Search" | "Fetch";
  currency: DeepseekCurrency;
  url: string;
  unit: string;
  expectedUnit: string;
  rawAmount: string;
  amount: string | undefined;
}
const serviceDefinitions = [
  {
    api: "Search",
    key: "web-search",
    meter: "web_search",
    labels: { USD: "Search API (text)", CNY: "Search API（文字）" },
    units: { USD: "Per 1,000 successful requests", CNY: "每 1,000 次成功请求" },
    definition:
      "Search API requests returning HTTP 200 with a non-empty results array; result count does not multiply the charge",
  },
  {
    api: "Fetch",
    key: "web-fetch",
    meter: "retrieval",
    labels: { USD: "Fetch API", CNY: "Fetch API" },
    units: { USD: "Per 1,000 successful requests", CNY: "每 1,000 次成功请求" },
    definition: "Fetch API requests returning HTTP 200 with page content",
  },
] as const;

function serviceQuotes(
  input: SourceParseInput,
  body: string,
  currency: DeepseekCurrency,
  url: string,
): ServiceQuote[] {
  const headers = currency === "USD" ? "Item|Unit|Price" : "项目|计费单位|价格";
  const tables = htmlTables(body);
  const table = tables[0];
  if (tables.length !== 1 || table?.headers.join("|") !== headers)
    throw new Error("Service price table changed");
  for (const row of table.rows)
    if (!serviceDefinitions.some((service) => service.labels[currency] === row[0]?.text))
      input.onPricingReconciliation?.({
        disposition: "unsupported",
        reason_code: "public_price_shape_unsupported",
        sample: row
          .map((cell) => cell.text)
          .join(" | ")
          .slice(0, 256),
      });
  return serviceDefinitions.map((service) => {
    const rows = table.rows.filter((row) => row[0]?.text === service.labels[currency]);
    if (rows.length !== 1) throw new Error("Missing or duplicate " + service.api + " quote");
    const row = rows[0],
      unit = row?.[1]?.text ?? "",
      rawAmount = row?.[2]?.text ?? "";
    const expectedUnit = service.units[currency];
    let amount: string | undefined;
    try {
      amount = deepseekPrice(rawAmount, currency);
    } catch {
      /* Preserve the native amount. */
    }
    const known = unit === expectedUnit && amount !== undefined;
    input.onPricingReconciliation?.({
      disposition: known ? "normalized" : "raw",
      reason_code: known ? "provider_service_pricing_bound" : "unsupported_pricing_cell_preserved",
      sample: currency + ":" + service.api + ":" + rawAmount,
    });
    return { api: service.api, currency, url, unit, expectedUnit, rawAmount, amount };
  });
}

export function deepseekServicePricing(
  input: SourceParseInput,
  bundle: LinkedBundle,
): SourcePricingFacts {
  const usd = section(bundle.index.body, "Search & Fetch API Pricing");
  const guide = document(bundle, guideUrl);
  const billing = guide === undefined ? undefined : section(guide, "Billing");
  if (usd === undefined && billing === undefined) return {};
  let dependencyUrl = bundle.index.url;
  try {
    if (usd === undefined) throw new Error("Missing owned USD service prices");
    dependencyUrl = cnyUrl;
    const cnyBody = document(bundle, cnyUrl);
    const cny = cnyBody === undefined ? undefined : section(cnyBody, "Search 与 Fetch API 价格");
    if (cny === undefined) throw new Error("Missing owned CNY service prices");
    dependencyUrl = guideUrl;
    if (billing === undefined) throw new Error("Missing owned billing companion");
    const expectedBilling = [
      "The Search and Fetch APIs are billed per successful request, not by tokens or by the number of returned results:",
      standaloneBillingRule,
      serverToolFreeRule,
      "Server-side tools include the web tools, the web_search tool in the Responses API, Web Search in Claude Code, and search in DeepSeek Harness when Web search provider is set to DeepSeek server-side search or Auto (the default).",
      clientDirectRule,
    ].join(" ");
    if (billingProse(billing) !== expectedBilling)
      throw new Error("Server-tool billing qualification changed");
    dependencyUrl = bundle.index.url;
    const usdNotice = serviceNotice(usd, "USD");
    if (!usdNotice) throw new Error("Missing USD server-tool exemption instant");
    dependencyUrl = cnyUrl;
    if (!serviceNotice(cny, "CNY"))
      throw new Error("Missing matching CNY server-tool exemption instant");
    const evidence: RawPriceObservation = {
      source_ref: input.source.id,
      locator: { kind: "fragment", value: guideUrl + "#billing" },
      raw: { fragment: standaloneBillingRule },
    };

    const clientEvidence: RawPriceObservation = {
      source_ref: input.source.id,
      locator: { kind: "fragment", value: guideUrl + "#billing" },
      raw: { label: guideUrl, fragment: clientDirectRule },
    };
    dependencyUrl = bundle.index.url;
    const quotes = serviceQuotes(input, usd, "USD", bundle.index.url);
    dependencyUrl = cnyUrl;
    quotes.push(...serviceQuotes(input, cny, "CNY", cnyUrl));
    const facts: SourceCommercialPricingFact[] = [];
    const vocabulary: ProviderAtomRegistryEntry[] = [];
    for (const service of serviceDefinitions) {
      const signalKey = "successful_" + service.api.toLowerCase() + "_requests";
      const signal = { namespace: "provider" as const, provider_id: "deepseek", value: signalKey };
      vocabulary.push({
        kind: "usage_signal",
        key: signalKey,
        unit: requestUnit,
        resolution_phase: "outcome",
        definition: service.definition,
      });
      const resource = commercialResource(
        input.source.id,
        "service:" + service.key,
        "Web " + service.api,
        "service",
        service.key,
        [],
        "usage",
      );
      const direct: SourceCommercialPricingFact = {
        ...resource,
        offer_key: "standalone",
        offer_name: "Standalone " + service.api + " API",
        pricing_state: "numeric",
        price_facts: [],
        raw_price_facts: [],
      };
      const serverTools: SourceCommercialPricingFact = {
        ...resource,
        offer_key: "server_tools",
        offer_name: "Model-triggered server-side " + service.api.toLowerCase(),
        pricing_state: "unknown",
        price_facts: [],
        raw_price_facts: [],
        state_facts: [
          {
            state: "free",
            conditions: { effective_from: freeFrom },
            source_ref: input.source.id,
            source_locator: { kind: "fragment", value: bundle.index.url + "#web-tools-pricing" },
            raw: {
              label: "Model-triggered server-side " + service.api.toLowerCase(),
              validity: freeFrom,
              fragment: usdNotice,
            },
          },
        ],
      };
      for (const quote of quotes.filter((entry) => entry.api === service.api)) {
        const conditions = { billing_currency: quote.currency };
        const amount = quote.amount;
        if (quote.unit !== quote.expectedUnit || amount === undefined) {
          direct.raw_price_facts.push(
            rawPricingFact(
              input.source.id,
              service.api.toLowerCase(),
              "base_price",
              quote.unit === quote.expectedUnit ? "unknown_amount" : "unknown_unit",
              {
                label: service.api,
                amount: quote.rawAmount,
                unit: quote.unit,
                denomination: quote.currency,
              },
              conditions,
            ),
          );
          continue;
        }
        direct.price_facts.push({
          ...publishedRate(
            service.meter,
            amount,
            "thousand_requests",
            input.source.id,
            quote.unit,
            conditions,
          ),
          currency: quote.currency,
          source_locator: { kind: "table", value: quote.url + ": " + service.api },
          charge_binding: {
            signal,
            aggregation: "request",
            observations: [evidence, clientEvidence],
          },
        });
      }
      direct.pricing_state = direct.price_facts.length ? "numeric" : "unknown";
      facts.push(direct, serverTools);
    }
    // The guide owns billing qualification; its repeated amounts do not override the price page.
    for (const table of htmlTables(billing))
      for (const row of table.rows)
        input.onPricingReconciliation?.({
          disposition: "excluded",
          reason_code: "service_amount_authority_price_page",
          sample: row
            .map((cell) => cell.text)
            .join(" | ")
            .slice(0, 256),
        });
    input.onPricingReconciliation?.({
      disposition: "normalized",
      reason_code: "service_billing_rule_verified",
      sample: standaloneBillingRule.slice(0, 256),
    });
    input.onPricingReconciliation?.({
      disposition: "normalized",
      reason_code: "service_server_tool_rule_verified",
      sample: serverToolFreeRule + " From " + freeFrom,
    });
    return { commercial_facts: facts, vocabulary };
  } catch (error) {
    input.onPricingReconciliation?.({
      disposition: "unresolved",
      reason_code: "commercial_source_contract_drift",
      sample: "Search/Fetch: " + (error instanceof Error ? error.message : String(error)),
    });
    input.onPricingDependencyFailure?.(dependencyUrl);
    return {};
  }
}
