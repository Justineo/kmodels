# @kmodels/pricing

An exact request-cost calculator for Node and browsers. Initialization is asynchronous; calculations are synchronous. ESM, ES2023, with TypeScript declarations and standard Web Crypto.

**The package contains no provider prices.** Your application supplies a calculation export, owns its retrieval and retention, and replaces the calculator when that data changes. There is no fetch client, automatic refresh, cache, persistence, or default catalog.

```ts
import { createCalculator, type CalculationRequest } from "@kmodels/pricing";

// priceData is JSON obtained and retained by your application.
const calculator = await createCalculator(priceData);
const offers = calculator.listOffers({ modelRef: "provider/exact-model-id" });
// Select an exact offer and obtain its selectors from your request/accounting context.
const invocation = {
  targetRef: selectedTargetId,
  caseRef: selectedCaseId,
  inputs: normalizedContextInputs,
  observed: observedInputs,
};
const bound = calculator.bindInvocation({ offerRef: selectedOfferId, invocation, selectors });
// Resolve bound.missingInputs from the declared context/accounting sources before calculating.
const requirements = calculator.requirements({ offerRef: selectedOfferId, invocation, selectors });

const request: CalculationRequest = {
  evaluatedAt: "2026-09-05T12:00:00Z",
  components: [
    {
      id: "attempt-1",
      offerRef: selectedOfferId,
      invocation,
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

const replacement = await createCalculator(updatedPriceData);
// Your application can atomically replace its reference to calculator with replacement.
```

`await createCalculator(unknown)` validates and privately clones the supplied data. `await validatePriceData(unknown)` exposes the same validation separately. Returned offers and results cannot mutate the snapshot. `listOffers` never chooses a default or cheapest offer.

Use the standalone `/pricing/v2/calculation/index.json` export or one or more whole `/pricing/v2/calculation/providers/{provider}.json` partitions from the same snapshot. The audit-rich `/pricing/v2/index.json` has a different schema and cannot initialize this package. Filtering rates or offers before initialization may remove applicable charges; applications must preserve complete provider partitions and verify downloaded resource hashes against their accepted publication manifest.

`listInvocationBindings()` exposes exact target/case/offer joins. Bound offers require explicit invocation selection. Fixed selectors cannot be overridden; context and observed inputs use separate maps of normalized categorical values. Ordinary selectors cannot bypass missing invocation inputs. A selected price does not establish account access or successful execution. Offers without invocation bindings can still be calculated by exact offer reference, without a callability claim.

Use `assessInvocations(provider.invocation, query, policy)` to inspect support, configuration,
lifecycle and scoped capabilities separately. It exposes an addressing template only when the
documented case and caller context satisfy those requirements. Deployment/runtime confirmations
belong to the caller and must match the exact selected resource and model. Templates supply URL,
method, headers and identifier body fields; your application supplies the task payload and
authentication. No network request is made.

`requirements` reports selectors, alternative input sets, acquisition contracts, aggregation boundaries, related charges, and known gaps. Supply normalized measurements for one billing aggregation instance per component. A component ID identifies that instance; the application owns correlation of requests, attempts, result items, jobs, and sessions.

Results are `calculated`, `estimated`, `partial`, or `unknown`. Assumptions need an explanation and cannot overwrite measurements. Amounts use reduced integer-string fractions, retain currencies and provider credits separately, and receive no intermediate monetary rounding. Freshness is reported independently of calculation completeness.

`CalculationComponent` is an input type: defaulted arrays may be omitted. Checking `result.status` for `calculated` or `estimated` makes `result.totals` available without an assertion. Charges retain their `unitPrice`, applied `binding`, and contribution/rate/binding evidence for auditing.

Rate requirements include scoped `selectorSources`; contribution requirements include scoped `referencedRates`. Allowance requirements expose `benefit`, `target`, and `reset`, with known unsupported mechanisms in `gaps`. An empty discovery gap list does not guarantee that calculation will resolve usage, validity or linked-component requirements.

Version `1.0.0` accepts calculation schema `2.0` at its default entry. Results add complete v2 snapshot hashes and component `invocationSelections`. The explicit `@kmodels/pricing/v1` entry retains synchronous initialization and accepts only schema `1.0`; its legacy schemas, conformance data and [contract](v1/CONTRACT.md) are under `v1/`. The two readers reject each other's data. Update imports to `/v1` to keep an existing 1.0 consumer, or obtain a v2 export and await initialization to migrate. Never relabel a legacy export as v2.

The [language-neutral contract](CONTRACT.md), exported `schema.json`, `request.schema.json`, and synthetic `conformance.json` specify the portable evaluator. The conformance data uses a fictional `example` provider and is not a price catalog. Only Zod is a runtime dependency; frontend, collection, filesystem, and network dependencies are excluded.

This package reconstructs public request charges supported by the supplied evidence. Training, retained storage, provisioned capacity, subscriptions, private discounts, and invoice reconciliation are outside its contract. Registry publication is a separate release operation.
