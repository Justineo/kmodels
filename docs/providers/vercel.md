# Vercel AI Gateway

Status: current

The model-page `+N more` count can describe only the default no-video-input variants. When the
reviewed pricing registry also contains video-input variants, validate the count against the
default subset and retain both complete groups, including each quality, resolution, and
`video_input` selector. The count is not a reason to discard the video-editing rates.

## Boundary

Vercel publishes a directly callable gateway catalog, so Kmodels admits every valid row from
`GET https://ai-gateway.vercel.sh/v1/models`. The exact `creator/model` ID is canonical and the
creator must equal `owned_by`.

Kmodels is the Vercel public price book and calculation contract. It publishes prices,
applicability, billable-quantity semantics, and first-party locations from which a caller can obtain
those quantities or selectors. It does not proxy a request, buffer a stream, poll generation
records, retain usage, apply account credits, or reconcile an invoice. The runtime is responsible
for capturing the generation ID and terminal metadata, retrying the asynchronous generation lookup,
deduplicating attempts, and evaluating the published calculation graph.

The in-boundary public price book covers:

- model input, output, cache, audio/image token, image, video, speech, transcription, rerank,
  realtime-message, and realtime-session rates when Vercel publishes them;
- route provider, regional inference, Fast mode, served service tier, context band, modality,
  quality, resolution, style, and other published applicability;
- provider-native web and Maps search attached to compatible model routes; and
- independently callable Perplexity, Exa, Tako, and Parallel gateway search tools.

Free-credit allowances, BYOK and Credits settlement, plans, team controls, budgets, logs, Trace
Drains, invoice totals, Zero Data Retention and Custom Reporting surcharges remain outside the
request price book. Vercel's generation `total_cost`, `market_cost`, `gateway_cost`,
`surcharge_cost`, and `upstream_inference_cost` are settlement observations, not inputs used to
reconstruct public list cost.

## First-party sources and resilience

The model list is the exhaustive inventory and primary model-level price source. The documented
per-model endpoint API enriches exact route identity and route-specific rates. A public model page
is fetched only when the model-list price object is empty. Compound hover prices are read from the
page's own immutable client registry and normalized only when the primary amount and advertised
variant count agree.

The claim-local companions are:

- `models-and-providers.md` for model and endpoint discovery;
- `rest-api.md` for generation lookup and native usage counters;
- `fast-mode.md`, `service-tiers.md`, and `regional-inference.md` for effective selectors;
- `web-search.md` for generic search rates, parameters, and successful-call metadata;
- `getting-started/image.md` for completed image results;
- `video-generation.md` for requested duration and completed video results;
- `speech-to-text.md` for measured input-audio duration; and
- `reranking.md` for a successful rerank result.

Every companion is optional at refresh time. A missing or changed field withholds only the pricing
input or commercial claim owned by that field. It does not erase sibling inputs, another search
service, model-list pricing, or the provider refresh. Malformed model rows are isolated, while an
identity disagreement, duplicate route ownership, truncated exhaustive list, unsafe count change,
or invalid pricing partition still fails closed.

## Price normalization

The model-list and endpoint APIs publish per-token values. Kmodels scales them exactly to per-million
token display prices while retaining the original decimal and unit as evidence. Tier bounds become
non-overlapping inclusive ranges. Route prices add `route_provider`; endpoint rates override only
inside that exact route-qualified scope.

Fast mode uses the `speed` dimension. Named Flex or Priority prices use
`served_service_tier`, because Vercel bills the tier actually served rather than the requested tier.
Regional prices use `region`. This separation prevents a Fast rate from being misrepresented as a
service tier and permits speed, tier, route, and region to coexist on one rate.

A `-fast` model with the published `fast` tag and an independently listed, fast-capable base model
uses the fast list price. Some fast-slug endpoint documents repeat the base model's standard
prices. They describe the documented standard-speed fallback only when their token and regional
amounts match the independent base record. Those rates retain their exact context bands under
`speed=standard`; the fast list amounts use `speed=fast`. An unexplained disagreement remains a
conflict instead of being silently relabeled.

Video duration rows with an omitted resolution or quality beside explicitly qualified siblings
use the source's `default` selector value, as image rows do. They are not wildcard prices over all
resolutions or qualities, and `default` does not infer a particular physical resolution.
`capabilities.pricing.image_input_cost_per_image_usd` and
`video_input_cost_per_second_usd` add independently charged input-image and input-video terms.
Their bindings take billable input images and input-video seconds per generation job; they do not
reuse output duration or multiply input assets by generated sample count without evidence.

A visible model page fills an otherwise empty price object only when amount, denominator, and route
are unambiguous. A page is free only when every non-empty price column is `Free`. Detailed video rows
retain quality, resolution, and video-input conditions; image rows retain quality and resolution;
native web-search rows retain context tier. A missing or disagreeing detail registry leaves only the
affected term raw.
The reviewed image-detail registry may put the price object directly under the model slug or
inside its `model` property. Both literal structures are parsed without executing JavaScript;
the wrapper cannot create a fictitious model named `model`.

The search-price prose parser removes Markdown quote prefixes and folds whitespace before matching
reviewed sentences. Source line wrapping must not remove a known price; unrecognized commercial
wording still remains local. Public tool pages also contain structured `webSearchCallCost` base
amounts, but the inspected records omit Deep effort and excess-result/export pricing. The model
API and SDK do not provide a complete alternative search tariff. The guide therefore remains the
amount authority for the full search schedule; see the [source investigation](../pricing-research.md).

## Search services

Provider-native web and Maps prices live in shared service books whose model references define
compatibility. The generic search books publish:

- Perplexity: `$5 / 1,000` successful requests;
- Exa: `$7 / 1,000` successful requests plus `$1 / 1,000` requested results above ten;
- Tako: `$7 / 1,000` Instant or Fast requests and `$12 / 1,000` Deep requests; and
- Parallel: `$5 / 1,000` successful requests plus `$1 / 1,000` requested results above ten.

Exa and Parallel base and excess-result charges are additive terms on one offer. Their excess
quantity is the exact calculation `max(0, requested_results - 10)`, represented with a
unit-qualified constant and a zero-floor subtraction. Tako effort is the dedicated
`search_effort` selector rather than an overloaded operation or service tier. Tako data export is
retained beside the numeric request rates as a raw variable surcharge because the amount depends on
requested rows and each result card's `content.export_pricing`.

## Published pricing inputs

Vercel's fixed first-party guides currently establish 25 acquisition facts. Multiple facts with one
key are alternative AI SDK and Chat Completions request locations, not quantities to sum.

| Price-book need          | First-party input                                                 | Calculation or interpretation                                 |
| ------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------- |
| Input/output and context | Generation `native_tokens_prompt`, `native_tokens_completion`     | Direct only when one priced modality owns that side           |
| Reasoning visibility     | Generation `native_tokens_reasoning`                              | Published as an available input; no separate rate is invented |
| Cache read/write         | Generation `native_tokens_cached`, `native_tokens_cache_creation` | Direct partitions when the members are present                |
| Native web search        | Generation `billable_web_search_calls`                            | Successful billable calls per generation attempt              |
| Route provider           | Generation `provider_name`                                        | Selects `route_provider`                                      |
| Fast mode                | `providerMetadata.gateway.routing.speed`                          | `fast` only when served fast; omission selects `standard`     |
| Service tier             | `providerMetadata.gateway.serviceTier`                            | Served Flex/Priority; omission selects `standard`             |
| Region                   | Successful route metadata `inferenceEndpoint.geoRegion`           | Resolved region; an absent endpoint selects global/default    |
| Image count              | AI SDK image result `images` length                               | Completed generated images                                    |
| Video duration           | Request `duration` and successful result `videos` length          | Requested seconds multiplied by completed videos, per job     |
| Transcription duration   | Result `durationInSeconds`                                        | Input audio seconds on success                                |
| Rerank request           | Presence of result `ranking`                                      | One successful rerank request                                 |
| Generic search calls     | `gatewayToolCalls` count for each gateway search tool             | Successful calls for that specific service                    |
| Exa/Parallel excess      | `numResults` / `maxResults`, including snake-case Chat fields     | Zero-floor subtraction of the included ten                    |
| Tako effort              | `effort` in AI SDK or Chat tool configuration                     | Selects Instant, Fast, or Deep request rate                   |

All generation-record fields are `conditional`: the authenticated lookup is asynchronous and the
runtime must retry a temporary “not found.” Terminal response selectors and successful result fields
are not stream-interrupt detectors. A non-terminal stream cannot be priced from missing terminal
metadata alone.

Base text input remains semantically bound but has no source-derived quantity method when a separate
cache partition is priced, because Vercel does not explicitly establish whether the native prompt
counter includes every priced cache partition. Aggregate native prompt/completion counters also do
not get assigned to one audio, image, or text partition when multiple token-priced modalities share
that side.

## Deliberate remaining gaps

The list price remains valid while a rate binding or selector source is absent. Current first-party
Vercel contracts do not establish an exact public input for:

- provider-native Maps call counts;
- character billing for text-to-speech;
- realtime client-message or active-session duration counts;
- per-modality audio, image, or video token partitions when aggregate native counters are ambiguous;
- output video-token counts;
- megapixels and effective image quality, resolution, style, or operation across every underlying
  provider;
- native-search context tier and media flags such as generated audio or voice control; or
- interrupted-stream finalization and attempt deduplication.

Known video-duration multiplication retains its calculation and surviving request/result locators
when a companion field drifts; the caller supplies the missing duration or successful-output count.
These are input-contract gaps, not reasons to drop exact public rates. Account totals and invoice
reconciliation are deliberately excluded rather than labeled missing.

## Horizontal comparison

| Capability                   | models.dev                              | LiteLLM                                              | Kmodels Vercel price book                                                                         |
| ---------------------------- | --------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Primary shape                | Compact model metadata                  | Runtime gateway plus flat model-cost map             | Auditable commercial books, applicability, and inputs                                             |
| Token/cache/audio rates      | Fixed cost fields and context tiers     | Broad cost keys and request-time calculator          | Exact rational rates with route/region/speed/tier conditions                                      |
| Tools and media denominators | Not represented by the core cost schema | Supported unevenly by provider-specific runtime code | Search requests/results, images, video seconds, audio seconds, characters, sessions, and raw gaps |
| Effective selector sources   | None                                    | Runtime-specific response handling                   | First-party served speed/tier/route/region contracts                                              |
| Calculation semantics        | No public quantity graph                | Python implementation and provider branches          | Closed, unit-validated, portable quantity graph                                                   |
| Provenance and partial drift | No per-rate observations                | Cost-map/runtime implementation provenance           | Source references, locators, field-local omission, and raw fallbacks                              |
| Runtime accounting           | Not a runtime                           | Included                                             | Deliberately excluded                                                                             |

models.dev remains an excellent compact catalog input, but its strict cost object is limited to
input/output/reasoning/cache/audio token amounts and context tiers; it cannot express Vercel search
services, media-duration denominators, route/region/speed/tier applicability, acquisition paths, or
raw variable surcharges. LiteLLM provides the runtime lifecycle Kmodels intentionally excludes and
supports many custom cost keys, but its Vercel adapter currently inherits the OpenAI-compatible chat
path and its cost map is principally flat per-model token pricing. Kmodels therefore complements a
gateway runtime: it supplies a more expressive, first-party, replayable price book while leaving
request execution, storage, budgets, and settlement to the consumer.

Collection and normalization are deterministic and require no LLM. The catalog and pricing
partitions publish atomically after validation.
