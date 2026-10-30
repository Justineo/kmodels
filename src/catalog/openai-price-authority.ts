import type { AtomicPricingBook, AtomicRateTerm, AtomicRateVariant } from "./pricing-assembly.ts";
import { canonicalJson } from "./canonical-json.ts";
import { compareUtf8 } from "./canonical-value.ts";
import {
  applicabilitiesOverlap,
  applicabilityContainedIn,
  canonicalizeApplicability,
} from "./pricing-canonical.ts";
import { pricingLimits } from "./pricing-constants.ts";
import { isStandardUnit, rawEvidence, withApplicability } from "./pricing-commercial-assembly.ts";
import type { PriceApplicability, PriceCondition } from "./pricing-schema.ts";
import { openAiCacheLifetime, withoutOpenAiCacheLifetime } from "./openai-cache.ts";

type Clause = PriceApplicability["any_of"][number];

export function preferOpenAiPricingPage(book: AtomicPricingBook): AtomicPricingBook {
  return {
    ...book,
    offers: book.offers.map((offer) => ({
      ...offer,
      terms: offer.terms.map((term) => (term.kind === "rate" ? preferTerm(term) : term)),
    })),
  };
}

function preferTerm(term: AtomicRateTerm): AtomicRateTerm {
  const authority = term.variants.filter(
    ({ observation }) => observation.source_ref === "openai-pricing",
  );
  if (authority.length === 0) return term;
  const variants: AtomicRateVariant[] = [];
  const raw_variants = [...term.raw_variants];
  for (const variant of term.variants) {
    if (variant.observation.source_ref !== "openai-overview") {
      variants.push(variant);
      continue;
    }
    // Equal quotes still use the primary page's billing basis. A card's broader token heading
    // must not create competing quantities for the exact same published schedule.
    const equal = authority.filter(
      (value) =>
        compatibleQuantity(variant, value) &&
        canonicalJson(variant.applicability) === canonicalJson(value.applicability) &&
        canonicalJson(variant.price) === canonicalJson(value.price),
    );
    const primary = equal[0];
    if (
      primary !== undefined &&
      equal.every(
        (value) =>
          canonicalJson(value.charge_binding ?? null) ===
          canonicalJson(primary.charge_binding ?? null),
      )
    ) {
      const { charge_binding: _binding, ...rest } = variant;
      variants.push({
        ...rest,
        ...(primary.charge_binding === undefined ? {} : { charge_binding: primary.charge_binding }),
      });
      continue;
    }
    // The primary page's lifetime-specific write schedule replaces a card's unqualified write
    // quote in the same execution scope. Keeping the card as another charge bills writes twice.
    const lifetimeSchedule =
      term.meter.namespace === "kmodels" &&
      term.meter.value === "cache_write_text" &&
      openAiCacheLifetime(variant.applicability) === undefined;
    const lifetimeScopes = new Set<string>();
    const scopedAuthority = authority.map((value) => {
      if (!lifetimeSchedule || openAiCacheLifetime(value.applicability) === undefined) return value;
      const applicability = withoutOpenAiCacheLifetime(value.applicability);
      lifetimeScopes.add(canonicalJson(applicability));
      return { ...value, applicability };
    });
    const overrides = scopedAuthority.filter(
      (value) =>
        compatibleQuantity(variant, value) &&
        applicabilitiesOverlap(variant.applicability, value.applicability) &&
        (canonicalJson(variant.price) !== canonicalJson(value.price) ||
          lifetimeScopes.has(canonicalJson(value.applicability))),
    );
    if (overrides.length === 0) {
      variants.push(variant);
      continue;
    }
    const remainder = subtractScopes(
      variant.applicability,
      overrides.map(({ applicability }) => applicability),
    );
    if (remainder === undefined) {
      raw_variants.push({
        impact: "base_price",
        reason: "unknown_applicability",
        possible_scope: variant.applicability,
        ...(variant.validity === undefined ? {} : { validity: variant.validity }),
        observation: rawEvidence(variant.observation),
      });
      continue;
    }
    if (remainder.length > 0) {
      const applicability = canonicalizeApplicability({ any_of: remainder });
      variants.push({
        ...variant,
        applicability,
        observation: withApplicability(variant.observation, applicability),
      });
    }
    const intersections = overrides.flatMap(({ applicability }) =>
      applicability.any_of.flatMap((right) =>
        variant.applicability.any_of.flatMap((left) =>
          clausesOverlap(left, right) ? [{ all_of: [...left.all_of, ...right.all_of] }] : [],
        ),
      ),
    );
    raw_variants.push({
      impact: "informational",
      reason: "superseded_value",
      resolution_policy: "openai_pricing_page_over_model_card",
      possible_scope: canonicalizeApplicability({ any_of: intersections }),
      ...(variant.validity === undefined ? {} : { validity: variant.validity }),
      observation: rawEvidence(variant.observation),
    });
  }
  return { ...term, variants, raw_variants };
}

function compatibleQuantity(left: AtomicRateVariant, right: AtomicRateVariant): boolean {
  return (
    canonicalJson(left.validity ?? null) === canonicalJson(right.validity ?? null) &&
    canonicalJson(left.price.denomination) === canonicalJson(right.price.denomination) &&
    canonicalJson(left.price.per) === canonicalJson(right.price.per)
  );
}

function clausesOverlap(left: Clause, right: Clause): boolean {
  return applicabilitiesOverlap({ any_of: [left] }, { any_of: [right] });
}

// A local authority operation: no new selector universe or negative categorical predicate is inferred.
function subtractScopes(
  base: PriceApplicability,
  overrides: readonly PriceApplicability[],
): Clause[] | undefined {
  const cuts = overrides
    .flatMap(({ any_of }) => any_of)
    .sort((left, right) => compareUtf8(canonicalJson(left), canonicalJson(right)));
  let remaining = base.any_of.filter(
    (clause) =>
      !cuts.some((cut) => applicabilityContainedIn({ any_of: [clause] }, { any_of: [cut] })),
  );
  for (const cut of cuts) {
    const next: Clause[] = [];
    for (const clause of remaining) {
      const parts = subtractClause(clause, cut);
      if (parts === undefined || next.length + parts.length > pricingLimits.applicabilityClauses)
        return;
      next.push(...parts);
    }
    remaining = next;
  }
  return remaining;
}

function subtractClause(base: Clause, cut: Clause): Clause[] | undefined {
  if (!clausesOverlap(base, cut)) return [base];
  if (applicabilityContainedIn({ any_of: [base] }, { any_of: [cut] })) return [];
  const parts: Clause[] = [];
  let intersection = base;
  for (const condition of cut.all_of) {
    const current = intersection.all_of.find(
      ({ dimension }) => canonicalJson(dimension) === canonicalJson(condition.dimension),
    );
    const outside = complement(current, condition);
    if (outside === undefined) return;
    for (const predicate of outside)
      if (clausesOverlap(intersection, { all_of: [predicate] }))
        parts.push(
          ...canonicalizeApplicability({
            any_of: [{ all_of: [...intersection.all_of, predicate] }],
          }).any_of,
        );
    if (!clausesOverlap(intersection, { all_of: [condition] })) return parts;
    const next = canonicalizeApplicability({
      any_of: [{ all_of: [...intersection.all_of, condition] }],
    }).any_of[0];
    if (next === undefined) return;
    intersection = next;
  }
  return parts;
}

function complement(
  current: PriceCondition | undefined,
  condition: PriceCondition,
): PriceCondition[] | undefined {
  if (condition.kind === "boolean") return [{ ...condition, value: !condition.value }];
  if (condition.kind === "categorical") {
    if (current?.kind !== "categorical") return;
    const removed = new Set(condition.values.map((value) => canonicalJson(value)));
    const values = current.values.filter((value) => !removed.has(canonicalJson(value)));
    return values.length === 0 ? [] : [{ ...current, values }];
  }
  const discrete =
    condition.dimension.namespace === "kmodels" &&
    condition.dimension.value === "context_tokens" &&
    isStandardUnit(condition.unit, "token");
  const result: PriceCondition[] = [];
  if (condition.lower !== undefined) {
    const lower = condition.lower;
    if (discrete && !/^\d+$/.test(lower.value)) return;
    const maximum = discrete ? BigInt(lower.value) - (lower.inclusive ? 1n : 0n) : undefined;
    if (maximum === undefined || maximum >= 0n)
      result.push({
        kind: "decimal_range",
        dimension: condition.dimension,
        unit: condition.unit,
        upper:
          maximum === undefined
            ? { ...lower, inclusive: !lower.inclusive }
            : { value: String(maximum), inclusive: true },
      });
  }
  if (condition.upper !== undefined) {
    const upper = condition.upper;
    if (discrete && !/^\d+$/.test(upper.value)) return;
    const minimum = discrete ? BigInt(upper.value) + (upper.inclusive ? 1n : 0n) : undefined;
    result.push({
      kind: "decimal_range",
      dimension: condition.dimension,
      unit: condition.unit,
      lower:
        minimum === undefined
          ? { ...upper, inclusive: !upper.inclusive }
          : { value: String(minimum), inclusive: true },
    });
  }
  return result;
}
