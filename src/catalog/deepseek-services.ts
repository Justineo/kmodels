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

const serverToolBillingRule =
  "Search and Fetch calls triggered by tools when using the DeepSeek API through DeepSeek Harness, Claude Code, or Codex, including Codex Alpha Search, are also billed per successful request.";

function serverToolPolicy(body: string): string {
  const $ = load(body);
  const notes = $("p")
    .toArray()
    .map((node) => htmlText($(node).text()))
    .filter((text) => text === serverToolBillingRule);
  if (notes.length !== 1) throw new Error("Missing or ambiguous server-tool billing policy");
  return notes[0] ?? "";
}

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
    labels: { USD: "Search (text, image)", CNY: "搜索（文字、图片）" },
    units: { USD: "Per 1,000 searches", CNY: "每 1,000 次" },
    definition:
      "Search API requests returning HTTP 200 with a non-empty results array; result count does not multiply the charge",
  },
  {
    api: "Fetch",
    key: "web-fetch",
    meter: "retrieval",
    labels: { USD: "Web fetch", CNY: "网页抓取" },
    units: { USD: "Per 1,000 fetches", CNY: "每 1,000 次" },
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
  const usd = section(bundle.index.body, "Web Search & Fetch Pricing");
  const guide = document(bundle, guideUrl);
  const billing = guide === undefined ? undefined : section(guide, "Billing");
  if (usd === undefined && billing === undefined) return {};
  let dependencyUrl = bundle.index.url;
  try {
    if (usd === undefined) throw new Error("Missing owned USD service prices");
    dependencyUrl = cnyUrl;
    const cnyBody = document(bundle, cnyUrl);
    const cny = cnyBody === undefined ? undefined : section(cnyBody, "联网搜索与抓取价格");
    if (cny === undefined) throw new Error("Missing owned CNY service prices");
    dependencyUrl = guideUrl;
    if (billing === undefined) throw new Error("Missing owned billing companion");
    const prose = htmlText(load(billing).text());
    const rule =
      "A request is billable only when it returns HTTP 200 and produces a result (Search must return a non-empty results array, and Fetch must return page content). Failed requests, empty search results, and timeouts are not billed. count only controls how many results are returned and does not affect the per-request price.";
    if (!prose.includes(rule)) throw new Error("Service request qualification changed");
    const serverTools = serverToolPolicy(billing);
    const evidence: RawPriceObservation = {
      source_ref: input.source.id,
      locator: { kind: "fragment", value: guideUrl + "#billing" },
      raw: { fragment: rule },
    };
    const policyEvidence: RawPriceObservation = {
      source_ref: input.source.id,
      locator: { kind: "fragment", value: guideUrl + "#billing" },
      raw: { label: guideUrl, fragment: serverTools },
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
      for (const offer of ["standalone", "server_tools"] as const) {
        const binding = {
          signal,
          aggregation: "request" as const,
          observations: offer === "server_tools" ? [evidence, policyEvidence] : [evidence],
        };
        const fact: SourceCommercialPricingFact = {
          ...commercialResource(
            input.source.id,
            "service:" + service.key,
            "Web " + service.api,
            "service",
            service.key,
            [],
            "usage",
          ),
          offer_key: offer,
          offer_name:
            offer === "standalone"
              ? "Standalone " + service.api + " API"
              : service.api + " server tools in DeepSeek Harness, Claude Code or Codex",
          pricing_state: "numeric",
          price_facts: [],
          raw_price_facts: [],
        };
        for (const quote of quotes.filter((quote) => quote.api === service.api)) {
          const conditions = { billing_currency: quote.currency };
          if (quote.unit === quote.expectedUnit && quote.amount !== undefined)
            fact.price_facts.push({
              ...publishedRate(
                service.meter,
                quote.amount,
                "thousand_requests",
                input.source.id,
                quote.unit,
                conditions,
              ),
              currency: quote.currency,
              source_locator: { kind: "table", value: quote.url + ": " + service.api },
              charge_binding: binding,
            });
          else
            fact.raw_price_facts.push(
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
        }
        facts.push(fact);
      }
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
      sample: rule.slice(0, 256),
    });
    input.onPricingReconciliation?.({
      disposition: "normalized",
      reason_code: "service_server_tool_rule_verified",
      sample: serverTools,
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
