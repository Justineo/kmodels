# Pricing

Status: implemented

## Decision

Kmodels publishes one canonical pricing resource. The model catalog does not
contain a second flat-price projection, and the website never falls back to
one.

The resource models a provider's current public commercial snapshot as:

```text
provider snapshot
  └─ price book
       └─ offer
            ├─ state
            └─ logical term
                 └─ applicability-qualified variant
```

This hierarchy is the minimum needed to preserve distinct offers, billing
modes, meters, units, conditions, allowances, and unsupported public facts
without expanding every observed combination into a model-local rate list.

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
successful collection writes `data/pricing-inputs.json.gz` with the minimal
public parsed facts needed by provider pricing assembly. `vp run
compile:pricing` reads that input, reassembles every replayable provider,
validates the complete canonical resource, advances the accepted pair, and
regenerates its projections without network access.

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

The website is built from three closed runtime payloads:

- `/ui/catalog/index.json` contains only fields needed to render, search,
  filter, and sort;
- `/ui/catalog/pricing.json` contains build-time representative pricing and is
  loaded concurrently with the catalog before the application mounts;
- `/ui/details/<provider>/<chunk>.json` contains bounded deferred model details
  and compact price-book views.

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

The current contract normalizes:

- usage, capacity, subscription, one-time, and hybrid offer identities;
- normalized rate terms with exact denomination and compound unit;
- applicability over reviewed categorical, boolean, and bounded decimal
  dimensions;
- numeric, free, custom-quote, and not-published offer states;
- simple usage allowances and denomination credits with explicit targets and
  reset semantics;
- model-scoped and provider-service price books;
- base offers, add-ons, and exact or explicitly unnormalized compatibility;
- reviewed provider-owned commercial atoms;
- exact adapter calculations whose result and provenance are bounded.

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

`not_published` is not the same as either outcome above. It is an offer state:
the offer exists, but the provider does not publish its price. `custom_quote`
likewise identifies an offer whose amount requires provider contact. Missing
data never means free, and a numeric zero remains a numeric rate.

### Price books

A book has:

- a provider-owned stable key and derived ID;
- either a model scope or a provider-service scope;
- one or more offers;
- claim-local scope evidence and resource provenance.

`scope.model_refs` is the current exact model projection used by the website.
Scope observations collectively cover that projection and cannot widen beyond
their observed subjects.

### Offers

An offer represents one selectable billing mechanism. It has:

- a stable key and derived ID within its book;
- `base` or `add_on` role;
- one exact billing mode;
- applicability-qualified states;
- logical pricing terms.

Add-on compatibility is either an exact set of base offers, every base offer
in the same book, or explicitly not normalized. Unsupported compatibility
retains a commercial raw fact so a wording change cannot disappear as
provenance-only.

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

Provider units, meters, dimensions, categorical values, billing modes, credit
codes, and allowance resets are keyed by provider and kind. Each published key
has a non-empty reviewed definition in that provider's vocabulary.

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

Stable resource IDs are SHA-256 hashes of domain-separated canonical identity:

- book: provider ID and reviewed `book_key`;
- offer: book ID and reviewed `offer_key`;
- term: offer ID and reviewed `term_key`.

Amounts, validity, applicability, observations, display names, and array
positions are excluded. Keys are unique within their owner and may not be
derived from those changing fields.

Compaction groups equal semantic values and unions their applicability while
retaining all observations. Canonical output must be maximally compact for the
declared grouping keys. Unequal overlapping normalized values are not allowed;
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

The commercial projection removes observations, names, source refs, snapshot
freshness, and informational raw facts. It retains every field that can change
selection, amount, units, allowances, compatibility, or model disposition.
Unsupported commercial raw values contribute their bounded raw facts, so an
unsupported price change is still a commercial diff.

## Presentation

### Representative table cells

The table derives input, cache, and output cells only from canonical price
books. It binds the model UID, gathers matching books, and considers base
offers that can still apply.

A numeric cell requires:

- exactly one applicable base offer;
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

Exact per-token values may be displayed per million tokens when bounded exact
arithmetic succeeds. Other standard and reviewed provider units retain their
native unit. A finite exact rational is rendered as a decimal; a
non-terminating rational remains a fraction. Display never uses binary floating
point or an unmarked approximation. USD uses `$` in visible copy and retains
`USD` in accessible copy.

When no representative number exists, one dotted-underlined text status spans
all three price columns and exposes its explanation through the shared tooltip:

- an offer count when several base offers exist;
- `Varies` for one context-dependent base offer;
- `Free`, `Quote`, `Unpublished`, `Incomplete`, or `Details` for one
  non-representative base offer;
- `No base offer` when pricing detail exists but no base offer applies;
- `No offer`: an exact `not_applicable` disposition establishes that no public
  hosted pricing offer applies;
- `Unknown`: no reliable public book or disposition exists.

This is a model-level summary, not an input-price badge or an action request.
When at least one
representative number exists, unavailable sibling cells use an em dash.
`not_published` and `custom_quote` remain distinct from unknown.

### Model details

The order is:

1. base offers and add-ons;
2. the selected offer's context controls;
3. states, rates, allowances, and unnormalized warnings.

Offer selection is above its child controls. Multiple choices use compact
wrapping radio groups, so native radio-key behavior owns arrow keys instead of
navigating the model list. Changing an offer resets its context. A unique base
offer is fixed and summarized instead of rendered as a one-item selector; this
is not inference of a provider default.

The calculator filters applicability from explicit user selections. A
categorical selector with one possible value is fixed automatically and shown
as compact context rather than as a disabled selector. Exact
rate or allowance rows appear only when the current partial context proves that
they apply. Alternatives whose applicability is still unresolved remain hidden,
and the rate section prompts for exactly those missing dimensions. Resolved
rows do not repeat the chosen context. A single offer state stays in the offer
summary, while offers with several possible states show the resolved state
after context selection. The calculator does not multiply usage, apply
allowances, estimate a request, or calculate an invoice. Possibly applicable
raw base pricing marks the offer incomplete while normalized rows remain
available after resolution. Raw allowance facts similarly make only the
allowance summary incomplete.

The compact detail payload contains display-ready exact values and selectors,
not audit observations. Equal observations remain one row rather than being
expanded back into the source's flattened layout.

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
- a failed refresh retains the previously accepted provider pair, preserves its
  verification time, and records the current attempt and reviewed failure
  category;
- a validated fresh-empty transition removes pricing while keeping the
  provider;
- intentional provider removal removes both sides;
- a reviewed safety-bound withdrawal removes pricing without requiring a
  source fetch, but cannot preserve an implicated unsafe catalog slice.

Safety findings override ordinary availability retention. Known-unsafe bytes
are never republished merely because a refresh failed.

After provider transitions, the complete catalog and pricing envelopes are
validated again. Publication stages immutable snapshots and atomically advances
one pair manifest; mirrors are repairable from that pointer after interruption.
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
- conflict and raw-fallback containment;
- partial applicability evaluation;
- exact unit/rational conversion boundaries;
- model outcomes and conservative table cells;
- audit-free initial and lazy UI assets;
- provider failure, retention, empty, removal, withdrawal, and crash recovery;
- exact catalog/pricing envelope binding.

The canonical asset may be substantially larger than a UI payload because it
retains audit evidence. That is intentional. Browser transfer budgets apply to
the compact `/ui/` projections, never to the decoded `data/pricing.json.gz` envelope.
