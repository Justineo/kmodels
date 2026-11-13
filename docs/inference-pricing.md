# Inference model ID pricing

Status: current

## Purpose

Given a provider, the exact model ID used for inference, and optional pricing conditions, identify
the applicable public prices and explain what is still needed to determine them. Model display,
name comparison and Kong compatibility do not establish this mapping.

This work does not build a request client, invocation protocol catalog, capability discovery system,
deployment configurator or execution policy engine. Those systems are not prerequisites for price
lookup. A missing request template, unknown release stage or unverified account access cannot by
itself suppress an otherwise evidenced price.

## Minimal data contract

Reuse canonical offers, rates, conditions and evidence. Add a small provider-scoped relation between
an exact inference ID and those existing commercial records:

```text
InferencePriceRule
  provider_id        exact registered provider
  model_id           exact provider-owned request identifier
  model_ref          existing catalog identity associated by evidence
  offer_refs         evidenced canonical commercial records
  fixed_selectors    only pricing values established by the ID mapping
  evidence           source references and owned source locations for the association
  execution_choices  legacy input compatibility only; current producers omit it
```

The mapping root also carries `offer_selections`: exact offer references and scoped commercial
claims with evidence, projected from canonical offer selection. It includes model and resource
offers and is bound to the same pricing data version. The decoded mapping is bounded to 32 MiB.

This is the semantic contract, not a second price-book format. Reuse the existing selector and
evidence representations when implementing it. Do not add surface IDs, case IDs, task enumerations,
HTTP paths, authentication configuration, account confirmations or lifecycle policy to this relation.

An ID can have multiple rules and multiple applicable prices. Do not choose the first rule, first
catalog row or first offer. Associations select exact offers rather than an entire book: one book
can contain distinct invocation mechanisms. They do not copy prices or permanently select one
rate variant. `model_ref` preserves catalog ownership and validation; lookup goes directly from the
exact request ID to the associated offers without alias resolution or a catalog-name join.

`fixed_selectors` contains exact pricing values established by the ID mapping, such as a billing
Region, deployment scope or commercial profile geography. These are constraints, not defaults.
Combine them with runtime selectors by conjunction: equal values agree, absent values are filled,
and conflicting values exclude that rule. A caller cannot override an ID-fixed value. Other
commercial conditions remain on canonical price applicability. A scope such as Regions A or B does
not establish one fixed Region; retain its evidenced alternatives rather than selecting one or
inventing a categorical value. Do not add a general constraint engine without a consumed source
contract that requires it. The mapping cannot create an otherwise absent commercial restriction.

Routing geography, source/billing Region and physical execution location are distinct facts.
Likewise, an ID or requested tier establishes a served tier only when explicit commercial evidence
says so. ID-fixed conditions never create additional catalog identities or version rows.

Associations reference model-scoped offers. A service book's related model references (for example,
fine-tuned inference or tool charges) do not establish the base model's request-ID tariff. Independent
source rules remain independent for refresh and withdrawal; when they select the same offer and
conditions, lookup returns one candidate with their combined evidence.

Preserve the original ID, including punctuation and case. Matching is exact within a provider unless
the provider explicitly documents another equivalence. A regional-looking prefix is not evidence of
billing Region, processing geography, a base ID or a price multiplier. Price identity and model
display identity remain separate; mapping records reference existing catalog identities without
renaming or merging them.

An unresolved private deployment/profile name does not trigger account discovery or a generic
resource wizard. Report unknown. Additional resource/model information may be accepted only when
an independently reviewed provider pricing rule explains why it is necessary to identify a price.

## Lookup semantics

Input is `provider_id`, `model_id`, optional `choices`, exact native `selectors`, `evaluated_at`,
and an optional `offer_ref`. A choice is `{ dimension, value }`, where values use the existing
canonical/provider categorical atom shape. Registered dimensions are account plan, execution, billing mode,
resource kind, service tier, requested service tier, served service tier and speed.

The result exposes `available_choices`, `missing_choices` and `unresolved_choices`, together with
native missing conditions and exact candidate selectors. Each choice exposes its book, offer or
condition ownership in `targets`. Account plan identifies a separately evidenced agreement;
execution and actual tier select conditional rates inside it. Model IDs never establish account
enrollment. Available choices are probed under the
other current choices and native constraints; they are not a Cartesian product. Only the chosen
value's native binding is filled in. Context such as region or context length stays unresolved
until supplied; it is never guessed from the source row used to normalize a tier.
Unknown coverage remains visible alongside positive matches. Equal semantics preserve all offer
identities and may still require `offer_ref`. `execution_mode` and the mode result fields remain
compatibility conveniences; current storage uses `offer.selection` and root `offer_selections`.

`createCommercialPriceLookup` uses the same matching implementation for either
`{ kind: "model", provider_id, model_id }` or `{ kind: "resource", provider_id, book_ref }` subjects.
A resource subject identifies a price family, not a fabricated model ID. Without a `meter`, lookup
returns the applicable schedule and its relationships. With a `meter`, both lookup APIs resolve
only that meter's rates and required conditions. Unrelated terms and service relationships do not
create dependencies. Unclassified raw evidence remains conservatively relevant because its meter
is unknown. An unknown meter is not a zero price.

Original IDs remain evidence references. An unrelated offer reference cannot disambiguate conflicting
model identities. Lookup requires no billable quantities and performs no total-cost aggregation.
Consumers may invoke it separately for different conditions within the same request.

Return the original query, evidence status and all surviving commercial candidates:

- `matched`: the mapping and supplied conditions establish applicability for the returned prices.
  Without a meter filter, several meters may be returned. This is a price schedule, not a monetary total.
- `candidates`: evidenced price rules remain possible, but additional commercial conditions or an
  explicit commercial offer choice are needed. Return the candidates with their applicability and
  missing conditions. Published numeric rates with imprecise validity remain visible as candidates
  with an `unresolved_validity` gap. Their original validity labels accompany the amounts, and the
  lookup still reports the unresolved effective time. Do not collapse them into a quote or select an
  arbitrary representative.
- `unknown`: no reliable mapping or usable price evidence establishes an answer. Include the reason,
  such as unreviewed ID, ambiguous identity, withdrawn mapping evidence or unresolved raw pricing.
  Incompatible supplied conditions are explained rather than silently replaced.

Keep mapping uncertainty distinct from missing conditions and from an empty result under known
conditions. `unreviewed_id` and `ambiguous_identity` describe unknown associations;
`unresolved_price` means the association is known but price evidence is incomplete.
`unreviewed_execution_mode` means a compatible offer lacks reviewed mechanism metadata for a
mode-filtered query. Legacy mappings still work without mode selection. An absent classification
never defaults to `request`; a known unsupported mode returns `no_applicable_price`.
`incompatible_conditions` means supplied conditions conflict with the ID's fixed scope;
`no_applicable_price` means no published price survives the conditions and evaluated time.
The last two reasons display **No applicable prices**, separately from **Price mapping unknown**.
They describe the available snapshot, not provider support or account eligibility. Preserve
association evidence even when conditions exclude every candidate. Region, endpoint/API,
context length, retention policy, quality, speed or service tier belongs in the query only if the provider's
commercial evidence makes it relevant. Preserve existing validity, conflict and freshness semantics.
Equal visible amounts alone do not erase different commercial conditions. Optional accounting
bindings do not make otherwise equivalent unit-price quotes conflict.

Exact cache-write TTL columns qualify variants of the same meter. Selecting geography must retain
TTL when the surviving cache-write variants require it. Input/output-only lookup must not require
cache-write TTL. Numeric states summarize coverage; rate variants own condition dependencies.
Non-numeric and raw scopes retain their own uncertainty. An absent selector never proves that a
provider does not support caching.

Observed charge selectors remain observed: a requested route does not establish the served tier.
The matcher can report the missing commercial value and its reviewed acquisition source without
requiring a full protocol model. Never use an arbitrary model row to attach a provider-wide fee.

## Runtime queries

Lookup returns snapshot identity and canonical `evaluated_at` even for an unknown ID. Evaluation
time accepts RFC 3339, normalizes offsets to UTC without losing fractional precision, and defaults
to the snapshot generation time. The original query remains unchanged. Each candidate includes its
owning `book_ref`, selected offer with applicable terms/variants, referenced contribution rates,
effective selectors, mapping evidence and remaining gaps. Effective selectors include both
ID-fixed and caller-supplied facts.

Initialize lookup from a complete portable price-data export and its bound mapping. Resolve missing
pricing conditions before treating candidates as applicable unit prices. Query different groups
of usage independently when their conditions differ. No billable quantity or cost component is
supplied. Replace price data and mapping together; consumers may retain the returned snapshot
identity for their own accounting. There is no request ledger or cost evaluator in Kmodels.

## Provider evidence requirements

Provider guides own official sources and semantics. Deterministic fixtures verify those rules;
parser success or retained publication alone does not establish discovery completeness.

Verify direct IDs and explicit price aliases, one ID with conditional prices, IDs containing routing
or geographic information, unknown mappings, and known conditions excluding all candidates.
TypeSafe's model/alias tables establish direct request identifiers. Bedrock's published profile IDs
must be joined to separately evidenced commercial scope and source-Region tariffs. OpenAI served
tier and Anthropic served speed/geography remain observed commercial inputs.
For a literal Bedrock Geo ID that is unambiguous within its AWS partition, the card's Runtime
availability can establish source Regions without fetching destination topology. Multiple Geo
profiles still require profile-specific scope, and malformed explicit evidence cannot fall back to
a broader overview. Request-field authority also matters: the Rerank API's required `modelArn`
supersedes a generic model-card Runtime template; a bare model ID must not masquerade as that ARN.

Identity and price evidence may come from different official sources. Provider parsers emit direct
ID/offer-key facts, and assembly resolves those keys against canonical offers for the evidenced
model. Source changes replace associations; an older mapping cannot revive a withdrawn alias.
Optional protocol/capability documents are not prerequisites for independently established prices.

## UI and evidence

Preserve the model list and ordinary model details. Show exact inference model IDs separately from
display names. For an ID, show matching prices, the conditions that affect them, and evidence status.
Use existing rate units and commercial offer groups. Group IDs with identical matching rules and
pricing inputs and retain the group's mapping evidence. When all IDs share one group, show each
as a copyable value. When prices or conditions differ, show one picker with each exact ID as an
option and a copy button for the selected ID. When switching IDs, retain a selected offer that
still has candidates. Switching IDs or offers retains inputs whose exact value and unit remain
available in the destination conditions. Decimal buckets retain their exact bounds.

The header shows the catalog's primary identifier as a copyable value without a separate visible
label. Pricing uses explicit associations for that record and shows each inference ID as a copyable
value even when it equals the catalog ID.
If the mapping is unknown, show that status and keep the catalog ID in the header. An ID mapping
owned by another catalog record is excluded even when its literal value matches the current
record's catalog ID. Catalog aliases remain searchable and available in the catalog identifier index.

The matcher retains candidate rates for programmatic resolution. A condition is a predicate on
price applicability, regardless of how many values are published. A singleton does not establish
the caller's Region, enrollment, requested preference or observed outcome. Only evidenced ID
bindings and caller inputs establish those facts for public lookup; omitted conditions remain
missing even when the snapshot publishes one value.

The inspector browses published price schedules. It uses the sole published categorical, exact
decimal or decimal-bucket value for a required condition when it agrees with the remaining
candidates' fixed selectors. Display these values as plain text under **Price scope**, separately
from editable **Usage conditions**. The scope describes the prices being shown, not facts inferred
about a real request or a claim that other usage is unsupported. Do not require a confirmation click
for a sole published price scope. Keep the predicate in canonical rates and public lookup; removing
it would incorrectly make a conditional price universal. Do not turn a varying condition into a
model property merely because one model or filtered view has one published value.
Resolve native singletons from the ID's unselected domain before replacing mapped dimensions with canonical controls. Keep the
native price scope and its exact selection instead of an equivalent one-option canonical picker.
Native selection preserves sibling prices that omit the dimension; it does not broaden a commercial
claim's scope or resolve missing evidence. Apply this ordering to inference-ID, ordinary model and
provider-resource pricing. A sole account-plan option still requires explicit enrollment selection.
The inspector prompts for any remaining choices before displaying rates and explains unresolved
evidence after those choices are complete. Unknown mappings are labeled unknown. Condition controls
offer published values that the shared matcher can still consider for the selected ID, pricing
plan, and time. An unfilled condition disappears when the matcher no longer requires it for
the remaining prices. Explicit user selections remain visible and editable. If a combination
excludes every price, the controls remain available so the viewer can revise their inputs.
Switching a tier can reveal its newly required conditions without a separate invocation
configuration step.
Commercial controls use shared labels such as Request, Batch, Realtime and Served
speed. A sole canonical condition value is applied automatically only when its mapped scope covers
all remaining price contexts. Sharing one offer ID is insufficient: a speed specific to Request
must not eliminate Batch before the viewer chooses the request mode.
Inferred values are derived afresh from explicit choices, so a changed plan or request mode can
restore alternatives. Check a value's automatic applicability without that dimension's explicit
choice or its resolved native bindings: selecting a scoped value cannot make it prove its own
coverage. Distinguish a field with one value in the unselected ID domain from a field narrowed to
one value by other choices. Only the former becomes fixed scope. The latter can fill automatically
but keeps its original alternatives in an editable control. Editing that control replaces
incompatible explicit choices; inferred values are never copied into the explicit-choice state.
The same effective tier/speed combination must have the same controls regardless of selection order.
Fixed scope uses descriptive text without form-control borders or dropdown arrows. Multiple scoped
rate qualifier values remain explicit choices and share one Usage conditions fieldset and grid with native
selectors such as context and endpoint. Canonical mapping does not create a separate UI category.
Account-plan choices remain in Plan. Residual offer ambiguity uses the existing offer picker only
when no canonical account-plan control exists. Changing execution preserves the account plan and
clears the selected offer and dependent condition inputs. Changing the account plan clears dependent
execution and tier selections. Account-plan alternatives remain available across usage filters;
execution alternatives remain available within the selected account plan.
When a model has no verified ID association, preserve its ordinary catalog prices and explicitly
state that those prices are not verified for the requested inference ID.
Known associations with no applicable price do not fall back to unfiltered catalog rates.
Compact official source links, verification/freshness status and explanations may be disclosed
progressively. Full evidence arrays, document hashes, source fragments, extraction traces, raw
observation bundles and audit envelopes remain outside UI payloads. This evidence rule also applies
to ordinary pricing. Method/path, general capabilities, deployment confirmations and request
templates are outside this lookup UI.

## Compatibility and implementation limits

Canonical catalog identities and audit payloads remain independent of the portable package.
The unit-price package uses schema `2.0`; retired calculator inputs are unsupported. The mapping is
`/pricing/inference.json`, not a second price-book format.

When present, its hash participates in the existing accepted-pair identity, recovery journal and
UI data version. Without a mapping, legacy pair identities and canonical payloads remain unchanged.
The optional `data/inference-pricing.json` mirror is recovered from the same accepted transaction.

Pair preparation validates the complete mapping's schema, evidence, snapshot identity and
commercial-selection equality/completeness before checking provider lookups. Each lookup receives
only selections for offers in its complete price-data partition, including unmapped offers.
This avoids repeatedly schema-cloning other providers' selections. Global checks still reject
missing, duplicate, unknown or mismatched selections, including for providers without ID rules.
The published mapping remains complete. Public lookup input isolation and independent price-data
schema/semantic validation remain unchanged; producer validation does not replace consumer checks.

Website publication validates mappings through the public lookup and emits compact ID/candidate
references plus the matching conditions. The public lookup and interactive website execute the same
matching function. Conditions, validity, term relationships and local semantic-equivalence numbers
are sufficient for that decision; the website receives no copied prices, accounting formulas or
audit evidence. Existing offer projections supply every displayed amount. Selected variant indexes
identify their corresponding rows, preserving conflicts even when formatted amounts look equal.
The inspector evaluates its immutable matching data directly. When the selected ID and plan need
finite choices, it indexes only compatible clauses from their current candidate rows and only
dimensions that need those choices. Categorical options use set membership, while numeric choices
reuse the exact predicates. A compatible clause that omits a dimension admits all its published
options. The inspector checks individual options with the shared matcher when validity gaps or
repeated predicates require the full evaluation.
The UI derives status, missing conditions and visible rows from the same match result, and
reevaluates at precise validity boundaries. A decimal bucket selects the published range; it does
not invent a representative token count. Public query inputs retain exact decimal selectors.

The stored model-detail payload shares identical offer-matching data across that model's request
IDs. Each ID retains its own rules and fixed selectors; the loader restores the complete matcher
input before any query. References point only to an earlier full entry with matching clocks.
This keeps repeated regional/profile IDs within the existing detail-size budget without dropping
conditions, alias evidence, unknown prices, or canonical variant indexes.
Repeated applicability clauses and their typed conditions use local dictionaries; compact
variant tuples preserve validity and contribution targets. Identical selector options share
an earlier entry independently. Every reference is restored and checked before public matching.
Empty referenced-rate arrays are omitted from storage and restored before matching; nonempty
contribution targets retain their complete referenced terms.

Coverage is limited to explicit adapter associations. Unmapped identifiers remain unknown. Provider
parsers emit direct ID/offer associations without an invocation graph. Public model labels on services
that require private deployment names do not establish those private request IDs. Provider guides own
specific evidence limits. Stored-data adoption is separate from source extraction or projection
implementation.

`vp node scripts/canonicalize-commercial-selection.ts` prepares an offline migration of the accepted
canonical price records; `--write` atomically adopts the validated pair and rebuilt projections.
It removes the previous scalar execution field and emits selection claims with the same owned
policies used by collection. It asserts that all IDs, monetary facts, native applicability,
validity, accounting bindings, relationships, core catalog and source revisions are unchanged.
It does not fetch sources or rewrite captured inputs. The previously reviewed Vercel/Together
Batch partitions remain independently priced contracts; this metadata migration does not split
or merge any further offers.
