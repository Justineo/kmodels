import { load } from "cheerio";
import type { LinkedBundle } from "./bundle.ts";
import { htmlTables, htmlText } from "./html.ts";
import {
  deepseekEnglishInstant,
  deepseekPrice,
  type DeepseekCurrency,
} from "./deepseek-pricing-policy.ts";
import { canonicalizeInstant } from "./pricing-time.ts";
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
function section(body: string, title: string): string | undefined {
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

function document(bundle: LinkedBundle, url: string): string | undefined {
  const matches = bundle.documents.filter(
    (value) => value.url.replace(/\/$/, "") === url.replace(/\/$/, ""),
  );
  return matches.length === 1 ? matches[0]?.body : undefined;
}

function transition(body: string, currency: DeepseekCurrency): { at: string; fragment: string } {
  const $ = load(body);
  const notes = $("p")
    .toArray()
    .map((node) => htmlText($(node).text()))
    .filter((text) =>
      currency === "USD"
        ? text.includes("server-side tool calls")
        : text.includes("Server 端工具调用"),
    );
  if (notes.length !== 1) throw new Error("Missing or ambiguous server-tool billing policy");
  const text = notes[0] ?? "";
  if (currency === "USD") {
    const match =
      /when you use the DeepSeek API through DeepSeek Harness, Claude Code, or Codex, server-side tool calls already hit the Search and Fetch APIs\. These calls are currently free of charge; per-request billing starts at (\d{2}:\d{2}) Beijing time on ([A-Za-z]+) (\d{1,2}), (\d{4})\./.exec(
        text,
      );
    const time = match?.[1],
      month = match?.[2],
      day = match?.[3],
      year = match?.[4];
    if (time === undefined || month === undefined || day === undefined || year === undefined)
      throw new Error("Unproved server-tool eligibility or effective time");
    return { at: deepseekEnglishInstant(year, month, day, time, "+08:00"), fragment: text };
  }
  const match =
    /当前用户在 DeepSeek Harness\/Claude Code\/Codex 中使用 DeepSeek API 时，已经会通过 Server 端工具调用访问到 Search\/Fetch 接口，这部分 Search\/Fetch 接口调用目前未计费，并将于北京时间\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{2}:\d{2})\s*起按次收取调用费用/.exec(
      text,
    );
  const year = match?.[1],
    month = match?.[2],
    day = match?.[3],
    time = match?.[4];
  if (time === undefined || month === undefined || day === undefined || year === undefined)
    throw new Error("Unproved CNY server-tool eligibility or effective time");
  return {
    at: canonicalizeInstant(
      `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${time}:00+08:00`,
    ),
    fragment: text,
  };
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
    definition:
      "Search API requests returning HTTP 200 with a non-empty results array; result count does not multiply the charge",
  },
  {
    api: "Fetch",
    key: "web-fetch",
    meter: "retrieval",
    definition: "Fetch API requests returning HTTP 200 with page content",
  },
] as const;

function serviceQuotes(
  input: SourceParseInput,
  body: string,
  currency: DeepseekCurrency,
  url: string,
): ServiceQuote[] {
  const headers = currency === "USD" ? "API|Unit|Price" : "API|计费单位|价格";
  const expectedUnit = currency === "USD" ? "Per 1,000 successful requests" : "每 1,000 次成功请求";
  const tables = htmlTables(body);
  const table = tables[0];
  if (tables.length !== 1 || table?.headers.join("|") !== headers)
    throw new Error("Service price table changed");
  for (const row of table.rows)
    if (!serviceDefinitions.some((service) => service.api === row[0]?.text))
      input.onPricingReconciliation?.({
        disposition: "unsupported",
        reason_code: "public_price_shape_unsupported",
        sample: row
          .map((cell) => cell.text)
          .join(" | ")
          .slice(0, 256),
      });
  return serviceDefinitions.map((service) => {
    const rows = table.rows.filter((row) => row[0]?.text === service.api);
    if (rows.length !== 1) throw new Error("Missing or duplicate " + service.api + " quote");
    const row = rows[0],
      unit = row?.[1]?.text ?? "",
      rawAmount = row?.[2]?.text ?? "";
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
  const usd = section(bundle.index.body, "Search & Fetch Pricing");
  const guide = document(bundle, guideUrl);
  const billing = guide === undefined ? undefined : section(guide, "Billing");
  if (usd === undefined && billing === undefined) return {};
  let dependencyUrl = bundle.index.url;
  try {
    if (usd === undefined) throw new Error("Missing owned USD service prices");
    dependencyUrl = cnyUrl;
    const cnyBody = document(bundle, cnyUrl);
    const cny = cnyBody === undefined ? undefined : section(cnyBody, "网页搜索与抓取价格");
    if (cny === undefined) throw new Error("Missing owned CNY service prices");
    dependencyUrl = guideUrl;
    if (billing === undefined) throw new Error("Missing owned billing companion");
    const prose = htmlText(load(billing).text());
    const rule =
      "A request is billable only when it returns HTTP 200 and produces a result (Search must return a non-empty results array, and Fetch must return page content). Failed requests, empty search results, and timeouts are not billed. count only controls how many results are returned and does not affect the per-request price.";
    if (!prose.includes(rule)) throw new Error("Service request qualification changed");
    dependencyUrl = bundle.index.url;
    const usdPolicy = transition(usd, "USD");
    const effective = usdPolicy.at;
    dependencyUrl = cnyUrl;
    const cnyPolicy = transition(cny, "CNY");
    if (cnyPolicy.at !== effective)
      throw new Error("CNY service transition disagrees with the price page");
    dependencyUrl = guideUrl;
    const guidePolicy = transition(billing, "USD");
    if (guidePolicy.at !== effective)
      throw new Error("Guide service transition disagrees with the price page");
    const evidence: RawPriceObservation = {
      source_ref: input.source.id,
      locator: { kind: "fragment", value: guideUrl + "#billing" },
      raw: { fragment: rule },
    };
    const policyEvidence: RawPriceObservation[] = (
      [
        [bundle.index.url, usdPolicy],
        [cnyUrl, cnyPolicy],
        [guideUrl, guidePolicy],
      ] as const
    ).map(([url, policy]) => ({
      source_ref: input.source.id,
      locator: { kind: "fragment", value: policy.fragment },
      raw: { label: url, fragment: policy.fragment },
    }));
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
          observations: offer === "server_tools" ? [evidence, ...policyEvidence] : [evidence],
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
          const conditions = {
            billing_currency: quote.currency,
            ...(offer === "server_tools" ? { effective_from: effective } : {}),
          };
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
          if (offer === "server_tools")
            fact.price_facts.push({
              ...publishedRate(
                service.meter,
                "0",
                "thousand_requests",
                input.source.id,
                quote.expectedUnit,
                { billing_currency: quote.currency, effective_until: effective },
              ),
              currency: quote.currency,
              raw_price: "Free",
              source_locator: {
                kind: "fragment",
                value: quote.currency === "USD" ? usdPolicy.fragment : cnyPolicy.fragment,
              },
              charge_binding: binding,
            });
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
      reason_code: "service_transition_verified",
      sample: effective,
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
