import { load } from "cheerio";
import { decimalsEqual, publishedRate, rawPricingFact } from "./pricing.ts";
import type { ParsedProviderModel, SourcePriceFact } from "./pricing-source.ts";
import type { ProviderAtomRegistryEntry } from "./pricing-schema.ts";
import type { SourceParseInput } from "./source-parse.ts";
import { contractExtensionEvidence } from "./source-contract.ts";

export const ollamaPricingUrl = "https://ollama.com/pricing";
const scheduleClaim =
  "Off-peak pricing apply outside 12:00 and 18:00 UTC on weekdays and all day on weekends.";
const text = (value: string) => value.replace(/\s+/g, " ").trim();
const meters = ["input_text", "cache_read_text", "output_text"] as const;

export function applyOllamaPublicPricing(
  input: SourceParseInput,
  models: ParsedProviderModel[],
  body: string,
): ProviderAtomRegistryEntry[] {
  const $ = load(body),
    section = $("section#model-pricing");
  const paragraphs = text(section.children("p").text());
  const tables = section.find("table"),
    headers = tables
      .find("thead th")
      .map((_i, el) => text($(el).text()))
      .get();
  if (
    section.length !== 1 ||
    text(section.children("h2").text()) !== "Model pricing" ||
    !paragraphs.includes("Prices are per million tokens.") ||
    tables.length !== 1 ||
    JSON.stringify(headers) !== JSON.stringify(["Model", "Input", "Cached input", "Output"])
  ) {
    input.onContractFinding?.(contractExtensionEvidence(["/public-pricing/table"]));
    input.onPricingDependencyFailure?.(ollamaPricingUrl);
    return [];
  }
  const rows = tables
    .find("tbody tr")
    .toArray()
    .flatMap((el) => {
      const cells = $(el).children("td"),
        anchor = cells.eq(0).find("a");
      const label = text(anchor.text()),
        offPeak = label.endsWith(" (Off-Peak)");
      const id = offPeak ? label.slice(0, -" (Off-Peak)".length) : label;
      const href = anchor.attr("href");
      const family = id.split(":")[0];
      if (
        cells.length !== 4 ||
        anchor.length !== 1 ||
        (href !== `/library/${id}` && href !== `/library/${family}`)
      ) {
        input.onContractFinding?.(contractExtensionEvidence(["/public-pricing/model_identity"]));
        input.onPricingDependencyFailure?.(ollamaPricingUrl);
        return [];
      }
      return [
        {
          id,
          offPeak,
          amounts: cells
            .slice(1)
            .map((_i, cell) => text($(cell).text()))
            .get(),
        },
      ];
    });
  if (rows.length === 0) {
    input.onPricingDependencyFailure?.(ollamaPricingUrl);
    return [];
  }
  const paired = new Set(rows.filter((row) => row.offPeak).map((row) => row.id));
  const byId = new Map(models.map((model) => [model.model_id, model]));
  for (const row of rows) {
    const model = byId.get(row.id);
    if (model === undefined) {
      input.onPricingReconciliation?.({
        disposition: "unbound",
        reason_code: "public_price_model_unbound",
        sample: row.id,
      });
      continue;
    }
    const conditions = paired.has(row.id)
      ? { billing_period: row.offPeak ? "off_peak" : "peak" }
      : {};
    for (const [index, meter] of meters.entries()) {
      const amount = row.amounts[index];
      if (amount === undefined) continue;
      const price = /^\$((?:0|[1-9]\d*)(?:\.\d+)?)$/.exec(amount)?.[1];
      const key = `public-pricing:${row.id}:${conditions.billing_period ?? "standard"}:${meter}`;
      if (price === undefined) {
        model.raw_price_facts.push(
          rawPricingFact(
            input.source.id,
            key,
            "base_price",
            "unknown_amount",
            { amount, unit: "1M tokens", denomination: "USD", label: meter },
            conditions,
          ),
        );
        continue;
      }
      const rate: SourcePriceFact = {
        ...publishedRate(meter, price, "million_tokens", input.source.id, "1M tokens", conditions),
        source_locator: { kind: "provider_key", value: key },
        ...(meter !== "input_text"
          ? {}
          : {
              charge_binding: {
                signal: { namespace: "kmodels", value: "uncached_input_tokens" },
                aggregation: "request",
                observations: [
                  {
                    source_ref: input.source.id,
                    locator: { kind: "provider_key", value: key },
                    raw: {
                      label: "Input, separate from the Cached input column",
                      unit: "1M tokens",
                    },
                  },
                ],
              },
            }),
      };
      model.price_facts.push(rate);
      // The same table header establishes the input meaning for matching card quotes.
      if (rate.charge_binding !== undefined)
        for (const fact of model.price_facts)
          if (
            fact.meter === meter &&
            fact.source_ref === input.source.id &&
            JSON.stringify(fact.conditions) === JSON.stringify(conditions)
          )
            fact.charge_binding = rate.charge_binding;
    }
  }
  for (const model of models) {
    const groups = new Map<string, SourcePriceFact[]>();
    for (const fact of model.price_facts) {
      const key = JSON.stringify([fact.meter, fact.conditions]);
      const group = groups.get(key) ?? [];
      group.push(fact);
      groups.set(key, group);
    }
    const conflicts = new Set<SourcePriceFact>();
    for (const [key, facts] of groups) {
      const first = facts[0];
      if (
        first === undefined ||
        facts.every(
          (f) =>
            f.unit === first.unit &&
            f.currency === first.currency &&
            decimalsEqual(f.price, first.price),
        )
      )
        continue;
      for (const fact of facts) {
        conflicts.add(fact);
        model.raw_price_facts.push(
          rawPricingFact(
            fact.source_ref,
            `price-conflict:${key}`,
            "base_price",
            "unsupported_structure",
            {
              amount: fact.price,
              denomination: fact.currency,
              unit: "1M tokens",
              label: fact.meter,
            },
            fact.conditions,
          ),
        );
      }
      input.onPricingReconciliation?.({
        disposition: "ambiguous",
        reason_code: "public_model_price_conflict",
        sample: model.model_id,
      });
    }
    model.price_facts = model.price_facts.filter((f) => !conflicts.has(f));
    model.pricing_state = model.price_facts.length > 0 ? "numeric" : "unknown";
  }
  if (paired.size === 0) return [];
  if (
    paragraphs !==
    `Pay as you go with usage credits. Prices are per million tokens. ${scheduleClaim}`
  ) {
    input.onContractFinding?.(contractExtensionEvidence(["/public-pricing/billing_period_rule"]));
    return [];
  }
  return ["peak", "off_peak"].map((key) => ({
    kind: "categorical_value",
    key,
    dimension: { namespace: "kmodels", value: "billing_period" },
    label: key === "peak" ? "Peak" : "Off-peak",
    definition: scheduleClaim,
    schedule:
      key === "peak"
        ? {
            kind: "weekly_time_windows",
            time_zone: "UTC",
            days: ["monday", "tuesday", "wednesday", "thursday", "friday"],
            windows: [{ from: "12:00", until: "18:00" }],
          }
        : { kind: "weekly_time_remainder", time_zone: "UTC" },
  }));
}
