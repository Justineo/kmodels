# Pricing

Status: shared wire implemented; provider convergence is in progress

This document is the current wire and presentation contract.
[Commercial topology](commercial-topology.md) defines the narrower admission boundary for an AI
Gateway rate book. The shared wire is implemented; providers are being re-reviewed against that
boundary one at a time. Generated artifacts must pass topology and replay-adoption gates before a
provider convergence pass is current.

## Decision

Kmodels publishes one canonical pricing resource. The model catalog does not
contain a second flat-price projection, and the website never falls back to
one.

The resource models the request-attributable part of a provider's current public pricing snapshot
as:

```text
provider snapshot
  └─ price book
       └─ offer
            ├─ state
            └─ logical term
                 └─ applicability-qualified variant
```

This hierarchy is the minimum needed to preserve distinct invocation offers, their exact
relationships, meters, billed usage signals, units, conditions, and unsupported in-boundary facts
without expanding every observed combination into a model-local rate list. The wire can represent
broader commercial facts during provider convergence; that capacity does not admit them into newly
reviewed partitions.

The authoritative durable assets are:

- `data/catalog.json`: providers, models, sources, coverage, and diagnostics;
- `data/pricing.json.gz`: the gzip-compressed, content-bound canonical pricing envelope.

They advance as one accepted pair. The canonical pricing endpoint is
`/pricing/index.json`; catalog publication profiles are defined in
[Catalog semantics](catalog.md).

Pair publication also refreshes the derived UI and export packs described in
[Collection](collection.md). They are delivery artifacts, not canonical pricing
resources; the export-pack pricing entry decodes to the exact canonical
envelope.

## Local compilation

Canonical pricing is compiled from a bounded intermediate input, not owned by
the website renderer and not executable only inside a source refresh. A
collection writes `data/pricing-inputs.json.gz` with the minimal public parsed
facts needed by provider pricing assembly whenever a complete public source
bundle was parsed, including one whose assembled topology subsequently failed
validation. `vp run compile:pricing` reads that input, reassembles replayable
provider partitions through a bounded largest-first worker pool, validates the
complete canonical resource, advances the accepted pair, and regenerates its
projections without network access.

The canonical compilation input is bound to the exact catalog core, and each
replay source records its content hash and extractor version. Provider snapshot
metadata comes from the accepted canonical pair rather than being duplicated.
When one source describes the same exact model identity in several
operation-specific records, compilation coalesces those records and preserves
the union of distinct normalized rate facts and bounded source-native raw
facts; conflicting non-unknown pricing states abort capture.
The input stores no response bodies, descriptions, credentials,
authenticated-source facts, or private identifiers. A provider whose complete
pricing input cannot safely be persisted has no replay entry, so its accepted
partition is carried through unchanged. Binding, source, extractor, ownership,
provenance, completeness, or validation failures abort the compilation rather
than publishing a partial result.

The generated-data gate replays every captured provider with the current extractor version and
verifies that accepted providers still expose their adopted in-boundary resources, relationships,
accounting terms, and model dispositions. A provider may be
carried through without a replay entry only when the current public source
bundle was unavailable; that retained partition remains visibly stale and must
already satisfy the topology gate.

This boundary permits canonical assembly, normalization, and validation changes
to be evaluated locally at any time. Projection-only presentation changes use
`vp run prepare:assets` and also need no refresh. A change to source parsing
still needs a refresh, because Kmodels deliberately does not retain raw
upstream bodies.

## Review boundary

This document owns:

- public pricing semantics and their relationships;
- the closed canonical wire shape;
- normalization and raw-fallback boundaries;
- deterministic identity and commercial comparison;
- conservative presentation behavior;
- provider-atomic, crash-consistent publication.

The checked TypeScript schemas and conformance tests own exact field syntax,
limits, sort keys, hash domains, and transition mechanics. A review finding is
adoption-blocking only when the documented semantics permit:

- two different commercial meanings for one conforming value;
- two canonical byte representations for the same normalized value;
- a false public price, scope, state, or provenance claim;
- private data to enter public normalized or raw output;
- work or memory outside the declared bounded resource envelope;
- a broken catalog/pricing reference or publication pair.

The following are deliberately outside this contract:

- invoice calculation, tax, currency conversion, discounts, or account balance;
- private, negotiated, credential-scoped, or account-specific pricing;
- a universal formula language or general predicate solver;
- historical reconstruction when a source publishes only an undated current
  value;
- execution of imprecise validity labels as a time query;
- a provider default, cheapest offer, or automatic offer recommendation;
- a lossless model for every possible commercial contract.
- training, retained storage, capacity procurement, subscriptions, plans, and
  account settlement that cannot be attributed to one proxied request or result item.

An unsupported public fact remains visible as bounded raw pricing. A fact
outside the public boundary is discarded or quarantined, never serialized as
raw. Requests to solve an excluded capability require a separate design change;
they are not gaps in this contract.

## Principles

### Canonicalize semantics, not source layout

Equivalent normalized facts should compare equally even when providers group
or order their pages differently. Canonicalization covers exact numbers, fixed
units, applicability, resource identity, set-like ordering, and compaction.
Source spelling and locators remain evidence and do not define normalized
commercial identity.

### Preserve information without pretending to understand it

Every admitted public fact follows this ladder:

1. publish a normalized exact value;
2. calculate an exact value with a reviewed bounded adapter rule;
3. preserve the unsupported part as a bounded raw variant beside any
   normalized variants;
4. publish an exact non-numeric offer state;
5. otherwise report unknown.

Raw is a fallback, not a shortcut. A new shared abstraction needs at least two
real provider cases and a clear canonical meaning.

### Fail closed in summaries, not in detail

Normalized facts remain useful even when another possibly applicable fact is
raw. The detail view shows both and marks the result incomplete. A representative
price is withheld whenever ambiguity could change that number.

### Separate commercial data from audit data

The canonical pricing asset retains observations, source references, locators,
raw source fields, and derivations for validation and audit. Those fields do
not belong in the website runtime payload.

Pricing information has four deliberate publication levels:

1. Collection audit retains source attempts, extraction counts, input/output reconciliation,
   bounded diagnostics, freshness, and the reviewed first-party evidence policy. This explains what
   Kmodels saw and what it could not bind; it is not a provider commercial claim.
2. Refresh reports aggregate those attempts into provider/model resolution coverage and actionable
   warnings. Reports remain operational artifacts and are not a pricing API.
3. Canonical catalog and pricing APIs retain only validated public commercial facts, exact source
   references, bounded raw fallbacks, and the source records needed to audit provenance. A scoped
   authenticated inventory may contribute only positive facts reduced to non-secret public model,
   scope, and commercial identifiers. Rejected candidates, raw authenticated bodies, account
   resources, principals, subscriptions, and private identifiers never enter the canonical pair.
4. Website packs contain only the fields required to render the catalog, representative pricing,
   and deferred model detail. They omit source policy, reconciliation, warnings, and raw collection
   diagnostics.

The bound catalog source records expose Kmodels' reviewed first-party pricing-source classification:
source kind, permitted identity binding, and currentness semantics. This describes why a source is
admissible; it is metadata about Kmodels' evidence boundary, not a provider price. Refresh summaries
retain operational resolution coverage and reconciliation. Neither enters the UI packs.

The website is built from five closed runtime payload families:

- `/ui/catalog/index.json` contains only fields needed to render, search,
  filter, and sort;
- `/ui/catalog/pricing.json` contains build-time representative pricing and is
  loaded concurrently with the catalog before the application mounts;
- `/ui/details/<provider>/<chunk>.json` contains bounded deferred model facts
  and references to their model-scoped offers;
- `/ui/offers/<provider>/<chunk>.json` contains bounded, exact-content-deduplicated
  display-ready offers shared by model and provider-resource details;
- `/ui/providers/<provider>/pricing/<chunk>.json` contains bounded deferred
  standalone provider-resource metadata and grouped references to those offers.

The browser does not fetch the canonical catalog or pricing asset during normal
application startup or model inspection. The canonical endpoints remain
explicit download links.

The development server follows the same boundary. A UI request opens only the
pre-generated UI pack; an explicit catalog or pricing download opens only the
export pack. Neither path recovers the canonical pair, and every response is an
already compressed byte slice. Production build performs streaming
decompression directly to `dist/`, so the 100+ MB decoded pricing resource is
never materialized in the build heap.

## Scope

Newly reviewed provider partitions normalize:

- on-demand, Batch, realtime, and other directly callable inference offer identities;
- request-attributable model and provider-service rates with exact denomination and compound unit;
- applicability over reviewed request, outcome, and publication dimensions;
- numeric, free, included, externally billed, custom-quote, and not-published states for admitted
  operations;
- evidence-backed `requires`, `incurs`, `compatible_with`, and `exclusive_with` relationships
  between exact admitted offers;
- rate, contribution, and bounded raw terms, plus allowances only when they apply directly to
  admitted request usage;
- optional dimensionally checked charge and contribution bindings; and
- exact bounded adapter calculations whose result and provenance are first-party evidenced.

Training, retained storage, capacity commitments, subscriptions, account-resource templates,
settlement, invoices, private prices, and workload-amortization formulas are outside the publication
boundary. The shared decoder retains its closed broader vocabulary while older provider partitions
converge; provider adapters must not use those fields merely because they remain representable.

The current contract keeps these raw:

- unknown amount, denomination, unit, meter, or applicability;
- usage aggregation whose accumulation/reset basis is not established;
- formulas outside reviewed adapter calculations;
- unsupported graduated, block, or contract structures;
- conflicts that cannot be localized as one exact normalized value;
- allowances whose normalized target rate is unavailable;
- structures that exceed a fact-local normalization limit.

Raw variants carry a commercial impact:

- `base_price`: may change the price and blocks a direct price summary;
- `allowance`: may change benefits and blocks a complete allowance summary;
- `informational`: retained for audit but excluded from commercial equality.

## Public semantics

### Envelope and provider ownership

The pricing envelope binds:

- the canonical pricing-data hash;
- the exact catalog version and core-data hash;
- the joint generation time;
- the canonical pricing data.

Each represented provider owns exactly one vocabulary and one snapshot.
Snapshots are `fresh` or `retained`; retention preserves the original
`observed_at` and never restamps stale facts. A retained snapshot also records
the latest attempted refresh time and one stable failure code. This metadata is
provider-partition-wide and non-commercial: it does not claim that a particular
model failed validation. A successful refresh clears the failure, and Git
history—not the public schema—retains older attempts.

All model and source references are opaque identities from the bound catalog.
Books, observations, and dispositions may reference only records owned by the
same provider. Cross-provider price books are not supported.

### Model outcomes

For one model, presentation uses this precedence:

1. an exact `not_applicable` disposition means official evidence establishes
   that the provider has no public hosted pricing offer for that model;
2. otherwise, one or more matching books mean offers are available;
3. otherwise, pricing is unknown.

The refresh report separately measures this resolution boundary for every current provider model.
That operational classification is audit and collection evidence, not a commercial assertion, so it
does not enter the canonical pricing API or the website payload. The canonical resource continues to
publish only provider-established offers, dispositions, and their evidence.

`not_published` is not the same as either outcome above. It is an offer state:
the offer exists, but the provider does not publish its price. `custom_quote`
likewise identifies an offer whose amount requires provider contact. Missing
data never means free, and a numeric zero remains a numeric rate.

### Price books

A book has:

- a provider-owned stable key and derived ID;
- either a model scope or a provider-resource scope;
- one or more offers;
- claim-local scope evidence, plus exact resource edges where applicable.

`scope.model_refs` is the current exact model projection used by the website.
Scope observations collectively cover that projection and cannot widen beyond
their observed subjects. A provider-resource offer may additionally carry
`model_refs`, which must be a sorted strict subset of the book scope. This preserves
offer-level ownership when several model-specific offers share one resource
book. Canonical assembly omits a redundant full-book subset; omission means the
offer covers the complete book projection. An empty
book projection keeps the resource provider-level rather than attaching it to
every model.

Identity granularity follows the admitted source rather than a universal
version requirement. Version-labeled evidence creates an exact model/version
book. A reviewed first-party price book that explicitly publishes only a base
model ID may create one shared book scoped to the non-retired catalog tuples
with that exact provider model ID that lack exact numeric evidence. The shared
scope does not merge catalog identities or claim that a particular version was
named by the source. Exact numeric books remove their tuple from the fallback
scope, so exact evidence cannot compete with a base-model rate or leak to
sibling versions.

### Offers

An offer represents one selectable billing mechanism. It has:

- a stable key and derived ID within its book;
- an optional exact model subset when it is narrower than the book;
- one exact billing mode;
- applicability-qualified states;
- logical pricing terms;
- zero or more evidence-backed relations to exact offers owned by the same
  provider.

Offer identity does not encode a permanent base/add-on role. `requires`,
`incurs`, `compatible_with`, and `exclusive_with` describe acquisition,
automatic billed composition, explicit compatibility, and alternative
mechanisms respectively. Targets are exact offer sets; unsupported broad
wording is not normalized. Relations are applicability-qualified, and their
observations must exactly establish their targets. Provider-resource offers
therefore appear in their own UI groups without becoming pseudo-models.

The standard billing modes mean:

- `usage`: charges primarily follow measured consumption;
- `capacity`: charges primarily reserve throughput or resources;
- `subscription`: a recurring fixed entitlement;
- `one_time`: a non-recurring purchase;
- `hybrid`: a documented combination of fixed entitlement and usage/capacity.

If those meanings do not identify the source offer exactly, the adapter uses a
reviewed provider-owned billing-mode atom or withholds the container.

### Offer states

States are applicability-qualified and may retain source-published validity:

- `numeric`: normalized rate terms define the charge;
- `free`: the applicable offer is explicitly zero-cost;
- `included`: another exact public entitlement covers the marginal charge;
- `externally_billed`: the provider does not own the economic charge;
- `custom_quote`: a public offer exists but requires a quote;
- `not_published`: a public offer exists but no public price is published.

An offer state is not inferred from absence. Conflicting possibly overlapping
states are downgraded with the affected commercial facts rather than allowing a
false resolved state.

### Logical terms and variants

A term is one stable commercial component. Its key does not include price,
validity, region, or array position.

- A `rate` term owns one meter and contains normalized and raw variants.
- An `allowance` term contains normalized benefits and raw variants.
- A `contribution` term points to exact rate terms used to price usage generated
  by this offer, without copying their amounts.
- A `raw` term is used when the term's meter or structure itself is not
  normalized.

Variants carry the changing assertion: value, applicability, optional
published validity, and observations. Historical/future or region-specific
values therefore coexist under one logical term without changing its identity.

Normalized and raw variants may coexist under one term. A conflict fallback
also cascades to dependent allowances so one unsupported component does not
invalidate an otherwise useful provider partition.

### Rates, quantities, and allowances

A normalized rate is:

```text
exact rational × denomination per canonical unit expression
```

Rationals are non-negative, reduced fractions. Denominations are ISO fiat codes
or provider-qualified credits. Unit expressions are products of bounded,
positive-power unit factors.
Adapters keep source prices as decimal strings. Scaling, multiplication,
comparison, and canonical rational conversion use digit operations or `BigInt`,
never binary floating-point arithmetic.

A rate variant may additionally bind its commercial meter to one reviewed
usage signal. The binding records only the signal, aggregation boundary,
optional exact rational scale, and evidence. Its scaled signal unit must equal
the rate denominator. Absence of a binding preserves the normalized list price
while leaving request-cost reconstruction incomplete. API field paths and
unsupported arithmetic remain evidence or bounded raw facts rather than
becoming canonical signal identity. Contribution variants use the same binding
shape and may remain unbound when topology is exact but quantity semantics are
not.

Fixed units canonicalize to reviewed bases with exact scaling. For example,
`USD 60/hour` and `USD 1/minute` normalize to the same per-second value. A price
denominator is dimensional: storage stated per token-hour is
`token × second`, not token throughput per second. Calendar months remain
non-convertible.

A usage allowance references exact normalized rate-term IDs whose units are
compatible with the allowance quantity. A credit allowance targets the whole
offer in the same denomination. Empty or ambiguous targets are invalid.

Billing blocks and graduated schedules require a documented aggregation/reset
basis. Without it they remain raw rather than being presented as ordinary unit
rates.

### Meters

Meters identify what is charged, not every operation a model can perform.
Selection follows the commercial line item:

- model input/output and cache lines use their directional modality meters;
- a provider line sold explicitly per generation, rerank request, tool call,
  session, capacity unit, or batch job uses the corresponding operation meter;
- provider concepts without a stable shared meaning use provider-owned meters.

The same source spelling cannot represent two provider meter meanings. Provider
atoms use reviewed semantic keys; raw spelling remains in observations.

### Applicability

Applicability is bounded disjunctive normal form:

```text
OR clause
  AND categorical, boolean, or decimal-range conditions
```

The empty AND clause is unconditional. Conditions in one clause use unique
dimensions. Categorical sets, bounds, clauses, and alternatives are
canonicalized and sorted; contradictory clauses are removed, while a fact with
no satisfiable clause falls back to raw.

Standard dimensions have schema-owned kinds and value grammars. Provider
dimensions and categorical values are provider-qualified and registered.
Unknown source applicability is not represented as an exact selector.

Partial UI evaluation is three-valued:

- a supplied condition is true or false;
- an unsupplied dimension is missing;
- AND is false if any child is false, true if all are true, otherwise missing;
- OR is true if any child is true, false if all are false, otherwise missing.

A missing selector remains a candidate and requests only dimensions that can
still change the result. This is deterministic filtering, not source-uncertainty
resolution.

### Published validity

Validity preserves an official label with year, month, date, or canonical UTC
datetime precision and inclusive/exclusive endpoint metadata. It is display
metadata.

Kmodels does not turn collection time into validity and does not execute
imprecise validity as a historical/current price query. A validity-bearing
variant is details-only unless a separate source fact establishes currentness.
Provably empty or reversed intervals are not normalized.

Validity does participate in conflict detection: unequal values conflict only
when both their applicability and their published validity may overlap.
Intervals are treated as disjoint only when their precision and endpoint
inclusivity prove it; mixed or imprecise labels remain conservatively
overlapping. This preserves consecutive promotional and standard rates without
pretending that collection time selects either one.

### Provider-owned atoms

Provider units, meters, usage signals, dimensions, categorical values, billing
modes, credit codes, and allowance resets are keyed by provider and kind. Each
published key has a non-empty reviewed definition in that provider's
vocabulary.

Provider atoms are not equal to Kmodels atoms or another provider's atom merely
because their source spelling matches. The registry is finite, checked in, and
review-owned; adapters cannot invent semantic keys from amounts, positions,
validity, or applicability.

## Evidence and raw preservation

Every public resource and assertion has non-empty provenance appropriate to the
claim. Value observations retain:

- a provider-owned catalog source reference;
- a bounded locator;
- the bounded raw commercial fields needed to audit the assertion;
- the exact applicability established by a normalized observation.

When a structured billing catalog publishes a stable meter identifier, parsed source facts carry
that source-native locator into the canonical observation. Synthetic provider-key locators remain
the fallback for documents without such an identifier. A locator is audit evidence and never part
of normalized rate identity.

Evidence is collective where a bounded exact result combines several official
facts. Each attached observation must establish one declared input, and the set
must establish the final claim. Formula/derivation text is required only for a
reviewed calculated result and must be non-empty.

Raw facts use a closed shape, not arbitrary source JSON. They preserve only
public commercial fields and are bounded before assembly. Private account
state, negotiated prices, credentials, and user-controlled identifiers are
discarded or trigger quarantine.

The parsed-source boundary accepts both normalized source rate facts and
source-native raw facts. A raw fact must name a stable logical term, commercial
impact, reviewed fallback reason, applicability conditions, provenance, and a
closed raw commercial fragment. This lets deterministic provider parsers retain
published formulas or shared allowances that cannot safely become a numeric
model-local rate; it is not permission to persist response bodies.

The canonical API retains audit evidence. UI projections deliberately remove:

- source and observation references;
- locators and raw source spelling;
- derivations and evidence arrays;
- catalog/pricing hashes and pair-commit internals.

This separation is one-way: UI payloads are derived from a validated accepted
pair and are never an input to collection or commercial comparison.

## Canonicalization and identity

All public objects are closed; unknown properties are rejected before limits,
sorting, or hashing. Input must be valid I-JSON, contain only Unicode scalar
values allowed by I-JSON, and use the schema's lossless numeric rules.
The parsed-source boundary represents an absent optional pricing condition by
omitting its property, even when a provider parser supplied it as `undefined`,
so absent values never enter canonical sorting or hashing.

RFC 8785 canonical JSON is used after semantic canonicalization. Set-like
arrays have one schema-owned sort key and reject duplicate identities. Source
sequences retain source order only where order is itself evidence.

Validation checks the complete graph for I-JSON once. Canonical object keys and
immutable applicability relations are identity-cached across validation and
projection, while repeated equal applicability values share one canonicality
check within the catalog. Resource limits use ordinary JSON byte length because
member ordering changes byte order, not UTF-8 byte count. Canonical
serialization remains authoritative for hashes and published bytes.

Stable resource IDs are SHA-256 hashes of domain-separated canonical identity:

- book: provider ID and reviewed `book_key`;
- offer: book ID and reviewed `offer_key`;
- term: offer ID, term kind, and reviewed `term_key`.

Amounts, validity, applicability, observations, display names, and array
positions are excluded. Keys are unique within their owner and may not be
derived from those changing fields.

Compaction groups equal semantic values and unions their applicability while
retaining all observations. Canonical output must be maximally compact for the
declared grouping keys. When the union itself exceeds one applicability's clause
or byte budget, assembly deterministically shards the equal-value group into the
fewest recursively bounded applicability variants it can publish; it does not
downgrade otherwise normalized rates or states merely because their selector
domain is large. Two shards with the same grouping key are valid only when
combining them would exceed an applicability bound. Unequal overlapping normalized values are not allowed;
only the connected affected component falls back to raw, while disjoint
variants in the same logical term remain normalized. Equivalent source
grouping therefore does not cause ID churn or duplicate UI rows.

Adapters may fill a missing applicability dimension only through a reviewed
provider rule that identifies the source's unqualified base row against an
explicit unequal alternative, such as standard versus long-context or
promotion false versus true. This is a source-schema normalization rule, not a
provider recommendation or a choice of cheapest offer. Without that exact
evidence, the dimension remains missing and overlapping unequal values fall
back to raw.

Offer partitioning follows the same best-effort rule. Moving one selector value
into a dedicated offer may remove that value from applicability, but sibling
values that still distinguish unequal prices remain on the retained offer.
Topology therefore cannot erase a reviewed price dimension and manufacture a
conflict that was not present in the source facts.

### Reviewed per-fact precedence

Conflict resolution is fact-local. A checked-in parser may attach a named
`resolution_policy` to an exact rate fact when a full audit establishes that one
first-party surface controls an unmarked weaker surface. Assembly applies that
policy only inside the same logical rate term and only when the reviewed fact
contains the complete applicability of the weaker fact and has exactly the same
published validity. All reviewed candidates must agree on both value and policy.

A narrower fact never erases a broader claim, one reviewed fact never overrides
another reviewed fact, and incomparable validity or applicability still
produces the ordinary `conflicting_values` fallback. A safely shadowed value
remains in the canonical audit trail as an informational `superseded_value` raw
variant with the policy name; it is excluded from commercial equality and
completeness. This makes the decision repeatable during refresh without hiding
its losing evidence.

Applicability differences must be modeled before precedence. Parallel billing
currencies, regions, routes, tiers, and other selectors are alternatives rather
than conflicting values; for example, a source that publishes both USD and EUR
rates carries `billing_currency` on each fact instead of treating denomination
as an implicit selector.

Source-kind precedence is deliberately narrower than rate precedence. For the
same exact model, a numeric usage fact suppresses a lower-ranked source's bare
`not_published` state. The reviewed order is billing catalog or scoped meter
inventory, price book, model catalog, then commercial terms. It never chooses
between unequal numeric amounts, turns absence into free, or overrides
`not_applicable`; those cases still fail closed.

These policies are code and review data, not a learned score. A full audit
rechecks their source semantics and may revise or remove them. Ordinary catalog
refresh reuses the checked-in rules, dynamically parses the current values, and
rejects changed source shapes, tied winners, or newly incomparable facts.

The commercial projection removes observations, names, source refs, snapshot
freshness, and informational raw facts. It retains every field that can change
selection, amount, units, allowances, offer relationships, charge bindings, or
model disposition.
Unsupported commercial raw values contribute their bounded raw facts, so an
unsupported price change is still a commercial diff.

## Presentation

### Representative table cells

The table derives input, cache, and output cells only from canonical price
books. It binds the model UID, gathers matching model-scoped books, and
considers model offers that can still apply. Provider-service offers never
compete for the representative model-token cells.

A numeric cell requires:

- exactly one applicable model offer;
- exactly one possibly applicable, validity-free `numeric` state after binding
  the model and any categorical value required by every offer-state clause;
- no possibly applicable raw `base_price` fact;
- exactly one logical term for the first present meter in the slot's reviewed
  meter precedence;
- validity-free variants that agree on one exact fiat price and whose combined
  applicability covers the complete numeric-state scope;
- a non-empty canonical unit expression.

Unresolved selectors do not by themselves make a price variable. The table may
project one context-qualified rate when every possible context in the numeric
offer state is covered by that exact denomination, amount, and unit. Conditions
remain in canonical pricing and model details; only the representative cell is
collapsed. Partial coverage, unequal values, or a selector that changes the
first applicable meter remains detail-only.

If a higher-priority meter is present but ineligible, the slot fails closed
rather than silently switching commercial meaning. Lower-priority meters remain
detail-only. The projection never adds terms, compares currencies, converts
provider credits, or chooses a minimum/maximum.

Representative token rates are displayed per million tokens when bounded exact
arithmetic succeeds. Other rates prefer one source-native amount and reviewed
fixed-unit scale when every observation establishes that same display and it
reproduces the canonical price exactly. When observations use different source
scales or describe a derived result, presentation chooses the first reviewed
scale that yields an exact finite decimal. Internal canonical rationals are
never exposed as UI fractions. The final fallback is a visibly truncated
decimal whose accessible copy says `approximately`; it is not used for
comparison or calculation. Display arithmetic never uses binary floating
point. USD uses `$` in visible copy and retains `USD` in accessible copy.

When no representative number exists, one dotted-underlined text status spans
all three price columns and exposes its explanation through the shared tooltip:

- an offer count when several model offers exist;
- `Varies` for one context-dependent model offer;
- `Free`, `Quote`, `Unpublished`, `Incomplete`, or `Details` for one
  non-representative model offer;
- `No model offer` when pricing detail exists but no model offer applies;
- `No offer`: an exact `not_applicable` disposition establishes that no public
  hosted pricing offer applies;
- `Unknown`: no reliable public book or disposition exists.

This is a model-level summary, not an input-price badge or an action request.
When at least one
representative number exists, unavailable sibling cells use an em dash.
`not_published` and `custom_quote` remain distinct from unknown.

### Model details

For a converged provider, the order is:

1. alternative model mechanisms;
2. independently selectable optional services;
3. automatic request components and related standalone request services;
4. the focused offer's context controls;
5. states, rates, additional contributed usage, and unnormalized warnings.

Offer selection is above its child controls. Alternative model mechanisms use
radio controls; optional services use independent checkboxes and never replace
the model mechanism. Informational groups focus their details without implying
selection. Changing the focused offer resets its context. A unique model
mechanism is fixed and summarized instead of rendered as a one-item selector;
this is not inference of a provider default.

The pricing-context controls filter applicability from explicit user selections. A
categorical selector with one possible value is fixed automatically and shown
as compact context rather than as a disabled selector. Exact
rate or allowance rows appear only when the current partial context proves that
they apply. Alternatives whose applicability is still unresolved remain hidden,
and the rate section prompts for exactly those missing dimensions. Resolved
rows do not repeat the chosen context. A single offer state stays in the offer
summary, while offers with several possible states show the resolved state
after context selection. The UI does not multiply usage, apply allowances,
estimate a request, or calculate a total. Each resolved rate instead shows its
known cost driver, reviewed trigger definition, aggregation boundary, and
earliest resolution phase. An unbound rate remains visible with an explicit
missing-signal note. Contribution bindings and billing mode are projected as read-only commercial
facts. Possibly applicable
raw base pricing marks the offer incomplete while normalized rows remain
available after resolution. Exact offer relations are shown as composition
context, and do not alter list-price selection. Small fully resolved target
sets name their offers; broad or partially loaded sets show the exact target
count instead of repeating placeholder labels. Raw allowance facts similarly
make only the allowance summary incomplete.

Numeric selectors preserve their canonical domain. Dimensions containing only
inclusive singleton ranges become discrete choices. When the distinct range
predicates are mutually exclusive and together cover the dimension's complete
non-negative domain, the detail projection emits ordered range choices instead
of asking for an arbitrary representative number. Token counts and cache TTLs
are partitioned over whole numbers; other numeric dimensions are partitioned
over continuous decimals. Range-choice labels preserve the exact mathematical
operators (`<`, `≤`, `>`, and `≥`) rather than paraphrasing their boundary
semantics. A selected range retains its exact bounds. The
applicability evaluator resolves a predicate only when that full selected range
is contained in or disjoint from it, while a partial overlap stays unresolved.
Ranges with a gap or overlap remain exact-value inputs and reject out-of-range
values. The UI never widens an exact price condition into a neighboring interval.

The compact detail and shared-offer payloads contain display-ready values, selectors, charge drivers,
and invocation billing context, not audit observations.
Source-native display strings are derived while the
validated observations are available and then emitted without their locators,
raw fields, or evidence arrays. Equal observations remain one row rather than
being expanded back into the source's flattened layout.

Provider pricing uses the same display rows but remains read-only: every
conditional rate and contribution row includes a human-readable applicability qualifier.
Provider-owned meters
and credits use reviewed vocabulary labels or native codes in visible copy;
their namespace-qualified syntax remains audit-only. The provider inspector
loads one resource chunk at a time and one offer only when expanded. Conditional
or validity-qualified offer states are rows in the inspector rather than only a
count in the summary. Simple applicability remains exact display copy; large DNF
is factored into a deterministic summary no longer than 180 characters while
the structured scope remains exact. Books whose offers contain only raw terms,
`not_published` states, and no normalized relations
are displayed separately as unresolved official rows. The inspector links once
to the canonical audit and keeps at most 20 display-safe unnormalized facts per
offer while reporting the complete count.

Provider-owned categorical values keep their exact canonical keys even when
those keys are wire-protocol identifiers rather than suitable UI copy. A
provider may define reviewed labels for its categorical vocabulary once at the
provider boundary. Canonical assembly attaches those labels to matching
provider atoms across every model and offer, including local pricing replay.
The website uses the same provider registry as a build-time fallback and
requires any label carried by the canonical vocabulary to agree with it, then
resolves labels by provider, dimension, and exact value. Values without a
reviewed label continue through the shared conservative formatter. Components
never contain provider- or value-specific label branches.

Generated-data tests require every configured label to match a current
vocabulary value and its UI projection, and reject duplicate labels inside a
selector so distinct canonical choices remain distinguishable.

The shared projection still decodes broader plan, capacity, enrollment, allowance, and settlement
fields while older provider partitions converge. Newly reviewed adapters do not populate those
groups, and the UI removes them provider by provider with the underlying data.

## Validation and bounded work

Admission has three ownership layers:

1. adapters decide whether facts are public, map exact commercial containers,
   perform reviewed calculations, and choose normalized versus raw;
2. serialized conformance validates only facts observable from the closed
   candidate, bound catalog, vocabulary, and constants;
3. publication composes provider transitions and validates the complete final
   pair.

Origin-sensitive parser decisions are never claimed as serialized checks.
Conversely, adapters cannot bypass closed-shape, canonicalization, ownership,
reference, conflict, or resource-limit validation.

Limits cover encoded input before decoding, semantic strings, raw facts,
numbers, unit factors and powers, selector shape/work, pre-compaction assembly,
resource counts, provider bytes, and whole-catalog bytes. Exact values live in
`pricingLimits`; changing them is an implementation calibration change backed
by fixtures, not a new semantic feature.

Fact-local unsupported structure or fact-local limit overflow becomes raw with
one canonical reason. Provider/container limits, invalid references, privacy
violations, noncanonical bytes, and output-envelope limits reject the provider
candidate.

## Provider-atomic publication

Collection parses every pricing source referenced by a fresh partition in the
same transaction. A fresh partition cannot cite retained or skipped source
bytes.

For each provider:

- a valid fresh partition advances with its matching catalog slice;
- a failed pricing refresh retains the previously accepted pricing partition,
  preserves its verification time, and records the current attempt and reviewed
  failure category plus its sanitized diagnostic reason in the refresh summary; an independently
  valid fresh catalog slice may still advance
  when the retained pricing partition remains compatible with it;
- a validated fresh-empty transition removes pricing while keeping the
  provider;
- intentional provider removal removes both sides;
- a reviewed safety-bound withdrawal removes pricing without requiring a
  source fetch, but cannot preserve an implicated unsafe catalog slice.

Safety findings override ordinary availability retention. Known-unsafe bytes
are never republished merely because a refresh failed.

After provider transitions, publication checks whole-catalog topology, identity,
I-JSON, and size once, while four work-conserving workers validate the provider
partitions. Canonical serialization runs concurrently with those independent
checks. The resulting exact pair candidate is deeply immutable, so commit does
not repeat validation before staging snapshots and atomically advancing one
pair manifest. Mirrors are repairable from that pointer after interruption.
Consumers therefore observe one accepted old pair or one accepted new pair,
never a mixed pair.

## Maintenance

Changes to pricing semantics must update:

- the closed schemas and canonicalization helpers;
- validation and commercial projection;
- representative and detail projections;
- adapter fixtures covering at least two real uses for a shared abstraction;
- accepted-pair transition tests when publication behavior changes;
- this document and affected provider guides.

Required behavior tests cover:

- semantic equality under source reordering and compaction;
- conflict, reviewed precedence, losing-evidence audit, and raw-fallback containment;
- partial applicability evaluation;
- exact unit/rational conversion boundaries;
- model outcomes and conservative table cells;
- audit-free initial and lazy UI assets;
- provider failure, retention, empty, removal, withdrawal, and crash recovery;
- exact catalog/pricing envelope binding.

The canonical asset may be substantially larger than a UI payload because it
retains audit evidence. That is intentional. Browser transfer budgets apply to
the compact `/ui/` projections, never to the decoded `data/pricing.json.gz` envelope.
