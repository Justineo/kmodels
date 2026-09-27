# @kmodels/pricing

An exact, synchronous request-cost calculator for Node and browsers. ESM, ES2023, with TypeScript declarations.

**The package contains no provider prices.** Your application supplies a calculation export, owns its retrieval and retention, and replaces the calculator when that data changes. There is no fetch client, automatic refresh, cache, persistence, or default catalog.

```ts
import { createCalculator, type CalculationRequest } from "@kmodels/pricing";

// priceData is JSON obtained and retained by your application.
const calculator = createCalculator(priceData);
const offers = calculator.listOffers({ modelRef: "provider/exact-model-id" });
// Select an exact offer and obtain its selectors from your request/accounting context.
const requirements = calculator.requirements({ offerRef: selectedOfferId, selectors });

const request: CalculationRequest = {
  evaluatedAt: "2026-09-05T12:00:00Z",
  components: [
    {
      id: "attempt-1",
      offerRef: selectedOfferId,
      selectors,
      quantities: [
        {
          signal: { namespace: "kmodels", value: "input_tokens" },
          value: { numerator: "10000", denominator: "1" },
        },
      ],
    },
  ],
};
const result = calculator.calculate(request);
// Missing required output/cache/tool measurements produce unresolved requirements.
// result.subtotals contains known amounts; result.totals exists only when complete.

const replacement = createCalculator(updatedPriceData);
// Your application can atomically replace its reference to calculator with replacement.
```

`createCalculator(unknown)` validates and privately clones the supplied data. `validatePriceData(unknown)` exposes the same validation separately. Returned offers and results cannot mutate the snapshot. `listOffers` never chooses a default or cheapest offer.

Use the standalone `/pricing/calculation/index.json` export or one or more whole `/pricing/calculation/providers/{provider}.json` partitions from the same snapshot. The audit-rich `/pricing/index.json` has a different schema and cannot initialize this package. Filtering rates or offers before initialization may remove applicable charges; applications must preserve complete provider partitions.

`requirements` reports selectors, alternative input sets, acquisition contracts, aggregation boundaries, related charges, and known gaps. Supply normalized measurements for one billing aggregation instance per component. A component ID identifies that instance; the application owns correlation of requests, attempts, result items, jobs, and sessions.

Results are `calculated`, `estimated`, `partial`, or `unknown`. Assumptions need an explanation and cannot overwrite measurements. Amounts use reduced integer-string fractions, retain currencies and provider credits separately, and receive no intermediate monetary rounding. Freshness is reported independently of calculation completeness.

The [language-neutral contract](CONTRACT.md), exported `schema.json`, `request.schema.json`, and synthetic `conformance.json` specify the portable evaluator. The conformance data uses a fictional `example` provider and is not a price catalog. Only Zod is a runtime dependency; frontend, collection, filesystem, and network dependencies are excluded.

This package reconstructs public request charges supported by the supplied evidence. Training, retained storage, provisioned capacity, subscriptions, private discounts, and invoice reconciliation are outside its contract. Registry publication is a separate release operation.
