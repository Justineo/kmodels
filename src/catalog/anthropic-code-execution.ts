import { unconditionalApplicability } from "./pricing-canonical.ts";
import { pricingBookId, pricingOfferId, pricingTermId } from "./pricing-identifiers.ts";
import { multiplyRationals, rationalFromDecimal } from "./pricing-rational.ts";
import type {
  PriceAllowanceTerm,
  ProviderAtomRegistryEntry,
  RawPriceObservation,
  UnitExpression,
  UsageSignal,
} from "./pricing-schema.ts";
import type { SourcePriceFact } from "./pricing-source.ts";

const secondUnit: UnitExpression = {
  factors: [{ unit: { namespace: "kmodels", value: "second" }, power: 1 }],
};
const providerSignal = (value: string): Extract<UsageSignal, { namespace: "provider" }> => ({
  namespace: "provider",
  provider_id: "anthropic",
  value,
});

/** Commercial numbers have already been recognized in the owned pricing section. */
export function anthropicCodeExecution(
  rate: SourcePriceFact,
  minimumMinutes: string | undefined,
  freeHours: string | undefined,
): {
  rate: SourcePriceFact;
  allowance_terms: PriceAllowanceTerm[];
  vocabulary: ProviderAtomRegistryEntry[];
} {
  const evidence = (fragment: string): RawPriceObservation => ({
    source_ref: rate.source_ref,
    locator: {
      kind: "fragment",
      value: "/docs/en/agents-and-tools/tool-use/code-execution-tool.md#usage-and-pricing",
    },
    raw: { fragment },
  });
  const vocabulary: ProviderAtomRegistryEntry[] = [];
  if (minimumMinutes !== undefined) {
    const active = providerSignal("code_execution_active_seconds");
    const billable = providerSignal("code_execution_billable_seconds");
    vocabulary.push(
      {
        kind: "usage_signal",
        key: active.value,
        definition:
          "Standalone Code Execution duration tracked by Anthropic accounting but not reported by Messages usage",
        unit: secondUnit,
        resolution_phase: "account",
      },
      {
        kind: "usage_signal",
        key: billable.value,
        definition: "Standalone Code Execution duration after the published per-container minimum",
        unit: secondUnit,
        resolution_phase: "account",
      },
      {
        kind: "aggregation",
        key: "code_execution_container",
        definition: "One independently billed standalone Code Execution container",
      },
    );
    rate = {
      ...rate,
      charge_binding: {
        signal: billable,
        aggregation: {
          namespace: "provider",
          provider_id: "anthropic",
          value: "code_execution_container",
        },
        quantity_methods: [
          {
            calculation: {
              nodes: [
                { op: "signal", signal: active },
                {
                  op: "minimum",
                  input: 0,
                  value: multiplyRationals(rationalFromDecimal(minimumMinutes), {
                    numerator: "60",
                    denominator: "1",
                  }),
                },
              ],
              result: 1,
            },
          },
        ],
        observations: [
          evidence(`${minimumMinutes}-minute minimum execution time`),
          evidence(
            "Messages usage reports code-execution request count, not billable container duration",
          ),
        ],
      },
    };
  }
  const offerId = pricingOfferId(
    pricingBookId("anthropic", "service:code-execution"),
    "standalone",
  );
  const allowance_terms: PriceAllowanceTerm[] =
    freeHours === undefined
      ? []
      : [
          {
            id: pricingTermId(offerId, "allowance", "monthly-container-allowance"),
            term_key: "monthly-container-allowance",
            kind: "allowance",
            source_refs: [rate.source_ref],
            variants: [
              {
                benefit: {
                  kind: "quantity",
                  quantity: {
                    value: multiplyRationals(rationalFromDecimal(freeHours.replaceAll(",", "")), {
                      numerator: "3600",
                      denominator: "1",
                    }),
                    unit: secondUnit,
                  },
                },
                target: {
                  kind: "rate_terms",
                  term_refs: [pricingTermId(offerId, "rate", "container_runtime")],
                },
                reset: { namespace: "kmodels", value: "monthly" },
                applicability: unconditionalApplicability,
                observations: [
                  {
                    ...evidence(`${freeHours} free container-hours per organization per month`),
                    establishes_applicability: unconditionalApplicability,
                  },
                ],
              },
            ],
            raw_variants: [],
          },
        ];
  return { rate, allowance_terms, vocabulary };
}
