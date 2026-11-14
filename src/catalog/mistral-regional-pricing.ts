import { z } from "zod";
import { canonicalJson } from "./canonical-json.ts";
import { multiplyDecimal, rawPricingFact } from "./pricing.ts";
import type { MistralPricingPolicy } from "./mistral-pricing-policy.ts";
import type {
  ParsedProviderModel,
  SourcePriceFact,
  SourceRawPricingFact,
} from "./pricing-source.ts";
import type { SourceParseInput } from "./source-parse.ts";

const decimal = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);
const regionalUrl = "https://docs.mistral.ai/inference/regional-inference";

export function regionalMistralPrices(
  input: SourceParseInput,
  model: ParsedProviderModel,
  policy: MistralPricingPolicy | undefined,
): { rates: SourcePriceFact[]; raw: SourceRawPricingFact[] } {
  const rates: SourcePriceFact[] = [];
  const raw: SourceRawPricingFact[] = [];
  if (model.status === "retired") return { rates, raw };
  const observations =
    input.inventoryModels?.filter(({ model_id }) => model_id === model.model_id) ?? [];
  const regions = new Map<string, Set<string>>();
  for (const observation of observations)
    for (const { region, deployment_type } of observation.availability ?? []) {
      if (
        !["eu", "us"].includes(region) ||
        deployment_type !== "managed_api" ||
        !observation.source_refs.includes(`mistral-api-${region}`)
      )
        continue;
      const paths = regions.get(region) ?? new Set<string>();
      for (const { path } of observation.api_endpoints ?? []) paths.add(path);
      regions.set(region, paths);
    }
  if (!model.api_endpoints?.some(({ path }) => path === "/v1/audio/transcriptions/realtime"))
    for (const paths of regions.values()) paths.delete("/v1/audio/transcriptions/realtime");
  const bases = model.price_facts.filter(
    ({ conditions }) =>
      (conditions.service_tier ?? "standard") === "standard" && conditions.region === undefined,
  );
  const regional = policy?.regional;
  for (const [region, paths] of regions) {
    if (paths.size === 0) {
      raw.push(
        rawPricingFact(
          input.source.id,
          "regional_endpoint_unverified",
          "base_price",
          "unsupported_structure",
          {
            label:
              "Regional availability is retained, but no current regional endpoint contract was established",
          },
          { region },
        ),
      );
      continue;
    }
    for (const base of bases)
      for (const endpoint of paths) {
        if (!belongsToEndpoint(model, base, endpoint)) continue;
        const token = ["token", "thousand_tokens", "million_tokens"].includes(base.unit);
        for (const tier of [
          "standard",
          ...(token &&
          endpoint === "/v1/chat/completions" &&
          ["input_text", "output_text", "cache_read_text"].includes(base.meter)
            ? ["priority"]
            : []),
        ]) {
          const factor =
            tier === "priority"
              ? regional?.priority
              : token || regional?.allUnits === true
                ? regional?.standard
                : undefined;
          const conditions = { ...base.conditions, region, endpoint, service_tier: tier };
          if (factor === undefined) {
            raw.push(
              rawPricingFact(
                input.source.id,
                `regional_policy:${base.meter}:${base.currency}:${tier}`,
                "base_price",
                "unsupported_structure",
                {
                  label: `The ${region} model is observed, but its ${tier} regional pricing policy could not establish this rate`,
                  meter: base.meter,
                  denomination: base.currency,
                  unit: base.unit,
                },
                conditions,
              ),
            );
            continue;
          }
          const price = multiplyDecimal(base.price, factor);
          if (
            base.currency === "EUR" &&
            policy?.euro !== undefined &&
            (price.split(".")[1]?.length ?? 0) > policy.euro.decimals
          ) {
            raw.push(
              rawPricingFact(
                input.source.id,
                `regional_currency:${base.meter}:${tier}`,
                "base_price",
                "unsupported_structure",
                {
                  label: "The derived regional EUR amount requires display rounding",
                  amount: price,
                  denomination: base.currency,
                  unit: base.unit,
                  meter: base.meter,
                },
                conditions,
              ),
            );
            continue;
          }
          rates.push({
            ...base,
            price,
            raw_price: price,
            conditions,
            source_ref: input.source.id,
            source_locator: { kind: "fragment", value: regionalUrl },
            derived: true,
            derivation: `${factor} × ${base.price} ${base.currency} ${base.meter} from ${base.source_ref}, for the observed ${region} endpoint${tier === "priority" ? "; Priority and regional uplifts are additive" : ""}`,
          });
        }
      }
    for (const base of model.raw_price_facts) {
      if (
        base.impact !== "base_price" ||
        (base.conditions.service_tier ?? "standard") !== "standard" ||
        base.conditions.region !== undefined
      )
        continue;
      for (const endpoint of paths) {
        if (base.conditions.endpoint !== undefined && base.conditions.endpoint !== endpoint)
          continue;
        const amount = decimal.safeParse(base.raw.amount);
        const { amount: _amount, ...knownRaw } = base.raw;
        raw.push({
          ...base,
          source_ref: input.source.id,
          conditions: { ...base.conditions, region, endpoint, service_tier: "standard" },
          raw: {
            ...knownRaw,
            ...(amount.success && regional?.allUnits === true
              ? { amount: multiplyDecimal(amount.data, regional.standard) }
              : {}),
            label: `${base.raw.label ?? base.term_key}; regional applicability is observed; unresolved meter semantics remain`,
          },
        });
      }
    }
  }
  const unique = <T>(items: T[]): T[] => [
    ...new Map(items.map((value) => [canonicalJson(value), value])).values(),
  ];
  return { rates: unique(rates), raw: unique(raw) };
}

function belongsToEndpoint(
  model: ParsedProviderModel,
  rate: SourcePriceFact,
  path: string,
): boolean {
  if (rate.conditions.endpoint !== undefined && rate.conditions.endpoint !== path) return false;
  if (rate.conditions.operation === "chat_completions") return path === "/v1/chat/completions";
  if (
    rate.conditions.operation === "transcription" ||
    (rate.meter === "input_audio" && model.tasks.includes("transcription"))
  )
    return path === "/v1/audio/transcriptions" || path === "/v1/audio/transcriptions/realtime";
  if (["ocr", "document_annotation"].includes(rate.conditions.operation ?? ""))
    return path === "/v1/ocr";
  if (rate.meter === "embedding") return path === "/v1/embeddings";
  if (rate.meter === "input_image" && model.tasks.includes("ocr")) return path === "/v1/ocr";
  if (model.tasks.includes("speech_synthesis")) return path === "/v1/audio/speech";
  return ["/v1/chat/completions", "/v1/fim/completions"].includes(path);
}
