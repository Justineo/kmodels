# Commercial topology

Status: current boundary; configured-provider adapters implemented

This document defines which public prices Kmodels admits and how every provider maps them into one
shared model. [Pricing](pricing.md) owns the exact wire. Provider documents own source authority,
identity matching, and vocabulary mappings.

## Purpose

Kmodels is an AI Gateway rate book. Its job is to publish the rates, selectors, required usage
inputs, and bounded calculation contracts from which a consumer can reconstruct the public list
cost of a proxied upstream request, an asynchronous result item, or a provider-hosted component
caused by that request. It does not observe a request lifecycle, store a usage ledger, or reconcile
an invoice.

The handoff to a calculator is explicit. For each applicable rate variant, Kmodels publishes:

- the exact rate, denominator, applicability, and validity;
- the final billable usage signal and its aggregation boundary;
- zero or more alternative quantity methods, including exact source locators and bounded arithmetic;
- selector sources where the provider returns a value needed to choose the variant; and
- source observations proving each price, mapping, and calculation.

The calculator supplies one evaluation record containing the chosen route/request selectors and
the observed signal values it could collect. It may obtain them from an API response, terminal
stream event, asynchronous result, account report, invocation log, or telemetry. Kmodels reports
which alternatives are sufficient and which signals remain missing; it does not prescribe how that
record is captured, stored, retried, or reconciled. Correlation IDs and account-billing joins remain
downstream operational data unless they are themselves required to select or calculate a public
rate.

Price books remain provider-owned. Kmodels neither constructs nor promises a continuously updated
cross-provider identity for an allegedly equivalent model; consumers that need such product
comparison own that separate, policy-driven mapping.

This boundary is narrower than the wire's representational capacity. Existing shared types may
decode broader facts while providers converge, but new collection work must not publish a fact only
because the schema can express it.

## Admission boundary

Admit a commercial fact only when all of these are true:

1. it prices a callable inference operation or a provider-hosted component attributable to one
   proxied request or completed asynchronous item;
2. the public rate is established by first-party evidence;
3. its applicability can be selected from the proxied request or route configuration, or established
   from the response, result item, or provider-reported usage; and
4. it can be represented as a rate or exact non-numeric state without allocating an account-level
   commitment.

This includes:

- on-demand, Batch, and realtime model inference;
- input, output, cache, media, request, and duration rates used by those operations;
- request-visible dimensions such as model, route, region, endpoint, service tier, context band,
  cache mode, modality, quality, and resolution;
- provider-published recurring billing periods when the exact daily UTC rule is recorded beside a
  categorical selector and no collection-time or viewer-time evaluation is performed;
- separately priced request components such as provider-hosted web search, grounding, reranking,
  guardrails, code execution, or tool calls when their trigger is exact; and
- automatic downstream model or service usage when first-party evidence identifies both the
  component and its request-visible quantity.

Exclude:

- training, fine-tuning jobs, checkpoints, model import, and artifact distribution;
- storage retained beyond the request and general data-transfer products;
- provisioned capacity, reserved throughput, subscriptions, seats, support plans, and commitments;
- account resources, balances, credits, private offers, negotiated discounts, taxes, invoices, and
  settlement order;
- surcharges whose applicability depends on a provider-account setting that the proxied request,
  route configuration, response, result item, and usage record do not establish;
- orchestration products whose total platform activity cannot be attributed to the proxied model
  request; and
- formulas that require workload forecasting or amortizing a fixed charge across requests.

An excluded fact is outside scope, not `unknown` pricing. It is discarded rather than preserved as
raw commercial data. A temporarily missing or unsupported fact inside the boundary remains unknown
or raw at the smallest affected scope.

## Shared model

Every provider uses the same ownership hierarchy:

```text
provider snapshot
  -> price book
       -> offer
            -> term
                 -> applicability-qualified variant
```

- A **book** owns one admitted model or one separately priced request service.
- An **offer** is one selectable invocation mechanism, such as on-demand, Batch, or a service call.
- A **term** is one rate, exact price state, allowance that applies directly to admitted request
  usage, contribution, or bounded raw fact.
- A **variant** holds the exact rate or state under one applicability and validity scope.

Provider differences do not create provider-specific pricing models. They appear only as
provider-owned vocabulary where a shared semantic would be false: dimension values, meters, usage
signals, resource keys, and source-native evidence.

This hierarchy is the stable core. Relations, contributions, allowances, resource edges, and
settlement fields remain optional wire capabilities; a provider review must not populate them just
to make its commercial graph look complete. Most directly invoked model rates need only a model
book, one or more invocation offers, rate terms, and applicability variants.

### Offers and dimensions

Use separate offers when the caller selects a different API mechanism or separately billed service.
Use variants when the same mechanism changes rate by Region, context, tier, cache class, modality,
quality, or another request/outcome dimension. Batch is an offer when it is a distinct asynchronous
mechanism; a price-table column is not by itself an offer.

Do not materialize every possible Cartesian product. Store each official rate with only the
conditions that qualify it. The UI resolves compatible variants from the dimensions relevant to
that book.

### Rates, meters, and usage

A rate separates:

- the amount and denomination;
- the billed meter, such as input text, output text, cached input, generated image, web search, or a
  precise provider-owned operation;
- the denominator, such as token, request, image, page, or second; and
- applicability conditions.

A charge binding optionally connects the rate to a billable result signal and aggregation boundary.
Its quantity methods are alternative acquisition paths: each path may consume that signal directly
or derive it with a bounded exact-rational graph, and may map every required input to first-party
request, response, stream, result, account-report, invocation-log, or versioned OTel fields. The
bundled pure evaluator defines the calculation semantics and rejects conflicting results from two
available paths. The Gateway remains responsible for collecting those inputs and deciding how to
handle an interrupted or incomplete request.

The graph admits only reviewed operations. Its product form multiplies one quantity by `item`
counts, for example seconds requested per video by successfully returned videos; it is not a
general dimensional-expression language.

Provider-field mappings may use only the closed collection reductions defined by the shared wire
and may treat absence as zero only for an evidenced filtered collection. This keeps source
extraction declarative and bounded while still covering image counts, successful-result presence,
and unique search-query counts.

Rate selector sources separately map applicability dimensions to first-party fields. Accounting
contracts are collected independently from rate tables, so drift removes only the affected input
or selector mapping and never turns a still-valid price into raw pricing. Use a shared signal only
when providers mean the same counter and trigger. Ordinary caller-defined functions do not become
billable tool calls unless the provider prices that exact event.

OpenTelemetry is a supported mapping target, not the canonical signal model. Its GenAI conventions
cover a useful token subset but not all request-attributable commercial quantities. Kmodels retains
its own stable usage vocabulary and records OTel attributes only where their published semantics are
an exact match.

Numeric rates remain useful when their signal is not yet bound. The missing binding is local and
must not erase the rate or sibling terms.

### Request services and composition

A separately priced request component gets its own service book instead of being flattened into
token pricing. Exact model references on that book are sufficient when they fully express
compatibility. Add a relation only when composition behavior materially affects request-cost
reconstruction:

- `compatible_with`: the caller may select the component with the model request;
- `incurs`: executing the source automatically creates separately priced target usage;
- `requires`: the admitted operation cannot execute without the target offer;
- `exclusive_with`: two mechanisms cannot price the same billable event.

Relations reference exact offers and never imply a price. When a component reuses another offer's
rate, a contribution references that rate instead of copying its amount.

## Evidence, conflicts, and refresh

Canonical claims come only from reviewed first-party pages, embedded data, public APIs, official
repositories, and carefully scoped authenticated APIs. Third-party catalogs are comparison inputs,
not publication sources.

Matching is deterministic: exact model ID, SKU, meter, resource key, or one uniquely documented
alias. Refresh never needs an LLM, fuzzy match, family inheritance, majority vote, or confidence
score.

For conflicting prices, first separate different model, seller, route, region, currency,
applicability, and validity scopes. A provider-specific authority rule may choose a winner only for
the exact overlapping claim. Keep losing observations as conflict evidence and show a local warning.
If no deterministic winner exists, withhold only the disputed value; valid sibling rows survive.

Parsing and source reconciliation are fact-local:

- isolate malformed pages, tables, rows, cells, and newly observed enum values;
- retain recognized siblings and unknown fields;
- remove a prior fact only when a fresh exhaustive source disproves it for the same scope;
- never let pricing failure erase catalog identity; and
- retain the previously accepted provider pricing partition when the current bundle is incomplete
  or the assembled partition fails validation.

The final catalog/pricing pair remains crash-consistent, while core identity and pricing advance
independently. A pricing failure retains the previous provider price partition but does not hold
back freshly verified model identity; staleness is visible in pricing snapshot metadata.

## Presentation

The model list shows compact representative inference rates. Details show:

1. one selected invocation mechanism;
2. its base and related request-cost meter/rate rows; and
3. only the request dimensions that can change those rates.

The mechanism remains the stable presentation context. Its model rates remain visible while related
services are grouped in one closed disclosure by default, with every meter kept separate. Usage
add-ons label charges that apply only when used; included features distinguish a zero-marginal-charge
state; automatic charges identify costs produced by the mechanism. Only an exact `exclusive_with`
relation creates a mutually exclusive related-service choice.

The UI does not expose training, storage, capacity procurement, plan enrollment, or settlement
topology. It does not ask for usage quantities or show a total. Known parameters that affect the
rate remain visible. Cost-driver definitions stay out of model details; exact source wording remains
available as evidence.

## Validation and migration

Stable identity derives from provider, book, offer, term, and semantic applicability—not amount,
source order, or collection time. Validation proves that references resolve within the provider,
units and bound signals are dimensionally compatible, exact relations are valid, normalized facts
retain first-party observations, and private/account data cannot enter the public resource.

The wire and UI projection remain shared. Each configured provider adapter removes commercial facts
outside this boundary, preserves useful invocation facts, hardens source parsing, and adds
calculation and input-source contracts where evidence allows. A provider retains its currently
accepted partition until a later source refresh and all adoption gates complete. Billing
reconciliation remains a downstream concern; stable provider, book, offer, term, meter, signal,
applicability, and source-locator identities are the handoff needed by that downstream service.
