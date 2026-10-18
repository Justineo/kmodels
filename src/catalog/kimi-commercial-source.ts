import type {
  ParsedProviderModel,
  SourceCommercialPricingFact,
  SourcePriceFact,
  SourceRawPricingFact,
  SourcePricingInputFact,
} from "./pricing-source.ts";
import { pricingInputObservation, usageInputSources } from "./pricing-input.ts";
import type { UsageSignal } from "./pricing-schema.ts";

export interface KimiCommercialEvidence {
  batchModels: string[];
  batchScopeConflicts: string[];
  fileService: boolean;
  formulaModels: string[];
  formulaTools: string[];
  searchModels: string[];
  searchRate?: SourcePriceFact;
  region: string;
  webSearchWarning: boolean;
}

export function extractKimiCommercialFacts(
  models: Map<string, ParsedProviderModel>,
  sourceId: string,
  evidence: KimiCommercialEvidence,
): SourceCommercialPricingFact[] {
  for (const modelId of evidence.batchScopeConflicts) {
    const model = models.get(modelId);
    if (model !== undefined)
      model.raw_price_facts.push(
        raw(
          "batch_applicability_conflict",
          "informational",
          "unknown_applicability",
          "The Batch price page includes this model while the Batch workflow guide omits it",
          sourceId,
          { region: evidence.region, service_tier: "batch" },
        ),
      );
  }

  const facts: SourceCommercialPricingFact[] = [];
  if (evidence.searchRate !== undefined) {
    for (const modelId of evidence.searchModels) {
      const model = models.get(modelId);
      if (model === undefined) continue;
      facts.push({
        ...service(sourceId, "service:web-search", "Kimi web search", "web-search", [model.uid]),
        offer_key: `built-in:${model.uid}`,
        offer_name: `Built-in web search for ${model.model_id}`,
        pricing_state: "numeric",
        price_facts: [searchRate(evidence.searchRate, false)],
        raw_price_facts:
          evidence.webSearchWarning && modelId === "kimi-k3"
            ? [
                raw(
                  "k3_web_search_documentation_warning",
                  "informational",
                  "unknown_applicability",
                  "The K3 price page says web search is being updated and recommends following subsequent documentation",
                  sourceId,
                ),
              ]
            : [],
      });
    }
    const formulaRefs = modelRefs(models, evidence.formulaModels);
    if (formulaRefs.length > 0 && evidence.formulaTools.includes("web-search"))
      facts.push({
        ...service(sourceId, "service:web-search", "Kimi web search", "web-search", formulaRefs),
        offer_key: "formula",
        offer_name: "Formula web-search Fiber",
        pricing_state: "numeric",
        price_facts: [searchRate(evidence.searchRate, true)],
        raw_price_facts: [
          raw(
            "formula_web_search_billing_scope",
            "informational",
            "unknown_applicability",
            "The Formula guide delegates pricing to the WebSearch price page, whose detailed trigger prose names only the built-in $web_search route",
            sourceId,
          ),
        ],
      });
  }

  const formulaRefs = modelRefs(models, evidence.formulaModels);
  for (const tool of evidence.formulaTools.filter((name) => name !== "web-search"))
    facts.push({
      ...service(
        sourceId,
        "service:formula",
        "Kimi Formula official tools",
        "formula",
        formulaRefs,
      ),
      offer_key: `fiber:${tool}`,
      offer_name: `Formula moonshot/${tool}:latest Fiber`,
      pricing_state: "free",
      price_facts: [],
      raw_price_facts: [
        raw(
          "limited_time_free",
          "informational",
          "unknown_applicability",
          "Official Formula tool execution is free for a limited time; no promotion end or post-promotion meter is published",
          sourceId,
        ),
      ],
    });

  if (evidence.fileService) {
    const refs = [...models.values()].map(({ uid }) => uid).sort();
    facts.push({
      ...service(sourceId, "service:files", "Kimi Files", "files", refs),
      offer_key: "operations",
      offer_name: "File upload, extraction, storage, retrieval, and deletion",
      pricing_state: "free",
      price_facts: [],
      raw_price_facts: [
        raw(
          "limited_time_free",
          "informational",
          "unknown_applicability",
          "File parsing and file-related interfaces are free for a limited time; model input remains separately token billed",
          sourceId,
        ),
      ],
    });
  }

  return facts;
}

export function kimiTokenSignal(
  modelId: string,
  meter: string,
): Extract<UsageSignal, { namespace: "kmodels" }> | undefined {
  const value =
    meter === "cache_write_text"
      ? "cache_write_tokens"
      : meter === "cache_read_text"
        ? "cached_input_tokens"
        : meter === "output_text"
          ? "output_tokens"
          : meter === "input_text"
            ? /(?:^|\/)moonshot-v1-/.test(modelId)
              ? "input_tokens"
              : "uncached_input_tokens"
            : undefined;
  return value === undefined ? undefined : { namespace: "kmodels", value };
}

export function bindKimiBatchPrices(
  models: Map<string, ParsedProviderModel>,
  admittedModels: readonly string[],
  inputs: readonly SourcePricingInputFact[],
): void {
  for (const model of models.values()) {
    model.price_facts = model.price_facts.map((rate) => {
      if (rate.conditions.service_tier !== "batch" || rate.unit !== "million_tokens") return rate;
      const signal = kimiTokenSignal(model.model_id, rate.meter);
      if (signal === undefined) return rate;
      const facts =
        admittedModels.includes(model.model_id) && signal.value === "output_tokens"
          ? inputs.filter(
              ({ key, source_ref }) =>
                key === "batch.result.output_tokens" && source_ref === rate.source_ref,
            )
          : [];
      return {
        ...rate,
        charge_binding: {
          signal,
          aggregation: "result_item",
          ...(facts.length === 0
            ? {}
            : { quantity_methods: [{ input_sources: usageInputSources(signal, facts) }] }),
          observations: [
            {
              source_ref: rate.source_ref,
              locator: { kind: "provider_key", value: `batch:${model.model_id}:${rate.meter}` },
              raw: {
                fragment:
                  facts.length === 0
                    ? "Batch token rate; no verified model-scoped result acquisition path"
                    : `The regional Batch guide supports ${model.model_id} and reports completion_tokens per result`,
              },
            },
            ...facts.map(pricingInputObservation),
          ],
        },
      };
    });
  }
}

function service(
  sourceRef: string,
  bookKey: string,
  bookName: string,
  resourceKey: string,
  modelRefs: string[],
): Pick<
  SourceCommercialPricingFact,
  | "billing_mode"
  | "book_key"
  | "book_name"
  | "model_refs"
  | "resource_key"
  | "resource_kind"
  | "source_ref"
> {
  return {
    source_ref: sourceRef,
    book_key: bookKey,
    book_name: bookName,
    resource_kind: "service",
    resource_key: resourceKey,
    model_refs: modelRefs,
    billing_mode: "usage",
  };
}

function searchRate(rate: SourcePriceFact, formula: boolean): SourcePriceFact {
  return {
    ...rate,
    meter: "web_search",
    unit: "event",
    conditions: rate.conditions.region === undefined ? {} : { region: rate.conditions.region },
    ...(formula
      ? {
          derived: true,
          derivation: "Formula web-search delegates pricing to the regional WebSearch price page",
        }
      : { derived: false }),
  };
}

function raw(
  termKey: string,
  impact: SourceRawPricingFact["impact"],
  reason: SourceRawPricingFact["reason"],
  fragment: string,
  sourceRef: string,
  conditions: SourceRawPricingFact["conditions"] = {},
): SourceRawPricingFact {
  return {
    term_key: termKey,
    impact,
    reason,
    conditions,
    source_ref: sourceRef,
    raw: { fragment },
  };
}

function modelRefs(
  models: ReadonlyMap<string, ParsedProviderModel>,
  modelIds: readonly string[],
): string[] {
  return modelIds.flatMap((id) => {
    const model = models.get(id);
    return model === undefined ? [] : [model.uid];
  });
}
