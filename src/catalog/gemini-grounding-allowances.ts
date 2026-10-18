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

export type GeminiGroundingOperation = "google_search" | "google_maps";
interface GroundingAllowanceRule {
  key: string;
  quantity: string;
  reset: "monthly" | "daily";
  unit: "request" | "search_unit";
}
export interface GeminiGroundingClaim {
  model_ref: string;
  operation: GeminiGroundingOperation;
  conditions: SourcePriceFact["conditions"];
  tier_label: string;
  fragment: string;
  rule: GroundingAllowanceRule | undefined;
}

export function geminiGroundingOperation(row: string): GeminiGroundingOperation | undefined {
  const operation = row.match(/^Grounding with Google (Search|Maps)\**$/i)?.[1]?.toLowerCase();
  return operation === "search"
    ? "google_search"
    : operation === "maps"
      ? "google_maps"
      : undefined;
}

export function geminiGroundingQuantity(value: string | undefined): string | undefined {
  return value !== undefined && /^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)$/.test(value)
    ? value.replaceAll(",", "")
    : undefined;
}

export function geminiGroundingAllowance(
  fragment: string,
  modelRef: string,
  operation: GeminiGroundingOperation,
  mapsMonthlyQueries: string | undefined,
): GroundingAllowanceRule | undefined {
  const search = fragment.match(
    /^([\d,]+) free search requests per month \(shared across all Gemini (?:3\.x models|3 and newer models)\), then /i,
  );
  const searchQuantity = geminiGroundingQuantity(search?.[1]);
  if (operation === "google_search" && searchQuantity !== undefined)
    return {
      key: "gemini-3-monthly",
      quantity: searchQuantity,
      reset: "monthly",
      unit: "search_unit",
    };
  const maps = fragment.match(
    /^([\d,]+) (?:prompts|requests) per month \(free, shared across (Gemini 3|all Gemini 3 and newer models)\), then /i,
  );
  const quantity = geminiGroundingQuantity(maps?.[1]);
  if (operation === "google_maps" && quantity !== undefined && maps !== null) {
    const modern = maps[2]?.toLowerCase() === "all gemini 3 and newer models";
    if (modern && mapsMonthlyQueries !== quantity) return;
    return {
      key: "gemini-3-monthly",
      quantity,
      reset: "monthly",
      unit: modern ? "search_unit" : "request",
    };
  }
  const daily = fragment.match(
    /^([\d,]+) RPD \(free(?:, limit shared with (Flash|Flash-Lite) RPD)?\), then /i,
  );
  const dailyQuantity = geminiGroundingQuantity(daily?.[1]);
  if (dailyQuantity === undefined || daily === null) return;
  const shared = daily[2] !== undefined;
  if (shared && !["gemini/gemini-2.5-flash", "gemini/gemini-2.5-flash-lite"].includes(modelRef))
    return;
  return {
    key: shared ? "gemini-2.5-flash-shared-daily" : `${modelRef}-daily`,
    quantity: dailyQuantity,
    reset: "daily",
    unit: "request",
  };
}

function allowanceUnit(unit: GroundingAllowanceRule["unit"]): UnitExpression {
  return {
    factors: [
      {
        unit:
          unit === "request"
            ? { namespace: "kmodels", value: "request" }
            : { namespace: "provider", provider_id: "gemini", value: "search_unit" },
        power: 1,
      },
    ],
  };
}

/** Native cell claims have been recognized before commercial extraction; raw is evidence only. */
export function geminiGroundingAllowances(
  facts: SourceCommercialPricingFact[],
  claims: readonly GeminiGroundingClaim[],
  sourceRef: string,
): { facts: SourceCommercialPricingFact[]; vocabulary: ProviderAtomRegistryEntry[] } {
  const byOffer = new Map(facts.map((fact) => [fact.offer_key + "\0" + fact.resource_key, fact]));
  const groups = new Map<
    string,
    Array<{
      claim: GeminiGroundingClaim;
      rule: GroundingAllowanceRule;
      fact: SourceCommercialPricingFact;
    }>
  >();
  const vocabulary: ProviderAtomRegistryEntry[] = [];
  for (const claim of claims) {
    const fact = byOffer.get(
      `grounding:${claim.model_ref}\0${claim.operation.replaceAll("_", "-")}`,
    );
    if (fact === undefined) throw new Error("Grounding claim has no source service identity");
    if (claim.rule === undefined) {
      fact.raw_price_facts.push(rawAllowance(claim, sourceRef));
      continue;
    }
    const key = fact.book_key + "\0" + claim.rule.key;
    const group = groups.get(key) ?? [];
    group.push({ claim, rule: claim.rule, fact });
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const first = group[0];
    if (first === undefined) continue;
    const { rule, fact } = first;
    if (
      group.some(
        (entry) =>
          canonicalJson(entry.rule) !== canonicalJson(rule) ||
          entry.fact.price_facts.length === 0 ||
          entry.fact.price_facts.some((rate) => sourceUnit(rate.unit) !== rule.unit),
      )
    ) {
      for (const { claim, fact } of group)
        fact.raw_price_facts.push(rawAllowance(claim, sourceRef));
      continue;
    }
    const applicability = canonicalizeApplicability({
      any_of: group.flatMap(({ claim }) => claimApplicability(claim, vocabulary).any_of),
    });
    const bookId = pricingBookId("gemini", fact.book_key);
    const offerKey = `allowance:${rule.key}`;
    const meter = fact.resource_key === "google-search" ? "web_search" : "maps_search";
    const term: PriceAllowanceTerm = {
      id: pricingTermId(pricingOfferId(bookId, offerKey), "allowance", "free-grounding-usage"),
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
                group.map(({ fact }) =>
                  pricingTermId(pricingOfferId(bookId, fact.offer_key), "rate", meter),
                ),
              ),
            ],
          },
          reset: { namespace: "kmodels", value: rule.reset },
          applicability,
          observations: group.map(({ claim }) => ({
            source_ref: sourceRef,
            locator: {
              kind: "provider_key",
              value: JSON.stringify([claim.model_ref, claim.operation, claim.conditions]),
            },
            raw: { label: fact.book_name, fragment: claim.fragment },
            establishes_applicability: applicability,
          })),
        },
      ],
    };
    facts.push({
      ...fact,
      model_refs: [...new Set(group.flatMap(({ fact }) => fact.model_refs))],
      offer_key: offerKey,
      offer_name: "Grounding allowance",
      pricing_state: "numeric",
      price_facts: [],
      raw_price_facts: [],
      terms: [term],
    });
    if (rule.unit === "search_unit")
      vocabulary.push({
        kind: "unit",
        key: "search_unit",
        definition: "One executed Google Search or Google Maps grounding query",
      });
  }
  return { facts, vocabulary: uniqueCanonicalValues(vocabulary) };
}

function sourceUnit(unit: SourcePriceFact["unit"]): GroundingAllowanceRule["unit"] | undefined {
  if (unit === "request" || unit === "thousand_requests") return "request";
  if (unit === "search_unit" || unit === "thousand_search_units") return "search_unit";
  return undefined;
}

function rawAllowance(claim: GeminiGroundingClaim, sourceRef: string): SourceRawPricingFact {
  return {
    term_key: "grounding-allowance",
    impact: "allowance",
    reason: "unsupported_structure",
    conditions: claim.conditions,
    source_ref: sourceRef,
    raw: {
      label:
        claim.operation === "google_search"
          ? "Grounding with Google Search"
          : "Grounding with Google Maps",
      fragment: claim.fragment,
    },
  };
}

function claimApplicability(
  claim: GeminiGroundingClaim,
  vocabulary: ProviderAtomRegistryEntry[],
): PriceApplicability {
  const values = [
    { dimension: "account_eligibility" as const, key: "paid_tier", label: "Paid Tier" },
    {
      dimension: "operation" as const,
      key: claim.operation,
      label: claim.operation === "google_search" ? "Google Search" : "Google Maps",
    },
    ...(claim.conditions.service_tier === undefined
      ? []
      : [
          {
            dimension: "service_tier" as const,
            key: claim.conditions.service_tier,
            label: claim.tier_label,
          },
        ]),
  ];
  return {
    any_of: [
      {
        all_of: values.map(({ dimension, key, label }) => {
          const atom = { namespace: "kmodels" as const, value: dimension };
          vocabulary.push({
            kind: "categorical_value",
            key,
            dimension: atom,
            label,
            definition: `Grounding price cell applicability: ${label}`,
          });
          return {
            kind: "categorical" as const,
            dimension: atom,
            values: [{ namespace: "provider" as const, provider_id: "gemini", value: key }],
          };
        }),
      },
    ],
  };
}
