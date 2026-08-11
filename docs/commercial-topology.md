# Commercial topology

Status: implemented shared contract; all 18 providers migrated

This document is the provider-wide commercial design produced from the
first-party audits of all 18 providers in [the decision index](../design.md).
[Pricing](pricing.md) defines the implemented wire contract. The shared cutover and every provider
topology are current; there is no second public schema or legacy presentation path.

The design has one purpose: preserve enough official commercial structure to
answer which offers exist, which components compose, and which public usage can
reconstruct cost, without turning the catalog into an invoice engine or a
provider-specific workflow graph.

## Decision

Keep the ownership hierarchy:

```text
provider publication
  -> price book
       -> offer
            -> term
                 -> applicability-qualified variant
```

Project three independent graphs over it:

1. the **resource graph** identifies models, services, plans, capacity,
   distribution routes, and public account-resource templates;
2. the **commercial graph** identifies acquisition dependencies, automatic
   billed composition, compatibility, and exclusivity between exact offers;
3. the **accounting graph** identifies rates, allowances, usage contributions,
   and the observable quantities that charge or consume them.

A fact in one graph never manufactures a fact in another. Capability support
does not create a service offer, compatibility does not prove execution or a
charge, a price row does not admit a model, and an account usage field does not
establish a public rate.

The shared design therefore has these invariants:

- `base` and `add-on` are model-relative presentation results, never stored
  offer roles.
- A commercial meter, billing unit, and usage signal are separate identities.
- A separately priced provider service is never flattened into the model's
  token row.
- A component that reuses another offer's rate references that rate; it never
  copies the amount.
- Price, enrollment, route lifecycle, allowance, and settlement remain
  independent facts.
- Extraction and normalization inside a complete source bundle are fact-local;
  cross-refresh pricing retention and publication are provider-atomic.
- Every refresh decision is deterministic and requires no LLM.

The model catalog remains the sole authority for model admission. Pricing,
service, route, account, historical, and raw observations cannot create hidden
or public model rows.

## Audit convergence

The 18 provider audits established the following shared needs:

| Shared need                        | Independently observed examples                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Separately owned provider services | Search, grounding, code execution, storage, reporting, content safety, evaluation, and managed runtime across many providers         |
| Required commercial entitlement    | Ollama Kimi K3 plan gate, provisioned-capacity coverage, subscription packs, and deployment prerequisites                            |
| Automatic billed composition       | Model routers, advisor/evaluator models, RAG pipelines, managed agents, and orchestration that invokes separately priced components  |
| Explicitly selected composition    | Kimi web search, Mistral tools, Azure built-in services, and independently callable services used alongside model inference          |
| Mutually exclusive realization     | Synchronous versus Batch, PAYG versus covered subscription requests, HF billing versus custom keys, and alternative deployment paths |
| Outcome-qualified price            | Served Priority/Fast tiers, fallbacks, completed Batch items, successful grounding, and generated media outcomes                     |
| Account-resource templates         | Fine-tuned models, deployments, endpoints, files, vector stores, containers, sessions, custom voices, and collections                |
| Multiple allowance semantics       | Included quantities, monetary credits, complete coverage, and Anthropic-style rate-class substitution                                |
| Public settlement topology         | Direct billing, marketplaces, reseller channels, BYOK, prepaid balances, postpaid invoices, and published deduction order            |
| Fact-local resilience and conflict | Every provider has independently useful rows or fields that must survive sibling drift, omission, or disagreement                    |

The audits also rejected a universal `tool_call` price. Web search, maps
grounding, file retrieval, code execution, Formula Fibers, caller functions,
and MCP invocation have different sellers, meters, denominators, signals, and
failure semantics. The same rejection applies to generic `batch_inference` and
`gpu_hour` meters: Batch is normally an offer mechanism, while GPU-hours are a
unit expression for a compute or capacity line item.

## Resource graph

### Resource identity and price-book scope

A book owns one commercial resource scope:

- `models`: one or more exact admitted catalog model refs;
- `provider_resource`: one provider-owned resource identified by a stable
  `resource_kind` and `resource_key`, plus an optional exact model projection.

The bounded shared resource kinds are:

- `service`: independently identifiable non-model operations such as search,
  code execution, storage, or reporting;
- `plan`: subscriptions, commitments, procurement plans, and public
  entitlements;
- `capacity`: provisioned throughput, dedicated compute, and reserved serving
  capacity;
- `distribution`: artifact acquisition and licensing routes;
- `account_resource_template`: the public type of a private resource that an
  account may create.

Use a provider-owned resource kind only when none of these meanings is exact.
The kind affects resource semantics and presentation, not whether its price is
numeric.

An optional model projection is only an index for model details. It means that
first-party evidence relates the resource to those models; it does not prove
execution, inclusion, or additive cost. Standalone services and plans may have
an empty projection. When one resource book contains offers with different
model coverage, each offer carries its exact `model_refs` subset; omitting it
means the offer applies to the book's complete projection. Model presentation
filters this offer-level scope before classification, so an incompatible offer
cannot reappear as a generic standalone offer.

Books from different providers never reference one another. A reseller or
cloud seller publishes its own book even when it delegates economics to or
matches an upstream provider. The delegation and settlement evidence stay in
the seller's partition.

### Routes and distribution

Keep distribution and inference routes distinct:

- a distribution route establishes that an artifact can be acquired;
- an inference route establishes that requests can reach an exact hosted or
  self-hosted identity.

Route alias, region, credential boundary, lifecycle, and account/global scope
belong to the route. An artifact can remain obtainable after a hosted route is
retired, and a hosted route can exist without a public artifact. Free or
royalty-free acquisition never implies free execution.

### Account resources

The public topology stores templates, never account instances. Common templates
include derived models, deployments, endpoints, files, vector stores,
containers, sessions, custom voices, collections, and checkpoints.

Resource edges may state only exact resource facts:

- `requires_resource`: an operation needs an instance of the target template;
- `produces_resource`: an operation creates an instance of the target template;
- `derived_from`: the template is derived from an exact public model or
  distribution resource.

These are resource-graph edges, not offer relationships and not cost closure.
For example, a Batch offer may require a batch-purpose file without implying a
file fee, and fine-tuning may produce a private model without admitting that ID
to the global catalog. Private IDs, tenant names, endpoint URLs, and account
configuration never enter the static public resource.

## Books and offers

### Offer boundary

An offer is one independently selectable or acquirable commercial mechanism:
PAYG inference, asynchronous Batch, provisioned capacity, a subscription, a
provider service, a procurement route, or another exact provider mechanism.

Use another applicability-qualified variant, not another offer, when the same
mechanism merely changes amount by region, context band, cache class, served
tier, modality, quality, or media size. Use another offer when API mechanism,
acquisition, billing mode, entitlement, lifecycle, or charge ownership differs.

Batch becomes a separate offer only when first-party evidence establishes a
distinct asynchronous mechanism. Priority or Fast remains a variant when it is
the realized tier of the same request mechanism. A capability, price-table
column, response field, or marketing bundle is not by itself an offer boundary.

The shared billing modes remain `usage`, `capacity`, `subscription`,
`one_time`, and `hybrid`. A provider-owned mode requires a definition and
evidence.

### Price state

Price state is applicability-qualified and independent of enrollment:

- `numeric`: a normalized public amount exists;
- `free`: the provider explicitly charges nothing for the offer;
- `included`: another exact public entitlement covers the marginal charge;
- `externally_billed`: this provider does not own the economic charge;
- `custom_quote`: acquisition requires a quote;
- `not_published`: the offer exists but no public amount is published.

Numeric zero remains `numeric`. `Included` is not free, and external/operator
cost is not zero. Absence establishes none of these states.

An `included` state requires an exact covering allowance or entitlement
relationship. A broad “no additional platform fee” statement creates no
pseudo-offer when there is no independently selectable commercial resource;
retain the policy and the separately priced downstream components instead. An
`externally_billed` state requires evidence of the billing boundary and a
public settlement route where known.

`not_applicable` remains a model-level disposition only when official evidence
establishes that no provider offer applies. A self-hosted, BYOK, or local route
with external economics is not `not_applicable`.

### Enrollment

Commercial enrollment has its own applicability-qualified state:

- `open`;
- `waitlist`;
- `closed_to_new`;
- `private_preview`;
- `account_scoped`.

These values describe acquisition or eligibility, not model lifecycle, price
validity, or service maturity. Multiple values may apply in different account
contexts; for example, a plan can be `closed_to_new` while remaining usable by
existing subscribers.

## Commercial graph

The final offer-relationship vocabulary is:

- `requires`: selecting or settling the source offer requires one target
  commercial entitlement or offer;
- `incurs`: realizing the source automatically creates separately accounted
  usage under one target offer;
- `compatible_with`: source and target may be explicitly selected together,
  but neither execution nor additive charging is implied;
- `exclusive_with`: source and target cannot settle the same billable event in
  the stated applicability.

This separates three meanings that the provider audits initially called
`requires`: acquisition dependencies remain `requires`; automatic model or
service invocations become `incurs`; files, endpoints, and other operational
prerequisites move to the resource graph.

Relationships are provider-local, applicability- and validity-qualified, and
retain their own observations. Targets are exact offer refs. Target refs within
one `requires` or `incurs` relationship are alternatives; multiple applicable
relationships are cumulative. An alternative must be resolved explicitly by
request, outcome, or account evidence. Broad family targets or conditional
relationships that cannot be enumerated exactly remain bounded raw facts.

`compatible_with` and `exclusive_with` have symmetric derived views, although
only the evidence-backed edge is stored. Do not add inverse kinds, generic
predicates, recommendation edges, or book-wide targets that silently widen when
a new offer appears.

`incurs` is not a workflow language. It says only that a realized source has a
separately priced target component. The accounting graph supplies the exact
quantity when available. Examples include a model router invoking its resolved
model, an evaluator invoking a judge model, or RAG invoking an exact embedding
service. A Kimi Formula service that is independently callable does not
automatically incur K3 inference; when the user explicitly composes both,
`compatible_with` is sufficient and each selected offer keeps its own charge.

### Selected-offer closure

A deterministic consumer composes a commercial context as follows:

1. select one request mechanism for the exact model or resource, after applying
   its offer-level model scope;
2. add provider services that the caller explicitly selects;
3. close applicable `requires` relationships, resolving each alternative;
4. close realized `incurs` relationships, using observed outcomes when the
   target can vary;
5. reject applicable `exclusive_with` violations; and
6. never auto-select a `compatible_with` target.

`requires` closure may add a plan or capacity cost whose amortization is not a
request charge. `incurs` closure adds a separately accounted component only
when the source is realized. Compatibility controls eligibility and
presentation, not arithmetic.

Cycles in `requires` or `incurs` closure are invalid. Resource prerequisites do
not participate in this closure.

## Terms and accounting graph

The final term kinds are:

- `rate`: an amount per exact unit expression for one commercial meter;
- `allowance`: a public benefit, target, consumption rule, and lifetime;
- `contribution`: usage generated by this offer but priced by exact rate terms
  in another offer;
- `raw`: a reviewed commercial atom that cannot yet be normalized safely.

A stable term key excludes amount, applicability, validity, and source
position.

### Rates: meter, unit, and signal

A meter answers **what line item is sold**. A unit expression answers **what
quantity the amount divides by**. A usage signal answers **which observed
quantity supplies that denominator**. They are validated independently.

The initial shared meter registry is deliberately precise:

| Group             | Standard meters                                                                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Model usage       | `input_text`, `output_text`, `cache_read_text`, `cache_write_text`, `input_audio`, `output_audio`, `input_image`, `output_image`, `input_video`, `output_video`, `embedding`, `rerank`, `image_generation`, `video_generation` |
| Media services    | `transcription`, `speech_generation`                                                                                                                                                                                           |
| Provider services | `web_search`, `image_search`, `maps_search`, `file_search`, `code_execution`, `container_runtime`, `session_runtime`, `storage`, `data_transfer`, `content_safety`, `custom_reporting`                                         |
| Work and capacity | `training_input`, `training_compute`, `evaluation`, `compute`, `provisioned_capacity`, `subscription`, `acquisition`                                                                                                           |

Use a standard meter only when its definition is exact. A provider-native
search unit, policy check, grounding product, Formula operation, capacity
product, or unusual media line remains provider-owned when the shared name
would lose its commercial identity. An `operation` condition cannot repair an
over-broad meter.

There is no standard `tool_call`, `batch_inference`, `gpu_hour`, or generic
`request_fee` meter. Ordinary client functions create no provider rate unless
the provider explicitly prices that exact operation. Batch owns a mechanism;
its terms use the actual token, item, compute, or provider-owned meters. GPU is
a denominator factor for `compute` or capacity, not the line item.

The standard billing units are:

- scalar content: `token`, `character`, `byte`, and `pixel`;
- counted events: `request`, `event`, `item`, `image`, `page`, and `frame`;
- time and billing periods: `second`, `billing_day`, `billing_month`, and
  `billing_year`;
- resources: `seat`, `instance`, `replica`, `accelerator`, and
  `capacity_unit`.

Unit expressions are exact products such as byte-seconds,
accelerator-seconds, or seat-months. Minutes and hours normalize to seconds;
calendar billing periods never normalize to seconds. Use `request` only when
one API request is the published denominator. A provider event inside a
request uses `event` and a precise signal. Provider search units, credits,
throughput units, and opaque plan units remain provider-owned.

Published scales such as per 1K calls or per million tokens normalize by exact
rational arithmetic. Observations retain the source scale and wording.

### Usage signals and charge bindings

Every standard or provider-owned signal declares:

- one semantic counter and its billable trigger;
- one canonical unit expression;
- its earliest resolution phase; and
- a reviewed definition.

The initial standard signals are limited to meanings shared exactly by
multiple providers:

| Signal                    | Unit          | Earliest phase | Meaning                                                                  |
| ------------------------- | ------------- | -------------- | ------------------------------------------------------------------------ |
| `input_tokens`            | token         | outcome        | Provider-reported full billable input tokens                             |
| `uncached_input_tokens`   | token         | outcome        | Billable input tokens excluding the provider-reported cached partition   |
| `cached_input_tokens`     | token         | outcome        | Provider-reported cached-input partition                                 |
| `cache_write_tokens`      | token         | outcome        | Provider-reported cache-creation partition                               |
| `output_tokens`           | token         | outcome        | Provider-reported billable output tokens                                 |
| `accepted_requests`       | request       | outcome        | Requests the provider accepted as billable                               |
| `completed_result_items`  | item          | outcome        | Completed result items with independently billable usage                 |
| `successful_web_searches` | event         | outcome        | Provider-confirmed successful web-search executions; errors are excluded |
| `generated_items`         | item          | outcome        | Provider-reported completed generated items                              |
| `generated_images`        | image         | outcome        | Provider-reported completed generated images                             |
| `generated_seconds`       | second        | outcome        | Provider-reported completed media duration                               |
| `active_seconds`          | second        | outcome        | Provider-reported active runtime                                         |
| `stored_byte_seconds`     | byte × second | account        | Officially integrated retained bytes over time                           |
| `transferred_bytes`       | byte          | outcome        | Provider-reported transferred bytes                                      |

Providers use their own signal for a different trigger even when the unit is
the same. Kimi's emitted billable `$web_search` call is therefore provider
owned; it is not a `successful_web_searches` event. Likewise, grounded prompts,
executed queries, response items, and caller tool calls do not share a signal.

A charge binding contains only:

- the exact signal;
- its aggregation boundary: `request`, `attempt`, `result_item`, `job`,
  `session`, `resource`, `billing_period`, or a defined provider-owned
  boundary;
- an optional exact rational scale for a documented one-dimensional unit
  conversion; and
- evidence.

The signal already owns trigger and phase, so the prototype's generic
`outcome` and `quantity` fields are removed. “Provider reported” is evidence,
not an outcome type. A discrete event is a numeric signal and needs no
`quantity=event` escape hatch.

The rate denominator and scaled signal unit must be dimensionally identical.
API paths and raw field names remain in observations or reviewed route
adapters. A simple documented derivation such as `prompt_tokens -
cached_tokens` may live in deterministic adapter code with evidence. There is
no public expression language. Time integration, opaque weighting, ambiguous
failure semantics, or a counter with the wrong dimension leaves the rate
unbound without discarding its numeric amount.

`attempt` is a shared runtime accounting boundary, not a static resource or
offer. Vercel fallback and Azure spillover both prove that one submitted
request can have several economically relevant attempts with different route,
model, credential, seller, outcome, and usage. Consumers preserve each
observed attempt and price it independently; the final successful response is
not evidence that earlier attempts cost zero. A client retry is simply another
observed attempt/request and creates no static relationship between offers.

### Usage contributions

A `contribution` term prevents rate copying. It contains:

- exact target rate-term refs owned by the same provider;
- applicability and validity;
- zero or more charge bindings for the contributed quantities; and
- observations.

The source offer normally has an `incurs` relationship to the owning target
offer. The relationship preserves known additive topology even when the
quantity is unbound; the contribution term makes request-cost reconstruction
exact when a compatible signal exists.

Use this for URL context, model-native code execution, advisor or evaluator
model calls, router-selected inference, RAG components, and similar cases where
the provider says “normal model usage applies.” Do not copy the target amount
into the service book. If the provider response already includes the component
in the target offer's authoritative total, do not add a second contribution.

### Allowances and quota accounting

An allowance variant has one benefit:

- `quantity`: an exact amount in a unit expression;
- `credit`: an exact fiat or provider-credit amount;
- `coverage`: eligible target charges have no marginal charge while covered;
- `rate_substitution`: eligible usage is priced by an exact replacement rate
  term instead of the normal target rate.

Targets are exact offer or rate-term refs in the same provider partition.
`rate_substitution` names both the replaced and replacement terms. This models
Anthropic fallback credit and exact reservation/commitment repricing without
inventing a discount formula.

Quota bindings use the same signal, aggregation, scale, and evidence structure
as charge bindings but remain independent. One token may be charged by one
rate while consuming several documented quotas. Opaque allowance classes,
relative labels, graduated unpublished blocks, and unknown weights remain raw.
An ordinal such as Ollama level 1–4 is never a quantity or multiplier.

Standard resets are `none`, `session`, `daily`, `weekly`, `monthly`, `annual`,
and `billing_period`; provider-specific resets remain provider-owned. A
relative entitlement lifetime stores an exact duration and an anchor such as
grant, purchase, activation, or a provider-owned event. Kmodels cannot compute
an account's expiry without its private anchor time.

## Applicability and resolution phase

Keep bounded DNF applicability. Every dimension and signal has one earliest
resolution phase:

- `publication`: fixed by the accepted public snapshot, such as a promotion or
  effective interval;
- `request`: fixed by route or request configuration;
- `outcome`: known from the served response, completed job, session, or
  measured resource;
- `account`: known only from enrollment, billing, or private account state.

Use phase-specific dimensions when requested and realized meanings differ:
`requested_service_tier` and `served_service_tier`, or requested route and
resolved route, are not one selector. A submitted Priority flag never proves a
Priority price when fallback can serve Standard.

Publication facts render as labels, never calculator controls. Request facts
may be what-if selectors. Outcome facts may be estimated before dispatch but
remain visibly predicted until observed. Account facts are never inferred from
the public book. Pre-request estimates, post-outcome public-list cost, and
account settlement are separate projections over the same facts.

## Settlement

Settlement is downstream of public list-price calculation. An offer may have
public settlement variants describing:

- channel: direct, marketplace, reseller, BYOK, or operator/self-hosted;
- billing party: the provider or an explicitly named external party;
- payment-source class: allowance, prepaid balance, provider credit, postpaid
  invoice, marketplace commitment, or external bill; and
- an exact published deduction order among those sources.

Settlement variants retain applicability, validity, and observations.
Provider-credit denominations are never fiat. A marketplace rail for the same
seller/rate is a settlement variant, not a duplicate usage offer. A different
seller owns a different provider book and no cross-provider rate ref.

Only public templates enter the canonical resource. Account balances,
subscription instances, private prices, private-offer IDs, invoices, taxes,
refunds, discounts, and user identifiers are excluded. They may reconcile an
account outside the static catalog without rewriting public observations.

## Cost and presentation projections

Canonical data stores components, not a prejoined total. A consumer:

1. builds selected-offer closure;
2. resolves variants only from facts available at the current phase;
3. multiplies rates only by dimensionally compatible bound signals;
4. applies exact allowance coverage or substitution without copying rates; and
5. sums independent components only within one denomination.

A missing alternative, unbound meter, later-phase condition, raw base-price
fact, external bill, or account-only allowance makes only the affected
component partial. No FX, tax, private discount, or recurring-fee amortization
is implicit.

Derive, rather than store, three coverage views:

1. `price`: whether a normalized public amount or exact non-numeric state
   exists;
2. `charge`: whether official usage reconstructs each public-list component;
3. `settlement`: whether public facts determine the account-effective amount.

For example, a public token rate with no cached split has numeric price coverage
and partial charge coverage. Exact list cost with unknown credits has complete
charge coverage and incomplete settlement coverage.

### Model details

The model table continues to show only representative model-inference input,
cache, and output rates. Model details derive five groups:

- **model mechanisms**: request-time inference alternatives;
- **optional provider services**: exact compatible or dependent services the
  caller may select in addition to the model;
- **automatic components**: read-only `incurs` closure, including model or
  service usage caused by the selected operation;
- **plans and capacity**: required entitlements and acquisition context;
- **standalone context**: compatible resources that are not selected or summed.

Only genuinely exclusive request mechanisms use radios. Optional services use
independent controls; selecting a service never replaces the model offer.
Automatic components are displayed but not user-selectable. A row uses the
precise meter and source denominator, such as “Web search · USD 0.005 per
billable search event,” never “Tool call per request.”

Rate details also expose the bound usage signal, its reviewed billable trigger,
aggregation boundary, and earliest resolution phase. A numeric rate remains
displayable when that signal is unavailable, with the missing binding stated
locally. Billing mode, enrollment, settlement channel, biller, ordered payment
sources, allowances, and contribution drivers remain read-only context. The UI
explains every known parameter that can affect cost but never asks for usage,
multiplies quantities, allocates commitments, or presents a total.

Kimi K3 therefore displays its regional cache/input/output rates plus an
optional Kimi web-search service. The built-in `$web_search` route is charged
for each exact emitted billable call, while the Formula route is charged on its
Fiber execution. Ordinary caller functions receive no Kimi fee. Search-result
content contributes only to the later Chat prompt usage already reported by
Kimi and is never counted twice.

The UI must show known, predicted, unbound, included, externally billed, and
account-only components distinctly. It need not pretend to be an invoice
calculator.

## Evidence, conflicts, and refresh

### Official evidence boundary

Canonical claims come only from allowlisted first-party pages, embedded data,
public APIs, official repositories, and scoped authenticated APIs. models.dev,
LiteLLM, gateways, and other catalogs are audit and drift-discovery inputs only;
they never create, fill, widen, or override a provider partition.

Matching is deterministic: exact ID, exact SKU/meter/resource key, or one
uniquely documented alias. There is no fuzzy match, family inheritance,
majority vote, confidence score, comparator fallback, or LLM judgment in
refresh.

### Conflict resolution

First separate different applicability, validity, route, seller, currency, and
account scopes; unequal values in different scopes are not conflicts. For an
actual conflict, each provider defines claim-specific deterministic authority
rules based on exact identity, source purpose, containment/specificity,
effective interval, and account scope.

When a reviewed rule selects a winner, publish that value, retain the losing
observations as superseded/conflicting evidence, record the resolution policy,
and show a local warning. Never discard all sibling facts because one value
lost. When equally authoritative current evidence has no deterministic winner,
withhold only the disputed amount, unit, binding, relation, or condition as a
bounded conflict. Do not invent a winner merely to keep a calculator cell.

Account-effective evidence may supersede public list price only for the exact
account/SKU/scope; it does not rewrite the public snapshot.

### Fact-local extraction and provider-atomic retention

Parsing and reconciliation inside a successfully acquired source bundle are
fact-local:

- validate independent inventories, pages, tables, rows, cells, relationships,
  and usage bindings independently;
- reject or retain the smallest unsafe claim while publishing recognized
  siblings;
- accept additive fields and newly recognized commercial atoms as bounded raw
  diagnostics rather than rejecting a model or provider;
- remove a prior fact only when fresh evidence is exhaustive for that exact
  claim and scope;
- never let a pricing or service failure erase catalog identity established by
  a fresh authoritative inventory.

Cross-refresh retention is deliberately coarser. A missing required pricing
source, unavailable optional commercial companion, systemic parse failure, or
invalid assembled graph retains the complete previously accepted provider
pricing partition with its original verification time. Fresh and retained
observations do not coexist inside one provider partition. A fresh compatible
catalog slice may still advance, and a complete valid pricing bundle may
advance against a retained compatible catalog slice. The final catalog/pricing
pair is published only after all references, identities, units, conflicts, and
graph invariants validate, and the pair is replaced atomically.

## Stable identity and validation

Stable IDs derive only from semantic ownership:

- provider resource: provider ID, resource kind, and stable resource key;
- book: provider ID and stable book key;
- offer: book ID and stable mechanism key;
- term: offer ID, term kind, and stable term key.

Amounts, source position, display labels, observation order, and collection
time never enter those IDs.

Variant matching for diffs uses semantic scope:

- rate: owner term, canonical applicability, validity, denomination, and unit
  expression, excluding amount;
- allowance: owner term, benefit kind, target, reset, applicability, and
  validity, excluding benefit amount;
- contribution: owner term, target rate refs, applicability, and validity;
- state or enrollment: owner, applicability, and validity, excluding the state
  value.

This makes a price or state change a field change instead of delete/add churn.
Canonical ordering uses semantic keys and UTF-8 ordering, never source order.

Validation proves at least:

- every model ref exists in the admitted catalog;
- every book, offer, term, resource, and target ref is provider-local and
  resolvable;
- `requires` and `incurs` closure is acyclic and exclusivity is satisfiable;
- `included` has exact coverage evidence;
- rate and contribution bindings have dimensionally compatible units;
- allowance targets and rate substitutions are exact and same-provider;
- requested and realized dimensions use the correct resolution phase;
- no account identifier or excluded model leaks into the public resource; and
- every normalized or raw atom retains first-party observations.

An internally inconsistent graph blocks the smallest independently publishable
claim when it can be isolated; otherwise it blocks the provider partition. It
never authorizes silently dropping an unexplained commercial atom.

## Deliberate non-goals

The canonical resource is not:

- an invoice, tax, FX, discount, amortization, or private-contract engine;
- a generic formula language, workflow graph, or predicate solver;
- a model recommendation, cheapest-route chooser, or provider default;
- a historical ledger when the provider publishes only a current snapshot;
- a reason to admit a model outside the catalog boundary.

Raw preservation applies only to reviewed public commercial facts inside the
admitted provider/resource boundary. Excluded model rows and private account
objects are not retained as hidden catalog or price objects.

## Migration program

Foundation design, all 18 provider audits, cross-provider convergence, the
single shared wire cutover, and all 18 provider migrations are complete. There is no compatibility
schema or dual UI path. The completed migrations each:

1. implement its audited resource, offer, relationship, accounting, allowance,
   enrollment, settlement, and authority decisions without widening them;
2. dispose every reviewed first-party commercial atom;
3. bind only exact, dimensionally compatible official usage signals;
4. prove row/field-level drift inside a valid bundle cannot erase valid sibling
   facts, while incomplete or invalid bundles retain the provider partition;
5. test selected-offer closure and model-detail grouping, including optional
   services versus automatic and exclusive components;
6. refresh only the intended provider's substantive topology and prove every
   untouched provider has no unexpected semantic change; and
7. pass `vp check`, `vp test --run`, `vp run collect:fixtures`, and
   `vp run build`.

Adoption is checked against the committed artifacts, not inferred from source
code alone. Every provider must retain its audited standalone resources,
resource edges, commercial relationships, accounting bindings and terms,
settlement, and model dispositions; every captured public
replay input must compile with the current extractor versions. A provider with
an unavailable current bundle may be explicitly preserved, but its accepted
partition must already pass the same topology checks and its retained status
must remain visible.

Future provider changes retain the same requirement-by-requirement audit of canonical data,
generated resources, diffs, and presentation.
