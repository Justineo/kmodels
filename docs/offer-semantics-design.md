# Canonical commercial selection

The [relationship boundary](commercial-topology.md#offers-and-dimensions) defines Offer versus
condition. Provider guides own concrete decisions and source evidence. This contract lets consumers
select prices without interpreting provider extraction keys.

## Ownership

| Layer             | Meaning                                                     | Example                                        |
| ----------------- | ----------------------------------------------------------- | ---------------------------------------------- |
| Book              | Charged subject                                             | Model, search service, running instance        |
| Offer             | Independently evidenced commercial relationship             | Public usage, Paid Tier, Contributor program   |
| Term/variant      | Conditional charge, state or adjustment                     | Batch input, Priority output, shared allowance |
| Selection mapping | Canonical choice with explicit ownership and native binding | Standard maps to xAI default                   |

Execution does not identify a commercial relationship. Ordinary/Batch/live rates stay in the same
public offer unless separate enrollment, obligations or billing relationships are evidenced.
Account programs with data-use obligations remain distinct. A condition may qualify either offer
eligibility or a term. Unified querying never erases that ownership.

The consumer contract is unit-price resolution for a subject, meter and conditions. Conditions
apply to the usage being priced by one lookup, not to every token in a request. Cache-write TTL
therefore qualifies variants of one meter even when multiple TTLs occur in the same request.
Neither simultaneous usage nor an optional usage-counter binding establishes a new offer or term.

## Representation

Produced `offer.selection` claims declare `target: book | offer | condition`. This field is an
index of facts, not authoritative ownership of every indexed fact. Claims retain their exact
applicability, optional validity, alternatives with native bindings, coverage and source evidence.

Coverage is complete, partial or not_applicable. Missing claims do not establish support or
rejection. Complete alternatives preserve correlations: Batch does not gain Priority/Fast from an
adjacent online table. Requested tier never establishes actual served tier.

`source_contexts` maps source extraction keys to predicates inside the relationship. Parsers may
retain sync/batch and service-operation contexts to preserve accounting. Association compilation
resolves each context into the relationship offer and exact fixed selectors. Consumers do not
interpret these source keys. Calculation exports omit source-context and selection metadata;
the separately bound inference mapping carries canonical choices.

| Dimension              | Target    | Meaning                                                   |
| ---------------------- | --------- | --------------------------------------------------------- |
| account_plan           | Offer     | Enrolled pricing program, including data-use obligations  |
| billing_mode           | Offer     | Usage/capacity charging basis                             |
| resource_kind          | Book      | Independently charged subject class                       |
| execution              | Condition | Evidenced ordinary request, Batch or live session         |
| service_tier           | Condition | Tariff class without specified requested/served ownership |
| requested_service_tier | Condition | Request preference                                        |
| served_service_tier    | Condition | Actual billed service class                               |
| speed                  | Condition | Actual performance class, independently of tier           |

Provider policies admit exact aliases. xAI Default maps to Standard; Priority and Fast are not
globally equivalent. Labels do not promise equivalent SLAs. Unknown values retain provider
identity and evidence gaps. Free/included remain price states, never defaults inferred from
missing rates or model capabilities.

Where execution classification remains partial, a native invocation-mode predicate preserves
known tariff separation without inventing request/live support. Streaming alone does not establish
a live session; one asynchronous video job does not establish Batch.

## Compilation and migration

Provider extraction first preserves exact source prices and conditional accounting. The ownership
compiler combines tariff contexts under the public relationship, makes formerly implicit context
conditions explicit, preserves model restrictions, and remaps dependent references. Account
programs partition these terms using reviewed eligibility evidence, including raw-only prices.

Independent services and capacity retain their books. Model-specific service rows become
model-qualified terms; allowances retain one shared pool and exact targets. Contributions and
relations remap with their target prices. A same-book exclusion relation is removed only when
disjoint conditions prove the same exclusion. Aggregation and acquisition do not change merely
because their enclosing offer changes.

`scripts/migrate-offer-boundaries.ts` applies the same compiler to accepted data. Dry run is the
default; `--write` adopts the validated pair and rebuilt projections with a local backup. It checks
monetary/accounting facts, raw evidence, core catalog, source revisions, freshness and mapped
identities. No live collection is required. Single-relationship IDs and non-colliding term keys stay
stable; merged or partitioned offer/term IDs change with ownership. Book and source
identities remain stable. Replace snapshot and mapping together; old references cannot be reused.

## Consumer contract

Model/resource lookup accepts canonical choices, native selectors, evaluation time and an optional
exact offer reference. Available choices expose `targets` alongside exact offer references.
The result distinguishes candidate relationships, missing request/outcome inputs, unsupported
combinations and incomplete classification. It never selects the cheapest candidate or supplies an
unobserved outcome. Exact quantities and independent charge components remain caller-owned.

Choice resolution groups branches by their exact native selectors and normalizes each complete
scope union once. Repeatedly normalizing a growing union makes interaction cost quadratic in
regional claims. Scope intersections reuse the narrower input when containment proves the result;
partially overlapping scopes still use the full intersection. These shared lookup rules preserve
every regional predicate without inferring geography from a tier selection.
The immutable selection graph also has a lazy index by dimension. Claims with identical bindings,
coverage, exclusions and validity share one scope union; subsumed clauses are removed once.
Validity and supplied facts are still evaluated on every query. Replacing the selection graph
creates a new index, and weak references release old snapshots. Available choice vocabulary is
indexed separately from its dynamic applicability. Within one inference query, alternative probes
reuse price-row matches for identical native selectors while retaining their own commercial scope
and missing conditions. Query results are not cached across evaluation times or selector changes.

The website groups editable controls into **Plan** and **Usage conditions** and displays fixed
published qualifiers as descriptive **Price scope**. A sole published value still qualifies a price;
it neither establishes an actual usage fact nor becomes an unconditional model property. The
website can display the schedule for that explicit scope without requiring a confirmation click,
while public lookup keeps omitted usage facts unresolved. Account plan selects the
agreement. Request mode and billed tier qualify its rates. Resource kind and billing basis remain
descriptive subject/plan properties. Services are separate charges rather than mutually exclusive
account plans. Planning estimates use explicit hypothetical inputs.

Legacy execution_mode queries translate to execution choices. Claims without target remain
readable, but current producers declare ownership. Portable price-data schema 2.0 supports canonical
execution predicates; package 0.4.0 exposes only unit-price lookup. Replace price and mapping inputs
together. There is no legacy cost evaluator.

## Required verification

Verify multiple modes in one relationship, separate account programs sharing modes, impossible
Batch/tier combinations, aliases, requested/served independence, partial evidence, raw-only program
prices, model-qualified services, shared allowances and remapped contributions. Verify source
replay, exact calculation, UI/public lookup parity and snapshot-bound references. Stored migration
does not claim fresh source verification.

Canonical controls share the same preservation rule as native conditions: an edit retains every
other applicable selection and removes only values excluded by the new domain. There are no
special reset lists for account plan, execution, speed or tier. The UI labels the `speed` dimension
**Speed**. A speed class and a service tier are distinct provider facts; a shared value label such as
Standard does not establish equivalence. Actual versus requested ownership stays in the dimension
contract and its evidence, not in an ambiguous field heading.

Automatic selection and fixed presentation are separate decisions. A commercial field that has
alternatives for the selected subject keeps an edit control even if another choice temporarily
leaves one applicable value. Inferred values fill that control without entering explicit-choice
state. Both selection orders must preserve the same editing paths in inference and resource views.
The shared `optimized` speed value displays as **Latency optimized** in canonical controls,
native selectors, fixed scope and condition annotations. Raw identifiers and source evidence retain
`optimized`; display formatting does not change price matching or reinterpret other dimensions.
