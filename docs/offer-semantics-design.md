# Canonical commercial selection

Status: implemented. Canonical offer selection replaces the scalar offer execution field.
The calculation schema remains 1.0; commercial metadata travels through a separately bound mapping.

## Contract and ownership

Consumers express commercial choices in a shared vocabulary and receive exact offer references and
native calculation selectors. They do not interpret provider offer keys. Equal descriptors do not
merge offers, and a descriptor change does not change an offer's ID.

An offer is a coherent, identified commercial contract owning terms, states and relationships.
Separate tariff scope, enrollment, allocation, accounting or explicit composition evidence can
establish separate offers. A heading, amount, endpoint, model task or protocol alone cannot.
One evidenced contract can span several mechanisms. An independently charged service or running
capacity belongs in its own resource book, with exact relationships to other charges.

Rate qualifiers stay on terms: geography, context, modality, TTL, quality and actual served tier
do not become offers merely because they affect many rows. Vercel/Together Batch contracts retain
their reviewed separate tariffs and result-item accounting; their native operation labels remain
in evidence. No further split or merge is required by canonicalization.

The admitted scope includes model inference, independent services, running capacity and existing
adjustments. Subscriptions, reserved commitments, negotiated contracts and other excluded products
remain outside admission. Schema vocabulary does not authorize collecting them.

| Layer                | Authority                                                   | Consumer responsibility                     |
| -------------------- | ----------------------------------------------------------- | ------------------------------------------- |
| Book                 | Model/resource identity and resource kind                   | Identify the charged subject                |
| Offer                | Contract identity, billing basis, states and relationships  | Identify eligible commercial contracts      |
| Term/variant         | Meter, amount, unit, applicability, validity and accounting | Identify charges inside the contract        |
| Selection projection | Evidenced canonical values and exact native bindings        | Discover and select across ownership layers |

## Wire representation

`offer.selection` is an optional bounded array of scoped claims:

```ts
{
  dimension: "served_service_tier",
  coverage: "complete", // complete | partial | not_applicable
  applicability: { any_of: [{ all_of: [/* exact native context */] }] },
  validity: /* optional published interval */,
  alternatives: [{
    value: { namespace: "kmodels", value: "standard" },
    applicability: { any_of: [{ all_of: [/* exact native tier binding */] }] },
  }],
  observations: [/* source reference, owned locator and bounded raw fact */],
}
```

The existing applicability algebra preserves disjunctions of conjunctions. Claims are scoped by
their owning offer/book model set, their explicit applicability and validity. Complete coverage
has alternatives; not-applicable coverage has none; partial coverage can preserve known alternatives
without claiming completeness. A missing claim does not prove rejection or support.
Optional `excluded_values` records evidenced negative facts within the same scope. For example,
an ordinary/session contract can remain partially classified while its independent Batch contract
proves that Batch does not belong to this offer. Exclusions cannot also be positive alternatives.

One claim can carry request and live-session alternatives on the same offer. Different offers can
carry the same descriptor. Correlated claims can describe request + Fast and Batch without Fast:
the resolver intersects their scopes and exact bindings. Independent dropdown arrays never become
the authoritative contract.

Billing mode and resource kind project their existing authoritative fields. Tier/speed claims
project exact native rate predicates and retain validity and matching observations; those native
predicates remain the calculation authority. No rates are moved merely to normalize their labels.

## Vocabulary and normalization

The registered dimensions are:

| Dimension                | Definition and limit                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------- |
| `execution`              | Ordinary request, independently submitted Batch, or live session; transport does not prove a tariff |
| `billing_mode`           | Existing usage, capacity or other admitted charging basis; not a service tier                       |
| `resource_kind`          | Existing independently priced subject class; services are not all capacity                          |
| `service_tier`           | The tariff's class where the source does not designate requested/served ownership                   |
| `requested_service_tier` | A requested preference; does not establish the billed result                                        |
| `served_service_tier`    | The observed billed service class                                                                   |
| `speed`                  | Observed performance class, independently of service-tier naming                                    |

The current normalizations are exact mappings of tariff discriminators, not promises of identical
cross-provider SLAs. Standard, Priority, Flex, Fast, Ultrafast and Optimized remain distinct values.
A broader classification is not emitted as an exact choice. Unreviewed values retain provider
namespace and identity in the same discovery interface.

Provider-owned policies explicitly admit native values; there is no runtime string heuristic.
xAI's documented Default processing maps to canonical Standard, with the exact native `default`
selector returned for calculation. Its upstream Fast/Priority response alias remains owned by its
accounting contract. OpenAI's Fast tariff stays Fast even where its acquisition mapping accepts a
returned Priority value. Anthropic Fast remains a separate speed dimension. A global
Priority = Fast alias would erase these distinctions and is forbidden.

Free and included remain price states. No requested-tier choice fills a served-tier condition.
Actual billing needs the observed result; planning may explicitly supply a hypothetical outcome.

## Producer policies and evidence limits

Declarations live beside each owning commercial adapter, with shared assembly and projection.
Selection is derived after canonical term compaction, so repeated source rows do not expand the
provider's precompaction envelope or produce different metadata from stored-data migration.
The registry dispatches those declarations; it contains no task/endpoint/key classifier.
The declarations use adapter-owned keys to locate reviewed contracts, not to infer their meaning.
The mapping compiler resolves native Batch operation associations against the assembled offers.
Fresh extraction and stored-input replay therefore use the same conversion; source facts retain
their native operation predicates, and providers with retained unsplit offers remain unchanged.

| Provider families                                                  | Execution evidence                                                                                                | Canonical qualifier mappings                                                          |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Anthropic                                                          | Owned ordinary/Batch tariffs                                                                                      | Standard/Fast speed                                                                   |
| Bedrock                                                            | Exact Converse/invocation-log versus Sonic accounting bindings; owned Batch tariff                                | Standard/Priority/Flex/Ultrafast tier; Standard/Optimized speed                       |
| Azure                                                              | Exact request versus Realtime accounting bindings; owned router/Batch tariffs                                     | Standard/Priority/Flex served tier                                                    |
| OpenAI                                                             | Exact request versus Realtime accounting bindings; owned Batch tariff                                             | Standard/Fast/Ultrafast served tier                                                   |
| Gemini, Vertex                                                     | Exact generation/interaction or partner request accounting; live bindings only where present; owned Batch tariffs | Standard/Priority/Flex tiers; Gemini's native Batch resource qualifier                |
| DashScope                                                          | Exact request or Realtime accounting bindings; owned Batch tariff                                                 | Unreviewed values remain native                                                       |
| Vercel                                                             | Independently bound image/video/rerank request charges; owned Batch tariff                                        | Standard/Priority/Flex/Ultrafast served tier; Standard/Fast speed                     |
| Databricks                                                         | Owned pay-per-token request contract                                                                              | Standard/Priority served tier                                                         |
| Fireworks                                                          | Owned serverless usage request contract                                                                           | Standard/Priority service tier                                                        |
| Mistral                                                            | Owned ordinary/Batch contracts                                                                                    | Standard/Priority served tier                                                         |
| xAI                                                                | Owned ordinary, direct media, live voice and Batch contracts                                                      | Default → Standard and Priority served tier                                           |
| Cerebras, Cohere, DeepSeek, Kimi, Meta, Ollama, Together, TypeSafe | Their admitted direct request contracts; Kimi/Together owned Batch contracts                                      | Other values remain native                                                            |
| SageMaker                                                          | Model software request contract, separately from running resources                                                | Serverless native on-demand/provisioned-execution qualifiers remain provider-specific |
| Provider resources, including Hugging Face and shared services     | Execution not applicable; existing billing basis/resource kind                                                    | Reviewed native rate qualifiers remain independently scoped                           |

For families using accounting evidence, every normalized rate must have a matching reviewed
acquisition locator and none may prove the opposite mechanism before a whole-offer claim is complete.
Missing bindings or mixed request/session acquisition remain partial. This deliberately withdraws
old assertions based only on model capabilities or endpoint support. For example, Vercel's generic
generation accounting does not distinguish an ordinary request from a session; a realtime tag
alone cannot fill that gap. Parsing or accounting improvements can supply later evidence without
changing the consumer contract.

Canonical selection does not add source fetching dependencies. Missing evidence remains explicit;
there is no fabricated Standard default or inference from a token unit.

The owned Batch contracts declare tier/speed axes not applicable where no such native tariff
qualifier is published. An explicitly parsed native qualifier takes precedence over that default.
This prevents a Batch candidate from becoming an unresolved Fast alternative merely because it
has no speed column, while genuinely unreviewed offer families retain partial coverage.

## Query and matching

`createInferencePriceLookup` accepts the existing exact provider/model ID with `choices`, native
`selectors`, evaluation time and an optional offer reference. `createCommercialPriceLookup` accepts
the same choices with either a model subject or an exact resource book subject:

```ts
{
  subject: { kind: "model", provider_id: "xai", model_id: "grok-4.3" },
  choices: [
    { dimension: "execution", value: { namespace: "kmodels", value: "request" } },
    { dimension: "served_service_tier", value: { namespace: "kmodels", value: "standard" } },
  ],
}
```

Resource subjects use `{ kind: "resource", provider_id, book_ref }`; they do not invent model IDs.
Exact references remain necessary for calculation and for residual ambiguity between same-class
contracts. They do not negate semantic selection: consumers discover them from canonical choices.

The resolver validates snapshot identity, preserves ID-fixed conditions, intersects scoped choices,
and binds only exact selected native values. Geography and other context are not filled from an
arbitrary source row. Correlated context remains required. It evaluates terms/validity with the
existing matcher and returns:

- `available_choices`: canonical or provider-residual values under the other choices and native inputs;
- `missing_choices`: unresolved commercial dimensions;
- `unresolved_choices`: explicit gaps in classification, including gaps beside positive candidates;
- exact offer/term references, effective native selectors, missing native inputs and price gaps;
- original applicable relationships and referenced contribution rates.

Complete unsupported choices differ from incomplete evidence. Lookup does not choose the cheapest
candidate, merge identical labels, assume quantities, or silently include/exclude related services.
The caller supplies independently charged components to the exact calculator, whose existing
composition checks remain authoritative. Services are not mutually exclusive model plans.

The website uses the same commercial resolver for inference and resource/fallback controls. It
keeps observed outcomes distinct from preferences, retains residual offer selection and presents
services/capacity in their existing charge groups.

## Persistence, compatibility and verification

The bound `/pricing/inference.json` root stores `offer_selections` with observations reduced to
source/locator evidence. It covers model and resource offers. Canonical publication checks that the
projection exactly matches the current offers; stale references or changed source revisions cannot
silently survive compilation. The decoded resource is bounded to 32 MiB.

The old `execution_mode` query translates to a canonical execution choice. Legacy mapping inputs
with `execution_choices` are accepted for compatibility; current producers omit them and store no
scalar execution field. Exact calculation exports omit selection metadata, preserving schema 1.0.

`scripts/canonicalize-commercial-selection.ts` reads accepted canonical data, validates the legacy
field at that boundary only, applies the same producer policies and rebuilds mappings/projections.
Before adoption it asserts unchanged IDs, prices, applicability, validity, accounting, relationships,
core catalog and source revisions. It performs no live refresh and leaves captured inputs intact.

Required regression coverage includes one offer/multiple mechanisms, multiple offers/same semantics,
impossible combinations, native alias equivalence, observed/requested independence, partial evidence,
validity, native-condition conflicts, resource capacity and additive relationships. Package/browser
checks must consume the same matching implementation. The frozen calculator's conformance vectors
remain the evidence for exact arithmetic and component composition.
