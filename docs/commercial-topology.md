# Commercial topology

Status: current boundary; configured-provider adapters implemented

This document defines which public prices Kmodels admits and how every provider maps them into one
shared model. [Pricing](pricing.md) owns the exact wire. Provider documents own source authority,
identity matching, and vocabulary mappings.

## Purpose

Kmodels publishes conditional unit prices for inference and provider-hosted capacity:
`price(subject, meter, conditions) -> applicable unit price(s)`. Amounts, denominations, denominators,
validity and source evidence accompany the result. Missing conditions and conflicting evidence
remain explicit. No billable quantities, usage ledger or request-cost total are required.

A condition qualifies the usage being priced by one lookup. It need not hold for every token in
the request. Consumers may query multiple TTLs independently and own usage attribution and cost
aggregation. Input, output, cache read and cache write remain distinct meters; different TTLs
remain conditions on cache write.

The [portable pricing package](price-lookup.md) exposes model/resource unit-price lookup.
Provider-owned price-basis metadata describes denominators and billing rules. Kmodels does not
execute quantity graphs or expose a cost API. Missing accounting evidence does not block a known
unit price.
[Pricing coverage](pricing-coverage.md) reports independent evidence gaps. Provider guides own
exact source mappings.

Price books remain provider-owned. Kmodels neither constructs nor promises a continuously updated
cross-provider identity for an allegedly equivalent model; consumers that need such product
comparison own that separate, policy-driven mapping.

This boundary is narrower than the wire's representational capacity. Existing shared types may
decode broader facts while providers converge, but new collection work must establish the
inference relationship and public billing basis before publishing a capacity charge.

## Admission boundary

Admit a commercial fact only when all of these are true:

1. it prices a callable inference operation, a component attributable to one proxied request or
   result item, or the running provider-hosted endpoint resource used to serve an admitted model;
2. the public rate is established by first-party evidence;
3. its applicability can be selected from request or deployment configuration, or established from
   provider-reported usage; and
4. it can be represented as a rate or exact non-numeric state without allocating a fixed charge
   across requests.

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
  component and its request-visible quantity; and
- on-demand inference-hosting instance hours and independently billed publisher software hours
  when first-party rates and exact deployment or listing associations are available.

Exclude:

- training, fine-tuning jobs, checkpoints, model import, and artifact distribution;
- storage retained beyond the request and general data-transfer products;
- reserved throughput commitments, subscriptions, seats, support plans, and prepaid capacity;
- account resources, balances, credits, private offers, negotiated discounts, taxes, invoices, and
  settlement order;
- surcharges whose applicability depends on a provider-account setting that the proxied request,
  route configuration, response, result item, and usage record do not establish;
- orchestration products whose total platform activity cannot be attributed to the proxied model
  request; and
- formulas that require workload forecasting or amortizing a fixed charge across requests.

Capacity unit prices retain an instance-time denominator and are not allocated across requests. A regional infrastructure rate does not establish that every model can deploy in that
Region or that the account has capacity. Model links require exact supported-instance metadata;
unlinked regional rates remain provider resources.

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

- A **book** owns one admitted model, separately priced request service, or inference capacity resource.
- An **offer** identifies an evidenced commercial relationship for that subject. Invocation
  mechanisms and scoped adjustments belong to its terms, not to its identity.
- A **term** is one rate, exact price state, allowance that applies directly to admitted request
  usage, contribution, or bounded raw fact.
- A **variant** holds the exact rate or state under one applicability and validity scope.

An offer containing a normalized allowance or contribution may omit a base-price state when it
only adjusts referenced rates. This represents a shared quota or a fixed quantity contribution
without fabricating a free or numeric base charge. Exact reference and unit validation still
applies; an empty offer remains invalid, and every direct rate still requires numeric coverage.

Provider differences do not create provider-specific pricing models. They appear only as
provider-owned vocabulary where a shared semantic would be false: dimension values, meters, usage
signals, resource keys, and source-native evidence.

This hierarchy is the stable core. Relations, contributions, allowances, resource edges, and
settlement fields remain optional wire capabilities; a provider review must not populate them just
to make its commercial graph look complete. Most directly invoked model rates need only a model
book, one or more relationship offers, rate terms, and applicability variants.

### Offers and dimensions

An offer identifies the commercial relationship under which a customer is charged. A condition
is a predicate on eligibility, a request, a deployment, or an observed outcome. Conditions can
qualify an offer's eligibility or a term's rate; they are not an alternative kind of entity.

Apply this decision procedure to every provider:

1. Identify the charged subject. Models, independent services and running resources retain separate
   books even when the same account pays for them.
2. Establish a separate offer only from a distinct enrollment, contractual obligation, capacity
   commitment, seller/account billing relationship, or explicitly opted-in data-use program.
   A source heading, price table, API path, aggregation boundary, execution mode, meter or different
   amount alone is insufficient evidence.
3. Within the same relationship, Batch, online/live operation, actual tier, speed, region, context
   and protocol qualify terms. Retain each conditional rate's quantity methods and aggregation;
   never widen synchronous extraction paths into Batch or add mutually exclusive charges together.
4. Account enrollment is independent of request preferences. Gemini Free/Paid and Contributor
   programs and OpenAI's evidenced data-sharing program are relationship choices. Ordinary
   Standard/Priority/Flex outcomes remain conditions. Existing-customer eligibility alone is not
   evidence of another agreement.
5. Without evidence of a second relationship, use one public list-rate offer for the subject.
   Do not create speculative contracts or Cartesian products of request dimensions. Missing price
   evidence remains unknown/raw; callable endpoints do not create priced offers.

The practical test is: after all request and usage facts are supplied, must the consumer still
identify a separately held or selected commercial agreement? That agreement identifies an offer.
Changing only a request or outcome under the same agreement selects a condition. A field name
alone never establishes enrollment or a contractual obligation.

Existing single-relationship keys remain opaque stable identifiers. Combined tariff contexts use
`public` (qualified by billing basis when necessary). Account programs use
`account:<program>` and retain their native eligibility predicates. Excluded subscriptions,
reserved commitments and private contracts remain excluded: this boundary does not expand admission.

Adapters may extract separate tariff contexts to preserve exact accounting. The shared ownership
compiler combines them before publication. `source_contexts` maps source keys to applicability for
association compilation and migration; it is provenance, not a second selectable offer layer.
Terms retain source context in stable keys. Reviewed account programs partition the combined terms.

Canonical choices declare a target: `book`, `offer`, or `condition`. Account plan selects the
relationship; execution/tier/speed bind conditions. Billing basis belongs to the offer and resource
kind to the book. A query can resolve them together while reporting ownership, exact references,
native residual values, correlated scopes, partial evidence and missing inputs. Requested outcomes
never establish actual billed results. The old `execution_mode` query remains a compatibility alias.

Services remain separate charged subjects. Model eligibility, protocol, operation and region
qualify service terms; shared allowances retain one pool and exact rate targets. Remap relations
and contributions together with offer and term IDs. Remove a same-book `exclusive_with` relation
only when disjoint conditions prove the same exclusion. No quota is duplicated per model/request.

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
canonical schema validates the graph and its units without executing it. Consumers own any
collection, attribution or execution of those accounting rules. They do not supply usage to Kmodels.

The graph admits only reviewed operations. Its product form multiplies one quantity by `item`
counts, for example seconds requested per video by successfully returned videos; it is not a
general dimensional-expression language.

Keep an independently established formula when a source field disappears. Its calculation lists all
required signals, while optional input mappings retain whichever acquisition paths remain known.
Missing mappings do not mean zero usage or an unknown rate. Equal list prices with different signals,
scales, formulas, or selector mappings keep their scoped variants rather than losing or widening
those contracts during compaction. Variants within one term are alternatives for that charge.

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

The model list shows compact representative inference rates or a capacity status when no request
rate is available. Details show:

1. public running-capacity offers linked by exact compatibility evidence;
2. the applicable commercial relationship, when a choice exists;
3. its base and related request-cost meter/rate rows; and
4. the deployment or request dimensions that can change those rates.

The subject and commercial relationship remain the presentation context. Its model rates remain visible while related
services are grouped in one closed disclosure by default, with every meter kept separate. Service
charges remain distinct from model and capacity rates; included features distinguish a zero-marginal-charge
state; automatic charges identify costs produced by the mechanism. Only an exact `exclusive_with`
relation creates a mutually exclusive related-service choice.

The UI does not expose training, storage, prepaid capacity procurement, plan enrollment, or settlement
topology. It does not ask for usage quantities or show a total. Known parameters that affect the
rate remain visible. Cost-driver definitions stay out of model details; exact source wording remains
available as evidence.

## Validation and migration

Stable identity derives from provider, book, offer, term, and semantic applicability—not amount,
source order, or collection time. Validation proves that references resolve within the provider,
units and bound signals are dimensionally compatible, exact relations are valid, normalized facts
retain first-party observations, and private/account data cannot enter the public resource.

Adopted-topology checks distinguish required commercial mechanisms from source-dependent inventory.
Model dispositions describe explicitly observed inventory; their current presence is not a
structural feature for any provider. A source may omit every discontinued/non-hosted row without
changing its commercial model. Explicit rows must still survive as validated `not_applicable`
dispositions. Required resources, charge bindings and other adopted mechanisms remain guarded;
an absent service-price dependency cannot pass by removing dispositions. Canonical provenance and
source completeness checks still apply, and no price state is invented to satisfy a topology gate.

The wire and UI projection remain shared. Each configured provider adapter removes commercial facts
outside this boundary, preserves useful invocation facts, hardens source parsing, and adds
calculation and input-source contracts where evidence allows. A provider retains its currently
accepted partition until a later source refresh and all adoption gates complete. Billing
reconciliation remains a downstream concern; stable provider, book, offer, term, meter, signal,
applicability, and source-locator identities are the handoff needed by that downstream service.
