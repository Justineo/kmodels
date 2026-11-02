# @kmodels/pricing

An exact, synchronous request-cost calculator for Node and browsers. ESM, ES2023, with TypeScript declarations.

`createInferencePriceLookup(priceData, mappingData)` also resolves exact provider inference IDs to
these existing prices. Supply the optional `/pricing/inference.json` mapping from the same catalog
and price snapshot. The lookup returns applicable candidates, missing pricing conditions, evidence,
and a `matched`, `candidates`, or `unknown` status; it does not infer price identity from names.
Usage quantities and exact cost calculation remain separate.
Pass the candidate's `offer.id` as `offer_ref` to select a commercial offer, such as Messages or Batch.
Without it, multiple offers remain candidates with `requires_offer_choice: true`.
Each candidate identifies its owning `book_ref` and contains applicable offer terms/variants.
Its `selectors` combine ID-fixed pricing conditions with your runtime conditions; conflicting
values reject the association. Use those complete selectors for calculation, including conditions
you did not need to supply because the ID already fixes them. Every lookup result includes its
calculation `snapshot` identity and normalized `evaluated_at`. A catalog ID or alternate identifier
alone does not establish a request-ID mapping.

**The package contains no provider prices.** Your application supplies a calculation export, owns its retrieval and retention, and replaces the calculator when that data changes. There is no fetch client, automatic refresh, cache, persistence, or default catalog.

```ts
import {
  createCalculator,
  createInferencePriceLookup,
  type CalculationRequest,
} from "@kmodels/pricing";

// Your application obtains and retains a complete price export and its bound mapping.
let runtime = {
  calculator: createCalculator(priceData),
  lookup: createInferencePriceLookup(priceData, mappingData),
};
const evaluatedAt = "2026-09-05T12:00:00Z";
const current = runtime;
const resolution = current.lookup({
  provider_id: "provider",
  model_id: "exact-request-id",
  selectors: runtimeSelectors,
  evaluated_at: evaluatedAt,
  // If needed, supply offer_ref after choosing an offer from an earlier result.
});
if (resolution.status !== "matched" || resolution.candidates.length !== 1) {
  // Handle unknown evidence, missing conditions, offer choices or price conflicts.
  throw new Error("Resolve the pricing candidates before calculation");
}
const [candidate] = resolution.candidates;
if (candidate === undefined) throw new Error("Missing matched price candidate");
const { calculator } = current;
const requirements = calculator.requirements({
  offerRef: candidate.offer.id,
  selectors: candidate.selectors,
});

const request: CalculationRequest = {
  evaluatedAt: resolution.evaluated_at,
  components: [
    {
      id: "attempt-1",
      offerRef: candidate.offer.id,
      selectors: candidate.selectors,
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

const replacement = {
  calculator: createCalculator(updatedPriceData),
  lookup: createInferencePriceLookup(updatedPriceData, updatedMappingData),
};
runtime = replacement;
// Keep each request's lookup and calculation on the same captured runtime instance.
```

`createCalculator(unknown)` validates and privately clones the supplied data. `validatePriceData(unknown)` exposes the same validation separately. Returned offers and results cannot mutate the snapshot. `listOffers` never chooses a default or cheapest offer.

Use the standalone `/pricing/calculation/index.json` export or one or more whole `/pricing/calculation/providers/{provider}.json` partitions from the same snapshot. The audit-rich `/pricing/index.json` has a different schema and cannot initialize this package. Filtering rates or offers before initialization may remove applicable charges; applications must preserve complete provider partitions.

`requirements` reports selectors, alternative input sets, acquisition contracts, aggregation boundaries, related charges, and known gaps. Supply normalized measurements for one billing aggregation instance per component. A component ID identifies that instance; the application owns correlation of requests, attempts, result items, jobs, and sessions.

Results are `calculated`, `estimated`, `partial`, or `unknown`. Assumptions need an explanation and cannot overwrite measurements. Amounts use reduced integer-string fractions, retain currencies and provider credits separately, and receive no intermediate monetary rounding. Freshness is reported independently of calculation completeness.

`CalculationComponent` is an input type: defaulted arrays may be omitted. Checking `result.status` for `calculated` or `estimated` makes `result.totals` available without an assertion. Charges retain their `unitPrice`, applied `binding`, and contribution/rate/binding evidence for auditing.

Rate requirements include scoped `selectorSources`; contribution requirements include scoped `referencedRates`. Allowance requirements expose `benefit`, `target`, and `reset`, with known unsupported mechanisms in `gaps`. An empty discovery gap list does not guarantee that calculation will resolve usage, validity or linked-component requirements.

Version `0.2.0` retains schema `1.0` for valid data and requests. It tightens invalid selector mapping rejection and adds output metadata. The TypeScript result/requirement unions and optional component arrays may require changes to custom mocks, interface extensions and helpers that read those arrays; strict output decoders must accept the new fields. See the contract's compatibility section.

The [language-neutral contract](CONTRACT.md), exported `schema.json`, `request.schema.json`, and synthetic `conformance.json` specify the portable evaluator. The conformance data uses a fictional `example` provider and is not a price catalog. Only Zod is a runtime dependency; frontend, collection, filesystem, and network dependencies are excluded.

This package reconstructs public request charges supported by the supplied evidence. Training, retained storage, provisioned capacity, subscriptions, private discounts, and invoice reconciliation are outside its contract. Registry publication is a separate release operation.
