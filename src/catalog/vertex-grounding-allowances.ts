import { canonicalJson, uniqueCanonicalValues } from "./canonical-value.ts";
import { canonicalizeApplicability } from "./pricing-canonical.ts";
import { pricingBookId, pricingOfferId, pricingTermId } from "./pricing-identifiers.ts";
import type {
  PriceAllowanceTerm,
  PriceApplicability,
  ProviderAtomRegistryEntry,
  UnitExpression,
} from "./pricing-schema.ts";
import type {
  SourceCommercialPricingFact,
  SourcePriceFact,
  SourceRawPricingFact,
} from "./pricing-source.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";

interface AllowanceRule {
  key: string;
  quantity: string;
  reset: "daily" | "monthly";
  unit: "request" | "search_unit";
}

export interface VertexGroundingClaim {
  model_ref: string;
  operation: string;
  label: string;
  fragment: string;
  rule: AllowanceRule | undefined;
}

const dailyPatterns = {
  google_search: {
    flash:
      /Gemini 2\.0 Flash, 2\.5 Flash and 2\.5 Flash-Lite include a combined ([\d,]+) Grounding Prompts per day at no additional charge\./i,
    pro: /Gemini 2\.5 Pro includes ([\d,]+) Grounding Prompts per day at no additional charge\./i,
  },
  google_maps: {
    flash: /Gemini Flash and Flash-Lite: combined ([\d,]+) grounded prompts per day\./i,
    pro: /Gemini Pro: ([\d,]+) grounded prompts per day\./i,
  },
};

function quantity(value: string | undefined): string | undefined {
  return value !== undefined && /^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)$/.test(value)
    ? value.replaceAll(",", "")
    : undefined;
}

/** Interpret only the native Usage/Pricing cell, before it becomes passive evidence. */
export function vertexGroundingAllowance(
  fragment: string,
  modelRef: string,
  operation: string,
): AllowanceRule | undefined {
  const monthly = fragment.match(
    /Includes ([\d,]+) (?:Grounding|search) Queries per month at no charge, aggregated across all Gemini 3( and Gemini 4)? models\./i,
  );
  const monthlyQuantity = quantity(monthly?.[1]);
  const monthlyModel =
    monthly?.[2] === undefined
      ? /^vertex\/gemini-3[.-]/.test(modelRef)
      : /^vertex\/gemini-[34][.-]/.test(modelRef);
  if (
    monthlyQuantity !== undefined &&
    monthlyModel &&
    ["google_search", "google_image_search", "web_grounding_enterprise", "google_maps"].includes(
      operation,
    )
  )
    return {
      key: `gemini-3-${operation === "google_maps" ? "maps" : "web"}-monthly`,
      quantity: monthlyQuantity,
      reset: "monthly",
      unit: "search_unit",
    };
  if (operation !== "google_search" && operation !== "google_maps") return;
  const family = /^vertex\/gemini-(?:2\.0|2\.5)-flash(?:-|$)/.test(modelRef)
    ? "flash"
    : /^vertex\/gemini-2\.5-pro(?:-|$)/.test(modelRef)
      ? "pro"
      : undefined;
  if (family === undefined) return;
  const amount = quantity(fragment.match(dailyPatterns[operation][family])?.[1]);
  if (amount === undefined) return;
  return {
    key: `${operation.replaceAll("_", "-")}-${family}-daily`,
    quantity: amount,
    reset: "daily",
    unit: "request",
  };
}

function allowanceUnit(value: AllowanceRule["unit"]): UnitExpression {
  return {
    factors: [
      {
        unit:
          value === "request"
            ? { namespace: "kmodels", value: "request" }
            : { namespace: "provider", provider_id: "vertex", value: "search_unit" },
        power: 1,
      },
    ],
  };
}

function rateUnit(value: SourcePriceFact["unit"]): AllowanceRule["unit"] | undefined {
  if (value === "request" || value === "thousand_requests") return "request";
  if (value === "search_unit" || value === "thousand_search_units") return "search_unit";
  return undefined;
}

function rawAllowance(claim: VertexGroundingClaim, sourceRef: string): SourceRawPricingFact {
  return {
    term_key: "grounding_allowance",
    impact: "allowance",
    reason: "unsupported_structure",
    conditions: { operation: claim.operation },
    source_ref: sourceRef,
    raw: { label: claim.label, fragment: claim.fragment },
  };
}

function applicability(claims: readonly VertexGroundingClaim[]): PriceApplicability {
  const dimension = { namespace: "kmodels", value: "operation" } as const;
  return canonicalizeApplicability({
    any_of: claims.map((claim) => ({
      all_of: [
        {
          kind: "categorical",
          dimension,
          values: [{ namespace: "provider", provider_id: "vertex", value: claim.operation }],
        },
      ],
    })),
  });
}

/** One canonical pool covers exact model/service targets, including targets in other books. */
export function vertexGroundingAllowances(
  facts: SourceCommercialPricingFact[],
  claims: readonly VertexGroundingClaim[],
  sourceRef: string,
  reconcile?: (item: PricingReconciliationItem) => void,
): { facts: SourceCommercialPricingFact[]; vocabulary: ProviderAtomRegistryEntry[] } {
  const groups = new Map<
    string,
    Array<{
      claim: VertexGroundingClaim;
      rule: AllowanceRule;
      fact: SourceCommercialPricingFact;
    }>
  >();
  const vocabulary: ProviderAtomRegistryEntry[] = [];
  const retainRaw = (claim: VertexGroundingClaim, fact: SourceCommercialPricingFact) => {
    fact.raw_price_facts.push(rawAllowance(claim, sourceRef));
    reconcile?.({
      disposition: "raw",
      reason_code: "grounding_allowance",
      sample: claim.model_ref,
    });
  };
  for (const claim of claims) {
    const fact = facts.find(
      (candidate) =>
        candidate.offer_key === `request:${claim.model_ref}` &&
        [...candidate.price_facts, ...candidate.raw_price_facts].some(
          ({ conditions }) => conditions.operation === claim.operation,
        ),
    );
    if (fact === undefined) throw new Error("Grounding claim has no source service identity");
    if (claim.rule === undefined) {
      retainRaw(claim, fact);
      continue;
    }
    const group = groups.get(claim.rule.key) ?? [];
    group.push({ claim, rule: claim.rule, fact });
    groups.set(claim.rule.key, group);
  }
  for (const group of groups.values()) {
    const first = group[0];
    if (first === undefined) continue;
    const { rule } = first;
    if (
      group.some(
        (entry) =>
          canonicalJson(entry.rule) !== canonicalJson(rule) ||
          entry.fact.price_facts.length === 0 ||
          entry.fact.price_facts.some((rate) => rateUnit(rate.unit) !== rule.unit) ||
          entry.fact.raw_price_facts.some(({ impact }) => impact === "base_price"),
      )
    ) {
      for (const { claim, fact } of group) retainRaw(claim, fact);
      continue;
    }
    const host = group.reduce(
      (host, { fact }) => (fact.book_key.localeCompare(host.book_key) < 0 ? fact : host),
      first.fact,
    );
    const offerKey = `allowance:${rule.key}`;
    const scope = applicability(group.map(({ claim }) => claim));
    const term: PriceAllowanceTerm = {
      id: pricingTermId(
        pricingOfferId(pricingBookId("vertex", host.book_key), offerKey),
        "allowance",
        "free-grounding-usage",
      ),
      term_key: "free-grounding-usage",
      kind: "allowance",
      source_refs: [sourceRef],
      raw_variants: [],
      variants: [
        {
          benefit: {
            kind: "quantity",
            quantity: {
              value: { numerator: rule.quantity, denominator: "1" },
              unit: allowanceUnit(rule.unit),
            },
          },
          target: {
            kind: "rate_terms",
            term_refs: [
              ...new Set(
                group.flatMap(({ fact }) =>
                  fact.price_facts.map(({ meter }) =>
                    pricingTermId(
                      pricingOfferId(pricingBookId("vertex", fact.book_key), fact.offer_key),
                      "rate",
                      meter,
                    ),
                  ),
                ),
              ),
            ].sort(),
          },
          reset: { namespace: "kmodels", value: rule.reset },
          applicability: scope,
          observations: group.map(({ claim }) => ({
            source_ref: sourceRef,
            locator: {
              kind: "provider_key",
              value: JSON.stringify([claim.model_ref, claim.operation]),
            },
            raw: { label: claim.label, fragment: claim.fragment },
            establishes_applicability: scope,
          })),
        },
      ],
    };
    facts.push({
      ...host,
      model_refs: [...new Set(group.map(({ claim }) => claim.model_ref))].sort(),
      offer_key: offerKey,
      offer_name: "Shared grounding allowance",
      price_facts: [],
      raw_price_facts: [],
      terms: [term],
    });
    if (rule.unit === "search_unit")
      vocabulary.push({
        kind: "unit",
        key: "search_unit",
        definition: "One executed Agent Platform grounding query",
      });
    for (const { claim } of group)
      reconcile?.({
        disposition: "normalized",
        reason_code: "grounding_allowance_bound",
        sample: claim.model_ref,
      });
  }
  return { facts, vocabulary: uniqueCanonicalValues(vocabulary) };
}
