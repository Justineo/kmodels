import type { LinkedBundle } from "./bundle.ts";
import { deepseekPrice } from "./deepseek-pricing-policy.ts";
import { billingProse, document, section } from "./deepseek-services.ts";
import { htmlTables } from "./html.ts";
import { markdownProse, markdownSection } from "./markdown.ts";
import { commercialResource, publishedRate, rawPricingFact, scaleDecimal } from "./pricing.ts";
import {
  directQuantityMethods,
  indexPricingInputs,
  pricingInputObservation,
} from "./pricing-input.ts";
import type {
  ChargeBinding,
  ProviderAtomRegistryEntry,
  RawPriceObservation,
} from "./pricing-schema.ts";
import type {
  SourceCommercialPricingFact,
  SourcePriceFact,
  SourcePricingFacts,
  SourcePricingInputFact,
} from "./pricing-source.ts";
import type { SourceParseInput } from "./source-parse.ts";

const origin = "https://api-docs.deepseek.com";
const cnyUrl = origin + "/zh-cn/quick_start/pricing/";
const webToolsUrl = origin + "/guides/web_tools";
const definitions = [
  {
    key: "file-parsing",
    name: "File parsing",
    meter: "input_data",
    group: "pages",
    label: { USD: "File parsing, OCR API", CNY: "文件解析、OCR API" },
    guide: "document_parsing",
    rule: "billed once per page of the document, only when parsing succeeds",
    signal: "processed_pages",
  },
  {
    key: "ocr",
    name: "OCR",
    meter: "input_data",
    group: "pages",
    label: { USD: "File parsing, OCR API", CNY: "文件解析、OCR API" },
    guide: "ocr",
    rule: "Billed by the number of pages recognized successfully (`page_count`).",
    signal: "processed_pages",
  },
  {
    key: "text-to-speech",
    name: "Text to Speech",
    meter: "speech_generation",
    group: "speech",
    label: { USD: "Text to Speech (TTS)", CNY: "语音合成（TTS）" },
    guide: "tts",
    rule: "A Chinese character counts as 2 characters; any other character, such as a letter, digit or space, counts as 1.",
    signal: "input_characters",
  },
  {
    key: "speech-to-text",
    name: "Speech to Text",
    meter: "input_audio",
    group: "speech",
    label: { USD: "Speech to Text (ASR)", CNY: "语音识别（ASR）" },
    guide: "asr",
    rule: "Billed by audio duration to the second; a fraction of a second counts as 1 second.",
    signal: "processed_audio_seconds",
  },
] as const;

export function deepseekToolServices(
  input: SourceParseInput,
  bundle: LinkedBundle,
  pricingInputs: readonly SourcePricingInputFact[],
): SourcePricingFacts {
  const facts: SourceCommercialPricingFact[] = [];
  const vocabulary: ProviderAtomRegistryEntry[] = [];
  const inputs = indexPricingInputs(pricingInputs);
  for (const service of definitions) {
    const titles =
      service.group === "pages"
        ? { USD: "File Parsing & OCR Pricing", CNY: "文件解析与 OCR 价格" }
        : { USD: "Speech Pricing", CNY: "语音价格" };
    const usd = section(bundle.index.body, titles.USD);
    if (usd === undefined) continue;
    const guideUrl = `${origin}/guides/${service.guide}.md`;
    const guide = document(bundle, guideUrl);
    const billing = guide === undefined ? undefined : markdownSection(guide, 2, "Billing");
    const verified =
      billing !== undefined &&
      markdownProse(billing)
        .split("\n")
        .filter((line) => !/^\s*>/.test(line))
        .join("\n")
        .includes(service.rule);
    const evidence: RawPriceObservation[] = verified
      ? [
          {
            source_ref: input.source.id,
            locator: { kind: "fragment", value: guideUrl + "#billing" },
            raw: { fragment: service.rule },
          },
        ]
      : [];
    const signal: ChargeBinding["signal"] = { namespace: "kmodels", value: service.signal };
    let aggregation: ChargeBinding["aggregation"] = "request";
    if (service.key === "text-to-speech") {
      vocabulary.push({
        kind: "aggregation",
        key: "tts_utterance",
        definition: "One full-text TTS request or one complete WebSocket TTS text session",
      });
      aggregation = { namespace: "provider", provider_id: "deepseek", value: "tts_utterance" };
    }
    const mapped =
      verified && service.key === "ocr"
        ? directQuantityMethods(signal, ["ocr.processed_pages"], inputs)
        : { methods: [], facts: [] };
    const binding: ChargeBinding = {
      signal,
      aggregation,
      ...(service.key === "speech-to-text" && verified
        ? {
            quantity_methods: [
              {
                calculation: {
                  nodes: [
                    { op: "signal", signal },
                    { op: "round_up", input: 0, increment: { numerator: "1", denominator: "1" } },
                  ],
                  result: 1,
                },
              },
            ],
          }
        : mapped.methods.length === 0
          ? {}
          : { quantity_methods: mapped.methods }),
      observations: [...evidence, ...mapped.facts.map(pricingInputObservation)],
    };
    const fact: SourceCommercialPricingFact = {
      ...commercialResource(
        input.source.id,
        "service:" + service.key,
        service.name,
        "service",
        service.key,
        [],
        "usage",
      ),
      offer_key: "usage",
      offer_name: service.name,
      pricing_state: "numeric",
      price_facts: [],
      raw_price_facts: [],
    };
    for (const currency of ["USD", "CNY"] as const) {
      const url = currency === "USD" ? bundle.index.url : cnyUrl;
      const owned = currency === "USD" ? usd : section(document(bundle, cnyUrl) ?? "", titles.CNY);
      const tables = htmlTables(owned ?? "");
      const table = tables.length === 1 ? tables[0] : undefined;
      const expectedHeaders =
        service.group === "pages"
          ? currency === "USD"
            ? ["Item", "Unit", "Price"]
            : ["项目", "计费单位", "价格"]
          : currency === "USD"
            ? ["API", "Unit", "List price", "Limited-time price (50% off)"]
            : ["API", "计费单位", "刊例价", "限时折扣价（5 折）"];
      const rows = table?.rows.filter((row) => row[0]?.text === service.label[currency]) ?? [];
      if (JSON.stringify(table?.headers) !== JSON.stringify(expectedHeaders) || rows.length !== 1) {
        input.onPricingDependencyFailure?.(url);
        input.onPricingReconciliation?.({
          disposition: "unresolved",
          reason_code: "commercial_source_contract_drift",
          sample: `${service.key}:${currency}: missing or ambiguous owned tariff`,
        });
        continue;
      }
      const row = rows[0];
      const unit = row?.[1]?.text ?? "";
      const quote = row?.[service.group === "pages" ? 2 : 3]?.text ?? "";
      const expectedUnit =
        service.group === "pages"
          ? currency === "USD"
            ? "Per 1,000 pages"
            : "每 1,000 页"
          : service.key === "text-to-speech"
            ? currency === "USD"
              ? "Per 10,000 characters"
              : "每 10,000 字符"
            : currency === "USD"
              ? "Per hour of audio"
              : "每小时音频";
      let amount: string | undefined;
      try {
        amount = deepseekPrice(quote, currency);
      } catch {
        /* Retain the native quote locally. */
      }
      if (amount === undefined || unit !== expectedUnit) {
        fact.raw_price_facts.push(
          rawPricingFact(
            input.source.id,
            service.key,
            "base_price",
            unit !== expectedUnit ? "unknown_unit" : "unknown_amount",
            { label: service.name, amount: quote, unit, denomination: currency },
            { billing_currency: currency },
          ),
        );
        if (service.key !== "ocr")
          input.onPricingReconciliation?.({
            disposition: "raw",
            reason_code: "unsupported_pricing_cell_preserved",
            sample: `${currency}:${service.key}:${quote}`,
          });
        continue;
      }
      const characters = service.key === "text-to-speech";
      const rate: SourcePriceFact = {
        ...publishedRate(
          service.meter,
          characters ? scaleDecimal(amount, -4) : amount,
          service.group === "pages" ? "thousand_pages" : characters ? "character" : "hour",
          input.source.id,
          unit,
          { billing_currency: currency },
        ),
        currency,
        source_locator: { kind: "table", value: `${url}: ${service.label[currency]}` },
        charge_binding: {
          ...binding,
          observations: [
            ...binding.observations,
            {
              source_ref: input.source.id,
              locator: { kind: "table", value: url },
              raw: {
                label: service.label[currency],
                amount: quote,
                unit,
                ...(service.group === "speech"
                  ? {
                      fragment: `${expectedHeaders[3]}; ${expectedHeaders[2]}: ${row?.[2]?.text ?? ""}`,
                    }
                  : {}),
              },
            },
          ],
        },
        ...(characters
          ? {
              derived: true,
              derivation:
                "Divide the published amount per 10,000 provider-billed characters by 10,000",
              raw_price: amount,
            }
          : {}),
        ...(service.group === "speech" ? { raw_validity: expectedHeaders[3] ?? "" } : {}),
      };
      fact.price_facts.push(rate);
      if (service.key !== "ocr")
        input.onPricingReconciliation?.({
          disposition: "normalized",
          reason_code: "provider_service_pricing_bound",
          sample: `${currency}:${service.key}:${quote}`,
        });
    }
    fact.pricing_state = fact.price_facts.length === 0 ? "unknown" : "numeric";
    facts.push(fact);
  }
  const web = document(bundle, webToolsUrl);
  const billing = web === undefined ? undefined : section(web, "Usage and Billing");
  if (web !== undefined && billing === undefined) {
    input.onPricingDependencyFailure?.(webToolsUrl);
    input.onPricingReconciliation?.({
      disposition: "unresolved",
      reason_code: "commercial_source_contract_drift",
      sample: "Missing owned native web-tool billing section",
    });
  }
  if (billing !== undefined) {
    const text = billingProse(billing);
    const rule =
      "These server tools are not billed (text search, image search and page fetch). Only model token usage is billed.";
    if (
      text !==
      "The usage in the final message_delta, or in a non-streaming response, is the billed usage of the whole request, summed over its inference steps: " +
        rule
    ) {
      input.onPricingDependencyFailure?.(webToolsUrl);
      input.onPricingReconciliation?.({
        disposition: "unresolved",
        reason_code: "commercial_source_contract_drift",
        sample: "Native web-tool billing qualification changed",
      });
    } else {
      input.onPricingReconciliation?.({
        disposition: "normalized",
        reason_code: "service_billing_rule_verified",
        sample: "Native web tools: " + rule,
      });
    }
  }
  return { commercial_facts: facts, vocabulary };
}
