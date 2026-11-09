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
```

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

Input is `provider_id`, `model_id`, optional canonical pricing conditions, and an optional
`offer_ref` copied from a candidate when the caller selects a commercial offer. Omitting it retains
all candidates; it never chooses the cheapest or first offer. An unrelated offer reference produces
`no_applicable_price` for a known ID and cannot disambiguate conflicting model identities. The same matcher
supplies exported results and the website. It must not depend on `InvocationCatalog` or execute a
request. Existing exact calculation remains responsible for quantities, aggregation and totals.

Return the original query, evidence status and all surviving commercial candidates:

- `matched`: the mapping and supplied conditions establish applicability for the returned prices.
  Several meters or additive charges may apply; this does not promise one scalar price or a complete
  monetary total without billable quantities.
- `candidates`: evidenced price rules remain possible, but additional commercial conditions or an
  explicit commercial offer choice are needed. Return the candidates with their applicability and
  missing conditions. Published numeric rates with imprecise validity remain visible as candidates
  with an `unresolved_validity` gap. Their original validity labels accompany the amounts, and the
  calculator still requires an exact effective time. Do not collapse them into a quote or select an
  arbitrary representative.
- `unknown`: no reliable mapping or usable price evidence establishes an answer. Include the reason,
  such as unreviewed ID, ambiguous identity, withdrawn mapping evidence or unresolved raw pricing.
  Incompatible supplied conditions are explained rather than silently replaced.

Keep mapping uncertainty distinct from missing conditions and from an empty result under known
conditions. `unreviewed_id` and `ambiguous_identity` describe unknown associations;
`unresolved_price` means the association is known but price evidence is incomplete.
`incompatible_conditions` means supplied conditions conflict with the ID's fixed scope;
`no_applicable_price` means no published price survives the conditions and evaluated time.
The last two reasons display **No applicable prices**, separately from **Price mapping unknown**.
They describe the available snapshot, not provider support or account eligibility. Preserve
association evidence even when conditions exclude every candidate. Region, request mode, endpoint/API,
context length, cache TTL, quality, speed or service tier belongs in the query only if the provider's
commercial evidence makes it relevant. Preserve existing validity, conflict and freshness semantics.
Equal visible amounts alone do not erase different commercial conditions or accounting rules.

Observed charge selectors remain observed: a requested route does not establish the served tier.
The matcher can report the missing commercial value and its reviewed acquisition source without
requiring a full protocol model. Never use an arbitrary model row to attach a provider-wide fee.

## Runtime handoff

Lookup returns the calculation `snapshot` identity and canonical `evaluated_at` even for an unknown
ID. Evaluation time accepts the same RFC 3339 input as the calculator, normalizes offsets to UTC
without losing sub-millisecond precision, and defaults to the snapshot generation time when omitted.
The original query remains unchanged. Each candidate includes its owning `book_ref`, selected
`offer` with applicable terms/variants, referenced contribution
rates, effective `selectors`, mapping evidence and remaining gaps. Effective selectors include both
ID-fixed and caller-supplied values. Preserve them when passing `offer.id` to calculator discovery
or calculation; passing only the original query selectors would lose the conditions fixed by the ID.

Initialize lookup and calculator from the same complete calculation export and its bound mapping.
The application supplies the request's evaluation instant to lookup and passes the returned
`evaluated_at` to calculation. It resolves offer choices and missing pricing conditions before
treating candidates as applicable prices, then
supplies separately observed billable quantities. A matched mapping is not a complete cost result.
The application replaces lookup and calculator together after validating a refreshed pair and may
retain the snapshot identity with its request accounting record. No second price store, universal
invocation registry, account discovery or model-name resolution is required for this handoff.

## Provider evidence requirements

Provider guides own official sources and semantics. Deterministic fixtures verify those rules;
parser success or retained publication alone does not establish discovery completeness.

Verify direct IDs and explicit price aliases, one ID with conditional prices, IDs containing routing
or geographic information, unknown mappings, and known conditions excluding all candidates.
TypeSafe's model/alias tables establish direct request identifiers. Bedrock's published profile IDs
must be joined to separately evidenced commercial scope and source-Region tariffs. OpenAI served
tier and Anthropic served speed/geography remain observed commercial inputs.

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
option and a copy button for the selected ID. Switching within a group keeps the pricing inputs.

The header labels the catalog's primary identifier `Catalog ID`. Pricing uses explicit associations
for that record. A single inference ID equal to the catalog ID is labeled `Same as Catalog ID`, with
the copyable value in the header.
If the mapping is unknown, show that status and keep the catalog ID in the header. An ID mapping
owned by another catalog record is excluded even when its literal value matches the current
record's catalog ID. Catalog aliases remain searchable and available in the catalog identifier index.

The matcher retains candidate rates for programmatic resolution. The inspector uses the sole
published categorical or exact decimal value for a required condition when it agrees with the
remaining candidates' fixed selectors. The applied value appears beside the rates as context.
The inspector prompts for any remaining choices before displaying rates and explains unresolved
evidence after those choices are complete. Unknown mappings are labeled unknown. Condition controls
update after every selection. An unfilled condition disappears when the shared matcher no longer
requires it for the remaining prices. Explicit user selections remain visible and editable.
Switching a tier can reveal its newly required conditions without a separate invocation
configuration step.
When a model has no verified ID association, preserve its ordinary catalog prices and explicitly
state that those prices are not verified for the requested inference ID.
Known associations with no applicable price do not fall back to unfiltered catalog rates.
Compact official source links, verification/freshness status and explanations may be disclosed
progressively. Full evidence arrays, document hashes, source fragments, extraction traces, raw
observation bundles and audit envelopes remain outside UI payloads. This evidence rule also applies
to ordinary pricing. Method/path, general capabilities, deployment confirmations and request
templates are outside this lookup UI.

## Compatibility and implementation limits

Preserve existing catalog identities, v1 catalog/pricing payloads, calculation schemas and exact
arithmetic. The independent `createInferencePriceLookup` is additive; it does not replace the original
calculator. The mapping is `/pricing/inference.json`, not a second price-book format.

When present, its hash participates in the existing accepted-pair identity, recovery journal and
UI data version. Without a mapping, legacy pair identities and canonical payloads remain unchanged.
The optional `data/inference-pricing.json` mirror is recovered from the same accepted transaction.

Website publication validates mappings through the public lookup and emits compact ID/candidate
references plus the matching conditions. The public lookup and interactive website execute the same
matching function. Conditions, validity, term relationships and local semantic-equivalence numbers
are sufficient for that decision; the website receives no copied prices, accounting formulas or
audit evidence. Existing offer projections supply every displayed amount. Selected variant indexes
identify their corresponding rows, preserving conflicts even when formatted amounts look equal.
The UI recomputes status, missing conditions and visible rows together as conditions change, and
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
