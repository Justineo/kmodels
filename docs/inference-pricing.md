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
catalog row or first offer. Known constraints, such as an explicitly documented commercial profile
geography, are fixed selectors. Other commercial conditions remain on the canonical prices. The
mapping cannot create an otherwise absent commercial restriction or override conflicting evidence.

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
  missing conditions. Do not collapse them into a quote or select an arbitrary representative.
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
Use existing rate units and commercial offer groups. Expose a selector or comparison only when it
changes the candidate prices; do not concatenate task, URL, Region, lifecycle and execution scope
into opaque target/case options. Multiple IDs that share prices can be grouped without losing their
individual copyable values.

Missing conditions remain visible beside candidate prices. Unknown mappings are labeled unknown.
Condition controls update after every selection. An unfilled condition disappears when the shared
matcher no longer requires it for the remaining prices; explicit user selections remain visible
and editable. Switching a tier can reveal its newly required conditions without a separate
invocation configuration step.
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

Coverage is limited to explicit adapter associations. Unmapped identifiers remain unknown. Provider
parsers emit direct ID/offer associations without an invocation graph. Public model labels on services
that require private deployment names do not establish those private request IDs. Provider guides own
specific evidence limits. Stored-data adoption is separate from source extraction or projection
implementation.
