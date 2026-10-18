import { canonicalizeApplicability } from "./pricing-canonical.ts";
import { pricingBookId, pricingOfferId, pricingTermId } from "./pricing-identifiers.ts";
import { pricingInputObservation, usageInputSources } from "./pricing-input.ts";
import { rationalFromDecimal } from "./pricing-rational.ts";
import type {
  ChargeBinding,
  PriceMeter,
  PriceRateTerm,
  ProviderAtomRegistryEntry,
  RawPriceObservation,
  UnitExpression,
} from "./pricing-schema.ts";
import type {
  SourceCommercialPricingFact,
  SourcePriceFact,
  SourcePricingInputFact,
} from "./pricing-source.ts";
import { canonicalizeSourceUnit, canonicalizeUnitPrice } from "./pricing-units.ts";

const providerId = "amazon-bedrock";
const requestUnit: UnitExpression = {
  factors: [{ unit: { namespace: "kmodels", value: "request" }, power: 1 }],
};

interface ServiceRateInput {
  bookKey: string;
  offerKey: string;
  termKey: string;
  resourceKey: string;
  amount: string;
  unit: string;
  attributes: Readonly<Record<string, string>>;
  observation: RawPriceObservation;
  inputs: readonly SourcePricingInputFact[];
  vocabulary: ProviderAtomRegistryEntry[];
}

// Price List pricePerUnit is denominated by its unit field. The description may
// advertise a price per 1K while the machine amount is already per single unit.
export function bedrockServiceTerm(input: ServiceRateInput): PriceRateTerm | undefined {
  const { resourceKey, vocabulary } = input;
  if (!["guardrails", "reranking", "web-search", "prompt-routing"].includes(resourceKey)) return;
  const unit = serviceUnit(input.unit, vocabulary);
  if (unit === undefined) return;
  const meter: PriceMeter =
    resourceKey === "guardrails"
      ? { namespace: "kmodels", value: "content_safety" }
      : resourceKey === "reranking"
        ? { namespace: "kmodels", value: "rerank" }
        : resourceKey === "web-search"
          ? { namespace: "kmodels", value: "web_search" }
          : { namespace: "provider", provider_id: providerId, value: "prompt_routing" };
  if (meter.namespace === "provider")
    vocabulary.push({
      kind: "meter",
      key: meter.value,
      definition: "Amazon Bedrock intelligent prompt-routing requests",
    });
  const region = input.attributes.regionCode;
  if (region !== undefined)
    vocabulary.push({
      kind: "categorical_value",
      key: region,
      dimension: { namespace: "kmodels", value: "region" },
      definition: `Provider-published region value ${JSON.stringify(region)}`,
    });
  const applicability = canonicalizeApplicability({
    any_of: [
      {
        all_of:
          region === undefined
            ? []
            : [
                {
                  kind: "categorical",
                  dimension: { namespace: "kmodels", value: "region" },
                  values: [{ namespace: "provider", provider_id: providerId, value: region }],
                },
              ],
      },
    ],
  });
  const charge_binding = serviceBinding(input, unit.unit);
  const offerId = pricingOfferId(pricingBookId(providerId, input.bookKey), input.offerKey);
  return {
    id: pricingTermId(offerId, "rate", input.termKey),
    kind: "rate",
    term_key: input.termKey,
    meter,
    source_refs: [input.observation.source_ref],
    raw_variants: [],
    variants: [
      {
        price: canonicalizeUnitPrice(
          rationalFromDecimal(input.amount),
          { kind: "fiat", currency: "USD" },
          unit,
        ),
        applicability,
        ...(charge_binding === undefined ? {} : { charge_binding }),
        observations: [{ ...input.observation, establishes_applicability: applicability }],
      },
    ],
  };
}

function serviceUnit(
  unit: string,
  vocabulary: ProviderAtomRegistryEntry[],
): ReturnType<typeof canonicalizeSourceUnit> | undefined {
  if (unit === "TextUnit") {
    vocabulary.push({
      kind: "unit",
      key: "guardrail_text_unit",
      definition: "One Amazon Bedrock Guardrail text unit of up to 1,000 characters",
    });
    return canonicalizeSourceUnit([
      {
        unit: { namespace: "provider", provider_id: providerId, value: "guardrail_text_unit" },
        power: 1,
      },
    ]);
  }
  if (unit === "Images Processed")
    return canonicalizeSourceUnit([{ unit: { namespace: "kmodels", value: "image" }, power: 1 }]);
  if (unit === "Search Units") {
    vocabulary.push({
      kind: "unit",
      key: "search_unit",
      definition: "One provider-published search or rerank billing unit",
    });
    return canonicalizeSourceUnit([
      { unit: { namespace: "provider", provider_id: providerId, value: "search_unit" }, power: 1 },
    ]);
  }
  if (["API Calls", "Invocations", "Queries", "Requests", "Text Requests"].includes(unit))
    return canonicalizeSourceUnit(requestUnit.factors);
  if (/^Per 1000 requests$/i.test(unit))
    return canonicalizeSourceUnit([
      { unit: { namespace: "kmodels", value: "request" }, power: 1, scale: "thousand" },
    ]);
  return;
}

function serviceBinding(input: ServiceRateInput, unit: UnitExpression): ChargeBinding | undefined {
  const { operation, policyType } = input.attributes;
  if (input.resourceKey === "guardrails") {
    const field =
      operation === "InvokeGuardrailChecks"
        ? {
            GuardrailContentChecks: "contentFilter.textUnits",
            GuardrailPromptAttackChecks: "promptAttack.textUnits",
            GuardrailSensitiveInfoChecks: "sensitiveInformation.textUnits",
          }[policyType ?? ""]
        : {
            AutomatedReasoning: "automatedReasoningPolicyUnits",
            Content: "contentPolicyUnits",
            ContentPolicyImage: "contentPolicyImageUnits",
            ContextualGrounding: "contextualGroundingPolicyUnits",
            GuardrailContent: "contentPolicyUnits",
            GuardrailSensitiveInfo: "sensitiveInformationPolicyUnits",
            GuardrailTopic: "topicPolicyUnits",
            GuardrailWordPolicy: "wordPolicyUnits",
            SensitiveInfo: "sensitiveInformationPolicyUnits",
            SensitiveInfoFree: "sensitiveInformationPolicyFreeUnits",
            Topic: "topicPolicyUnits",
            WordPolicy: "wordPolicyUnits",
          }[policyType ?? ""];
    if (field === undefined) return;
    const key = `guardrail_${field.replace(/[A-Z.]/g, (value) => (value === "." ? "_" : `_${value.toLowerCase()}`))}`;
    const factKey =
      operation === "InvokeGuardrailChecks"
        ? `guardrails.checks.${field}`
        : `guardrails.apply.${field}`;
    const facts = input.inputs.filter(
      (fact) => fact.key === factKey && fact.source_ref === input.observation.source_ref,
    );
    return binding(
      key,
      `Amazon Bedrock Guardrails billable ${field}`,
      "outcome",
      unit,
      input.vocabulary,
      input.observation,
      facts,
    );
  }
  const metadata =
    input.resourceKey === "reranking"
      ? {
          key: "rerank_search_units",
          definition:
            "Amazon Bedrock rerank search units after provider-defined document-chunk expansion",
          phase: "request" as const,
        }
      : input.resourceKey === "web-search"
        ? {
            key: "web_search_queries",
            definition: "Amazon Bedrock Web Search queries actually issued by the server-side tool",
            phase: "outcome" as const,
          }
        : input.resourceKey === "prompt-routing"
          ? {
              key: "prompt_routing_requests",
              definition: "Model invocations addressed to an Amazon Bedrock prompt router",
              phase: "request" as const,
            }
          : undefined;
  if (metadata === undefined) return;
  return binding(
    metadata.key,
    metadata.definition,
    metadata.phase,
    unit,
    input.vocabulary,
    input.observation,
    [],
  );
}

function binding(
  key: string,
  definition: string,
  resolution_phase: "request" | "outcome",
  unit: UnitExpression,
  vocabulary: ProviderAtomRegistryEntry[],
  observation: RawPriceObservation,
  facts: readonly SourcePricingInputFact[],
): ChargeBinding {
  vocabulary.push({ kind: "usage_signal", key, definition, unit, resolution_phase });
  return {
    signal: { namespace: "provider", provider_id: providerId, value: key },
    aggregation: "request",
    ...(facts.length === 0
      ? {}
      : {
          quantity_methods: [
            {
              input_sources: usageInputSources(
                { namespace: "provider", provider_id: providerId, value: key },
                facts,
              ),
            },
          ],
        }),
    observations: [observation, ...facts.map(pricingInputObservation)],
  };
}

export function bedrockGroundingFact(
  modelRef: string,
  rates: readonly SourcePriceFact[],
  vocabulary: ProviderAtomRegistryEntry[],
): SourceCommercialPricingFact | undefined {
  const grounding = rates.filter(
    (rate) => rate.meter === "tool_call" && rate.conditions.operation === "grounding",
  );
  const sourceRef = grounding[0]?.source_ref;
  if (sourceRef === undefined) return;
  return {
    source_ref: sourceRef,
    book_key: `service:nova-web-grounding:${modelRef}`,
    book_name: `${modelRef} Nova Web Grounding`,
    resource_kind: "service",
    resource_key: `nova-web-grounding:${modelRef}`,
    model_refs: [modelRef],
    offer_key: "grounding",
    offer_name: "Nova Web Grounding",
    billing_mode: "usage",
    pricing_state: "numeric",
    raw_price_facts: [],
    price_facts: grounding.map((rate) => ({
      ...rate,
      meter: "web_search",
      charge_binding: binding(
        "nova_web_grounding_requests",
        "Nova Web Grounding requests realized by Amazon Bedrock",
        "outcome",
        requestUnit,
        vocabulary,
        {
          source_ref: rate.source_ref,
          locator: rate.source_locator ?? { kind: "meter", value: "grounding" },
          raw: { amount: rate.raw_price ?? rate.price, unit: rate.raw_unit ?? rate.unit },
        },
        [],
      ),
    })),
  };
}
