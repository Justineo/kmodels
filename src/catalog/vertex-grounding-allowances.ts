import { canonicalJson } from "./canonical-json.ts";
import { canonicalizeApplicability } from "./pricing-canonical.ts";
import { pricingBookId, pricingOfferId, pricingTermId } from "./pricing-identifiers.ts";
import type {
  AtomicPricingBook,
  AtomicPricingOffer,
  AtomicRawTerm,
  AtomicRawVariant,
} from "./pricing-assembly.ts";
import type { UnitExpression } from "./pricing-schema.ts";

interface AllowanceRule {
  key: string;
  quantity: string;
  reset: "daily" | "monthly";
  unit: UnitExpression;
}

const dailyPatterns = {
  "google-search": {
    flash:
      /Gemini 2\.0 Flash, 2\.5 Flash and 2\.5 Flash-Lite include a combined ([\d,]+) Grounding Prompts per day at no additional charge\./i,
    pro: /Gemini 2\.5 Pro includes ([\d,]+) Grounding Prompts per day at no additional charge\./i,
  },
  "google-maps": {
    flash: /Gemini Flash and Flash-Lite: combined ([\d,]+) grounded prompts per day\./i,
    pro: /Gemini Pro: ([\d,]+) grounded prompts per day\./i,
  },
};

function allowanceRule(
  fragment: string,
  model: string,
  service: string,
): AllowanceRule | undefined {
  const monthly = fragment.match(
    /Includes ([\d,]+) (?:Grounding|search) Queries per month at no charge, aggregated across all Gemini 3 models\./i,
  );
  if (monthly?.[1] !== undefined && /^vertex\/gemini-3[.-]/.test(model))
    return {
      key: `gemini-3-${service === "google-maps" ? "maps" : "web"}-monthly`,
      quantity: monthly[1].replaceAll(",", ""),
      reset: "monthly",
      unit: {
        factors: [
          {
            unit: { namespace: "provider", provider_id: "vertex", value: "search_unit" },
            power: 1,
          },
        ],
      },
    };
  if (service !== "google-search" && service !== "google-maps") return;
  const family = /^vertex\/gemini-(?:2\.0|2\.5)-flash(?:-|$)/.test(model)
    ? "flash"
    : /^vertex\/gemini-2\.5-pro(?:-|$)/.test(model)
      ? "pro"
      : undefined;
  if (family === undefined) return;
  const amount = fragment.match(dailyPatterns[service][family])?.[1];
  if (amount === undefined) return;
  return {
    key: `${service}-${family}-daily`,
    quantity: amount.replaceAll(",", ""),
    reset: "daily",
    unit: { factors: [{ unit: { namespace: "kmodels", value: "request" }, power: 1 }] },
  };
}

/** One pool covers all its model/service rate targets; consumers must not multiply it by model. */
export function bindVertexGroundingAllowances(books: AtomicPricingBook[]): void {
  const groups = new Map<
    string,
    Array<{
      book: AtomicPricingBook;
      offer: AtomicPricingOffer;
      term: AtomicRawTerm;
      raw: AtomicRawVariant;
      rule: AllowanceRule;
      targets: string[];
    }>
  >();
  for (const book of books) {
    if (book.scope.kind !== "provider_resource") continue;
    for (const offer of book.offers) {
      const model = offer.model_refs?.length === 1 ? offer.model_refs[0] : undefined;
      if (model === undefined) continue;
      for (const term of offer.terms) {
        if (term.kind !== "raw" || term.term_key !== "grounding_allowance") continue;
        for (const raw of term.variants) {
          const rule = allowanceRule(
            raw.observation.raw.fragment ?? "",
            model,
            book.scope.resource_key,
          );
          if (rule === undefined || raw.possible_scope === undefined) continue;
          const targets = offer.terms.flatMap((rate) =>
            rate.kind === "rate" &&
            rate.raw_variants.length === 0 &&
            rate.variants.length > 0 &&
            rate.variants.every(
              ({ price }) => canonicalJson(price.per) === canonicalJson(rule.unit),
            )
              ? [
                  pricingTermId(
                    pricingOfferId(pricingBookId("vertex", book.book_key), offer.offer_key),
                    "rate",
                    rate.term_key,
                  ),
                ]
              : [],
          );
          if (targets.length === 0) continue;
          const group = groups.get(rule.key) ?? [];
          group.push({ book, offer, term, raw, rule, targets });
          groups.set(rule.key, group);
        }
      }
    }
  }
  for (const [key, group] of groups) {
    const first = group[0];
    if (
      first === undefined ||
      group.some(({ rule }) => canonicalJson(rule) !== canonicalJson(first.rule))
    )
      continue;
    const refs = [...new Set(group.flatMap(({ offer }) => offer.model_refs ?? []))].sort();
    const host = group.find(({ book }) =>
      refs.every((ref) => book.scope.model_refs.includes(ref)),
    )?.book;
    if (host === undefined) continue;
    const applicability = canonicalizeApplicability({
      any_of: group.flatMap(({ raw }) => raw.possible_scope?.any_of ?? []),
    });
    const sources = [...new Set(group.map(({ raw }) => raw.observation.source_ref))].sort();
    const targets = [...new Set(group.flatMap(({ targets }) => targets))].sort();
    host.offers.push({
      offer_key: `allowance:${key}`,
      name: "Shared grounding allowance",
      model_refs: refs,
      billing_mode: { namespace: "kmodels", value: "usage" },
      states: [],
      relations: [],
      source_refs: sources,
      terms: [
        {
          kind: "allowance",
          term_key: "free-grounding-usage",
          source_refs: sources,
          raw_variants: [],
          variants: group.map(({ raw }) => ({
            benefit: {
              kind: "quantity",
              quantity: {
                value: { numerator: first.rule.quantity, denominator: "1" },
                unit: first.rule.unit,
              },
            },
            target: { kind: "rate_terms", term_refs: targets },
            reset: { namespace: "kmodels", value: first.rule.reset },
            applicability,
            observation: { ...raw.observation, establishes_applicability: applicability },
          })),
        },
      ],
    });
    for (const { offer, term, raw } of group) {
      term.variants = term.variants.filter((candidate) => candidate !== raw);
      if (term.variants.length === 0)
        offer.terms = offer.terms.filter((candidate) => candidate !== term);
    }
  }
}
