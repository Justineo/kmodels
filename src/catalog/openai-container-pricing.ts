import { multiplyRationals, rationalFromDecimal } from "./pricing-rational.ts";
import type {
  ChargeBinding,
  ProviderAtomRegistryEntry,
  RawPriceObservation,
  UnitExpression,
  UsageSignal,
} from "./pricing-schema.ts";

const seconds: UnitExpression = {
  factors: [{ unit: { namespace: "kmodels", value: "second" }, power: 1 }],
};
const active: Extract<UsageSignal, { namespace: "provider" }> = {
  namespace: "provider",
  provider_id: "openai",
  value: "container_session_seconds_before_minimum",
};
const billed: Extract<UsageSignal, { namespace: "provider" }> = {
  namespace: "provider",
  provider_id: "openai",
  value: "container_session_billable_seconds",
};

/** The source has already established minute billing and agreement on its minimum. */
export function openAiContainerMinimum(
  minimumMinutes: string,
  observations: RawPriceObservation[],
): { charge_binding: ChargeBinding; vocabulary: ProviderAtomRegistryEntry[] } {
  return {
    charge_binding: {
      signal: billed,
      aggregation: "session",
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
      observations,
    },
    vocabulary: [
      {
        kind: "usage_signal",
        key: active.value,
        definition:
          "Provider-billed session minutes expressed in seconds before the session minimum; caller supplies billing granularity, not wall-clock time",
        unit: seconds,
        resolution_phase: "outcome",
      },
      {
        kind: "usage_signal",
        key: billed.value,
        definition: "Provider-billed container session seconds after the published minimum",
        unit: seconds,
        resolution_phase: "outcome",
      },
    ],
  };
}
