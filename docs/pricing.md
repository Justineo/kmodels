# Pricing data model

Status: proposal; not implemented

This document proposes the next pricing schema for Kmodels. It is intentionally
more expressive than the current flat `PriceRate[]` representation. It becomes a
repo-wide decision only after adoption in `design.md` and implementation in the
public schema.

## Problem

Provider pricing is not a single input/output token tuple. Official price books
also contain:

- cache read, cache write, and time-based cache storage;
- batch, flex, priority, reserved, and provisioned service tiers;
- request-context and monthly-volume bands;
- regional, deployment, endpoint, route, and data-residency variants;
- text, audio, image, video, character, page, frame, duration, and operation
  meters;
- tool, search, OCR, rerank, embedding, training, and hosting charges;
- fixed capacity prices, provider credits, free allowances, promotions, and
  custom quotes;
- prices derived from an officially published multiplier rather than an
  independently published amount.

The current rate list preserves many individual facts, but it cannot reliably
say which input, output, cache, and fixed rates form one coherent purchasing
option. Consumers can therefore combine rates from different regions or service
tiers into a price tuple the provider never offered.

## Goals

The schema must:

1. Preserve an official rate without forcing it into token pricing.
2. Keep related charges in one coherent offer.
3. Preserve exact applicability conditions without creating cross-products.
4. Distinguish alternative plans from additive charges and allowances.
5. Retain source-level evidence and deterministic derivations.
6. Support comparison views without making the comparison view canonical.
7. Fail closed when a published billing mechanism cannot be represented.

The schema is not an invoice calculator. It does not model account-specific
discounts, taxes, exchange rates, negotiated commitments, or usage not published
by an allowlisted official source.

## Principles

- Store decimals as strings and perform arithmetic with decimal-string helpers.
- Preserve the provider's billing denomination. DBU and similar credits are not
  currencies and must not be converted to USD.
- Treat every condition array as a conjunction. A set-valued condition is the
  only disjunction inside one condition.
- Keep region and deployment facts on the same offer. Never flatten them into
  independent arrays.
- A zero amount is a price only when the source explicitly publishes zero.
- Collection time is provenance, not an effective date.
- `derived` is rate provenance, not a model-level pricing status.
- The website's input, output, and cached-input columns are projections over the
  canonical offers, never the canonical data model.

## Proposed public shape

`ProviderModel.pricing_status` remains a compact coverage summary.
`ProviderModel.pricing` becomes an array of coherent offers:

```ts
type Decimal = string;

type PricingStatus =
  "published" | "free" | "not_published" | "not_applicable" | "custom_quote" | "unknown";

interface PricingOffer {
  id: string;
  kind: "plan" | "add_on" | "allowance";
  name?: string;
  selection_group?: string;
  applies_to_offer_ids?: string[];
  conditions: PriceCondition[];
  rates: PriceRate[];
  valid_from?: string;
  valid_until?: string;
  source_refs: string[];
}
```

The fields have these semantics:

- `plan` is a complete purchasing mode, such as on-demand standard inference,
  batch, priority, or provisioned capacity.
- `add_on` is additive to an applicable plan, such as web search or grounding.
- `allowance` grants an explicitly published quantity and is not represented as
  a zero-valued rate.
- Plans in the same `selection_group` are alternatives. Conditions may select
  the applicable alternative automatically, as with a context threshold.
- `applies_to_offer_ids` limits an add-on or allowance to specific plans. An
  omitted field means it can apply to every otherwise compatible plan.
- `name` is included only when the provider publishes a useful plan label.
- Validity bounds are included only when explicitly published. They use
  inclusive `valid_from` and exclusive `valid_until` semantics.

Offer IDs are stable internal identifiers. They are derived from the provider
model, offer kind, selection group, and canonical conditions, but not from the
price amount or observation timestamp. A price change therefore updates an
offer instead of creating a new identity.

## Rates

A rate is one atomic charge or allowance quantity inside an offer:

```ts
interface PriceRate {
  id: string;
  meter: PriceMeter;
  amount: PriceAmount;
  per: BillingQuantity;
  conditions: PriceCondition[];
  source_refs: string[];
  raw_price?: string;
  raw_unit?: string;
  derivation?: PriceDerivation;
}

type PriceAmount = {
  value: Decimal;
  denomination: { kind: "fiat"; currency: string } | { kind: "provider_credit"; code: string };
};

type BillingQuantity = {
  value: Decimal;
  unit: BillingUnit;
};
```

`amount.value` is the amount charged per `per.value` units. For example,
USD 2 per one million tokens is represented as amount `"2"`, quantity
`"1000000"`, and unit `token`. Composite units such as `million_tokens` are not
needed.

```ts
type BillingUnit =
  { kind: "standard"; unit: StandardBillingUnit } | { kind: "provider"; unit: string };

type StandardBillingUnit =
  | "token"
  | "character"
  | "image"
  | "page"
  | "request"
  | "search_unit"
  | "second"
  | "minute"
  | "frame"
  | "megapixel"
  | "video"
  | "byte_hour"
  | "token_hour"
  | "unit_hour"
  | "unit_month";
```

The provider-unit escape hatch preserves an official unit that has no reviewed
normalization. It is valid only with the exact raw unit and must produce a
coverage warning so common units can be added deliberately.

## Meters

Meters describe why usage is billed; quantities describe how it is measured.
This separation avoids a growing enum such as `million_audio_tokens`.

```ts
type PriceMeter =
  | {
      kind: "model_io";
      direction: "input" | "output";
      modality: "text" | "image" | "audio" | "video" | "pdf";
      cache?: "read" | "write";
    }
  | { kind: "cache_storage"; modality: "text" | "image" | "audio" | "video" }
  | {
      kind: "operation";
      operation:
        | "embedding"
        | "rerank"
        | "ocr"
        | "search"
        | "tool_call"
        | "image_generation"
        | "video_generation"
        | "speech_generation"
        | "transcription"
        | "translation"
        | "request";
    }
  | { kind: "training"; resource: "tokens" | "compute" }
  | { kind: "capacity"; resource: "gpu" | "instance" | "throughput" }
  | { kind: "provider"; meter: string };
```

The provider-meter escape hatch follows the same rule as provider units: retain
the exact official label and warn. It must not silently map an unknown charge to
a semantically different standard meter.

## Conditions

Conditions are typed predicates rather than a growing object of optional
properties:

```ts
type ValueDimension =
  | "billing_mode"
  | "service_tier"
  | "region"
  | "endpoint"
  | "deployment_type"
  | "deployment_scope"
  | "inference_geo"
  | "route_provider"
  | "operation"
  | "modality"
  | "quality"
  | "resolution"
  | "style"
  | "capacity"
  | "cache_ttl";

type RangeDimension =
  "context_tokens" | "input_tokens" | "output_tokens" | "monthly_usage" | "duration_seconds";

type PriceCondition =
  | {
      kind: "value";
      dimension: ValueDimension;
      value: string;
    }
  | {
      kind: "set";
      dimension: ValueDimension;
      values: string[];
    }
  | {
      kind: "range";
      dimension: RangeDimension;
      min?: Decimal;
      max?: Decimal;
      min_inclusive: boolean;
      max_inclusive: boolean;
    }
  | {
      kind: "flag";
      dimension: "promotion" | "audio" | "video_input" | "voice_control";
      value: boolean;
    }
  | {
      kind: "provider";
      dimension: string;
      value: string;
    };
```

All offer conditions and rate conditions apply together. Common plan dimensions
belong on the offer; a condition belongs on a rate only when it applies to that
charge alone. For example, a five-minute cache-write TTL belongs on the
cache-write rate, while a long-context threshold that changes both input and
output prices belongs on the offer.

Provider-specific conditions are preserved exactly and warned. A new standard
dimension is added only after at least one official source gives it stable,
provider-neutral semantics.

## Derivation

When a provider publishes a relative pricing rule, Kmodels publishes the exact
computed amount and the machine-readable derivation:

```ts
interface PriceDerivation {
  base_rate_id: string;
  steps: DerivationStep[];
}

type DerivationStep =
  | { kind: "multiply"; value: Decimal; source_refs: string[] }
  | { kind: "add"; value: Decimal; source_refs: string[] };
```

The base rate and every derivation step must resolve to official evidence. The
derived rate's `source_refs` is the union of the base rate and rule sources. If a
provider independently publishes the final amount, that amount is `published`,
not `derived`, even when it happens to equal a known multiplier.

Derivations form an acyclic graph and are evaluated only with decimal-string
arithmetic. A source rule that cannot be represented exactly is retained as a
warning rather than approximated.

## Pricing status

`pricing_status` summarizes evidence; it does not replace offers:

- `published`: at least one current or future numeric plan is published. Mixed
  free and paid plans also use this state.
- `free`: the provider explicitly states that the complete applicable offering
  is free, not merely that it has a free allowance.
- `custom_quote`: the provider explicitly requires negotiated pricing.
- `not_published`: the provider acknowledges a hosted commercial offering but
  publishes no amount and no explicit custom-quote instruction.
- `not_applicable`: the catalog entry is not a provider-hosted billable offering.
- `unknown`: configured official sources do not establish pricing semantics.

The current `derived` aggregate status is removed. Derivation is a property of an
individual rate, and one model may contain both published and derived rates.

## Provenance

Provenance remains additive at every useful level:

- A model retains every successfully matched source in `model.source_refs`.
- An offer retains every source that establishes the offer or its common
  conditions.
- A rate retains only sources that establish its amount, unit, meter, or
  rate-specific conditions.
- A derived rate retains both its base-price source and every rule source.

Removing a source from the manifest removes its stale references on the next
successful provider refresh. Optional authenticated inventories remain
non-persistent and cannot introduce account-private prices into the global
catalog.

## Examples

### Standard token plan

```json
{
  "id": "standard-global",
  "kind": "plan",
  "selection_group": "inference",
  "conditions": [{ "kind": "value", "dimension": "service_tier", "value": "standard" }],
  "rates": [
    {
      "id": "standard-input-text",
      "meter": { "kind": "model_io", "direction": "input", "modality": "text" },
      "amount": { "value": "2", "denomination": { "kind": "fiat", "currency": "USD" } },
      "per": { "value": "1000000", "unit": { "kind": "standard", "unit": "token" } },
      "conditions": [],
      "source_refs": ["provider-pricing"]
    },
    {
      "id": "standard-output-text",
      "meter": { "kind": "model_io", "direction": "output", "modality": "text" },
      "amount": { "value": "8", "denomination": { "kind": "fiat", "currency": "USD" } },
      "per": { "value": "1000000", "unit": { "kind": "standard", "unit": "token" } },
      "conditions": [],
      "source_refs": ["provider-pricing"]
    }
  ],
  "source_refs": ["provider-pricing"]
}
```

### Long-context alternatives

Two plans share `selection_group: "inference"`. The first has
`context_tokens <= 200000`; the second has `context_tokens > 200000`. Each plan
contains its own input, output, and cache rates. This preserves the official
tuples and prevents a consumer from combining short-context input with
long-context output.

### Published batch multiplier

A batch plan contains materialized rates. Each rate references the corresponding
standard rate and a `multiply` step with value `"0.5"`. The step cites the batch
discount source, while the derived rate cites both the price table and batch
documentation.

### Provider credits and provisioned capacity

A Databricks DBU amount uses `provider_credit: { code: "DBU" }`. A provisioned
offer uses a capacity meter and a per-unit-hour or per-unit-month quantity. No
exchange rate or implied utilization is invented.

### Free allowance

A monthly free quota is an `allowance` with the granted quantity and a monthly
condition. Paid usage remains a separate `plan`; the model's status is
`published`, not `free`.

## Projection for the website

The compact table continues to show input, output, and cached-input columns. A
column may display a numeric value only when exactly one current offer qualifies:

1. `kind` is `plan`;
2. the plan is the reviewed default on-demand/standard offering;
3. the rate is the corresponding text model-I/O meter;
4. no unresolved region, route, context, volume, or provider-specific condition
   remains.

If several distinct values qualify, the table displays `multiple`; if no value
is established, it displays an em dash. Details group all rates by offer and
show conditions, validity, denomination, raw unit, derivation, and sources.
Kmodels never chooses the cheapest rate or the first parsed rate.

## Validation

Publication must reject a provider candidate when:

- an amount or quantity is not an exact non-negative decimal string;
- `per.value` is zero;
- an offer or rate ID is duplicated within one model;
- a source reference does not resolve;
- validity bounds are reversed;
- a range is empty or contradictory;
- identical rate identities in one offer have conflicting amounts;
- a derivation references a missing rate, changes denomination, or contains a
  cycle;
- `free` lacks explicit zero-price/free evidence;
- `not_applicable`, `custom_quote`, or `unknown` contains numeric plans;
- an unknown official unit, meter, or condition is dropped instead of retained
  through its provider escape hatch and warning.

Price-change quarantine compares rates by stable semantic identity: offer kind,
selection group, canonical conditions, meter, denomination, and quantity. The
price amount is deliberately excluded from identity so a change is detected as
a change rather than as one deletion plus one insertion.

## Migration

1. Add the offer schema behind a new static API version while retaining the
   current endpoints as a compatibility projection.
2. Add shared constructors, canonical condition ordering, decimal validation,
   stable IDs, and derivation evaluation.
3. Migrate one provider adapter at a time. Grouping must come from the provider's
   table/card structure; a generic migration must not guess which legacy rates
   form an offer.
4. Add fixtures for standard plans, context bands, regional plans, cache TTLs,
   additive tools, batch derivation, promotions, free allowances, provider
   credits, and provisioned capacity.
5. Switch the website and public catalog only after every configured provider
   emits validated offers.
6. Remove the flat legacy schema and projection once no public consumer depends
   on it; do not retain two canonical pricing models.

Adoption of this proposal changes repo-wide public data semantics and therefore
requires the same change to update `design.md`.
