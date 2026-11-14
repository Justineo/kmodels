# Vercel AI Gateway

Status: current

## Offer boundary

[Shared ownership rules](../commercial-topology.md#offers-and-dimensions) govern this provider.

Public Gateway usage is one relationship per exact routed model subject. Sync/Batch, actual tier/speed, endpoint and provider route qualify terms. Keep source operation evidence and conditional result-item quantities; do not inherit synchronous generation-lookup fields into Batch. Independent search and other service books remain separate charges; model-specific service contexts become model conditions within their public relationship. Included/contribution facts retain exact scopes and targets.

The source authorities and evidence limits below remain authoritative. Adapter keys such as
`sync`, `batch`, `usage`, and operation/model-specific labels describe extraction contexts;
`source_contexts` binds them to the published relationship and its conditions. They are not
additional user-selectable agreements. Migration preserves monetary facts, conditional accounting,
source revisions and independently charged subjects.

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
- independently callable Perplexity, Exa, Tako, Parallel, Browserbase and DeepSeek gateway search
  and fetch tools.

Free-credit allowances, BYOK and Credits settlement, plans, team controls, budgets, logs, Trace
Drains, invoice totals, Zero Data Retention and Custom Reporting surcharges remain outside the
request price book. Vercel's generation `total_cost`, `market_cost`, `gateway_cost`,
`surcharge_cost`, and `upstream_inference_cost` are settlement observations, not inputs used to
reconstruct public list cost.

## Gateway catalog scale

Each exact gateway model ID owns its model-scoped price book, and provider-native search tools add
shared service books. A gateway catalog therefore needs roughly one book per published model plus a
few service books, so the provider book budget must cover the manifest's declared model ceiling
rather than a smaller flat catalog size. The budget remains a bounded safety guard: it is not a
pricing or coverage claim, and an adapter that exceeds it still fails assembly.

## Direct inference ID association

The model-list API's literal `id` is the request identifier. Associate it with the existing
model-scoped offers, retaining all route, region, speed, served-tier and context conditions.
The creator prefix is not the serving provider. Do not strip it, invent regional prefixes or aliases,
or resolve a private `vmc/` virtual model without its independently known configuration. Unknown
IDs remain unknown. A removed list entry withdraws its direct association on the next accepted refresh.
Independent search-service books do not become base-model inference tariffs.

The official [Batch guide](https://vercel.com/docs/ai-gateway/models-and-providers/batch-processing)
establishes the exact `<model>-batch` relation to an independently listed base model. Both IDs can
be used for Batch; the suffixed ID cannot be used synchronously. Preserve both catalog identities.
Their model books share the published Batch rates through source-derived facts. Extraction retains
`operation=batch/sync` as source evidence. Canonical assembly combines the `batch` and `usage`
extraction contexts into one relationship, preserving exact execution predicates and the native
invocation mode where ordinary/live classification remains incomplete. Unrelated operations,
region and route conditions remain. A Batch ID fixes Batch execution and the creator route. The base ID references
both mechanisms where evidenced. Consumers use canonical commercial choices. Batch is established
by its owned tariff and result-item accounting; generic generation telemetry does not establish
an ordinary-request versus live-session tariff. Those execution scopes remain partial, while exact
native price conditions and evidenced speed/tier choices remain usable. No protocol selection
or request template is involved. Batch never borrows another hosting provider's route price.

Batch bindings aggregate successful result items. Synchronous generation-report, response and
stream acquisition mappings do not establish Batch result locations; keep independently supported
quantity calculations but omit those acquisition paths until a Batch contract establishes them.
Realtime gateway type/tag evidence classifies a dedicated live-session offer as `realtime`;
an ID containing the word realtime is not evidence. Other API operations and service tiers remain
conditions, not new offers.

Use the list's actual Batch amounts, including cache exceptions, rather than assuming a uniform
discount. Anthropic regional Batch rates additionally require the documented 50% rule and regional
adjustment policy; derive them from the model list's explicit standard regional token amounts.
Keep region as a price condition. Other creators do not acquire Anthropic regional Batch prices.
Withdrawing the Batch commercial relation withholds affected ID associations while preserving
ordinary catalog evidence and unrelated mappings. Optional accounting documents do not gate
independently established ID prices. This is a commercial evidence dependency, not invocation discovery.

The public list covers IDs whose complete price may still be unknown. Missing model-page or endpoint
evidence remains a price gap; the association cannot supply a missing tariff. Virtual-model settings,
account settlement, BYOK discounts and effective fallback model discovery remain caller-owned.

## First-party sources and resilience

The parser returns model observations, independent search-service prices and acquisition contracts
in one explicit source envelope. Model selection and model-row ordering do not own service or
accounting storage. Compilation captures those source facts once and can replay service-only
results without a synthetic catalog model. The exhaustive model-list count guard remains required
for production collection; model and route joins retain their existing evidence.

The model list is the exhaustive inventory and primary model-level price source. The documented
per-model endpoint API enriches exact route identity and route-specific rates. A public model page
is fetched when the model-list price object is empty, contains only an unqualified per-request
field, or an endpoint publishes X Search pricing keys
that require independent page evidence. Endpoint discovery covers only IDs published for
synchronous use: the reviewed Batch guide states that IDs ending in `-batch` are the complete
batch-capable set and that synchronous requests do not accept them, so their endpoint documents are
not requested and their amounts come from the model list. Without that reviewed statement the
transport keeps the conservative full-ID endpoint discovery. The exact hourly-audio disclosure can
fill an empty Input cell on a streaming transcription card. Compound hover prices are read from the
page's own immutable client registry and normalized only when the primary amount and advertised
variant count agree.

The claim-local companions are:

- `models-and-providers.md` for model and endpoint discovery;
- `rest-api.md` for generation lookup and native usage counters;
- `fast-mode.md`, `service-tiers.md`, and `regional-inference.md` for effective selectors;
- `batch-processing.md` for exact Batch/base ID relationships, creator-only routing and regional discounts;
- `web-search.md` for generic search rates, parameters, and successful-call metadata;
- `getting-started/image.md` for completed image results;
- `video-generation.md` for requested duration and completed video results;
- `speech-to-text.md` for measured input-audio duration; and
- `reranking.md` for a successful rerank result; and
- `modalities/realtime/gpt-live.md` for the exact GPT-Live final cumulative session duration.

Every companion is optional at refresh time. A missing or changed field withholds only the pricing
input or commercial claim owned by that field. It does not erase sibling inputs, another search
service, model-list pricing, or the provider refresh. Malformed model rows are isolated, while an
identity disagreement, duplicate route ownership, truncated exhaustive list, unsafe count change,
or invalid pricing partition still fails closed.

Endpoint quantization metadata is not consumed by identity or pricing and cannot reject a price
document. Status zero positively establishes a live route. Other or missing health states withhold
that live-route assertion while preserving independently published route prices; the price book
does not claim real-time availability. Runtime health metadata cannot select a fallback amount.
Unconsumed reasoning representation and privacy metadata do not validate or select prices; a new
`interleaved` object cannot discard an otherwise valid model. An endpoint's nonzero search amount
with an unreviewed denominator stays raw in its native-search service book, preserving the verified
token rates in the inference book. A missing or unfamiliar companion field is local; a contradictory
model/route identity or duplicate route owner raises a structured constraint failure so a refresh
cannot silently replace the accepted partition with misbound or incomplete route prices.

Both payloads publish a `pricing.request` amount. The source omits it for almost every endpoint and
publishes a nonzero amount for one per-request model, so both an absent field and any published
decimal are accepted; a literal reviewed value would discard the entire endpoint document and with it
every route, route price, and video-input amount. No first-party page defines what one request unit
contains, so a nonzero amount becomes an `unknown_unit` raw fact with the `request` meter under the
`operation=request` scope instead of a denominator invented from token or search meters. The field
never becomes a `request` rate, and a model that publishes only this amount retains
`pricing_unit_unsupported` while its routes and any sibling rates stay published. The
`regional-inference` companion now states the unpinned-region default as a missing or `global`-scope
`inferenceEndpoint` field; the `gateway.served_region` absent marker follows the published
"don't pin a region … matching the `global` default" sentence instead of demanding one particular
`null` or missing-field phrasing.

The current model-detail payload publishes exact model/route search amounts, while its linked pricing
component labels X posts and profiles fetched per 1K items. Both owned contracts are required: a
canonical page and one matching backing model establish amounts; the reviewed component establishes
units. These become independent native-search fees with caller-supplied fetched-post/profile counts.
They do not borrow another seller's usage fields. Endpoint `x_search_post`/`x_search_user` observations
converge only when they agree exactly after scaling; absent, duplicate, malformed or disagreeing page
claims retain the endpoint's raw evidence. Field names alone do not establish a denominator.
A canonical page whose own backing model publishes no X-search amounts is not a contract violation:
the page is accepted with no search prices, so a model that cannot use X search keeps the endpoint's
raw meter instead of failing the dependency. Only a page with no readable canonical title or backing
model payload raises the constraint failure.

The image guide's AI SDK example returns `const { images } = await generateImage(...)`; that
returned array is the completed-image quantity. Older examples that expose the same result as
`result.images` remain equivalent evidence, but arbitrary image-related prose is not.

## Price normalization

The model-list and endpoint APIs publish per-token values. Kmodels scales them exactly to per-million
token display prices while retaining the original decimal and unit as evidence. Tier bounds become
non-overlapping inclusive ranges. Route prices add `route_provider`; endpoint rates override only
inside that exact route-qualified scope.

Service-tier `long_context.threshold` is the inclusive start of the long-context band, just like
the token-tier `min`. The preceding band ends at `threshold - 1`. Apply this interpretation to
both model-list and endpoint prices; adding one to the threshold creates a false singleton
context choice when Standard, Flex, and Priority share the same published boundary.

Fast mode uses the `speed` dimension. Named Flex or Priority prices use
`served_service_tier`, because Vercel bills the tier actually served rather than the requested tier.
Regional prices use `region`. This separation prevents a Fast rate from being misrepresented as a
service tier and permits speed, tier, route, and region to coexist on one rate.
Fast and regional Fast objects retain their published input/output/cache context tiers. Their
top-level scalar is not a flat rate over longer contexts when explicit tiers are present.

The model-list and endpoint default language-token price fields own `service_tier=standard` at
extraction. Fast, route and regional variants retain that scope; named service-tier fields own
their explicitly published tier. A missing Flex/Priority peer cannot change a default quote's
meaning. Non-language media components and independent service prices do not acquire that selector.

A `-fast` model with the published `fast` tag and an independently listed, fast-capable base model
uses the fast list price. Some fast-slug endpoint documents repeat the base model's standard
prices. They describe the documented standard-speed fallback only when their token and regional
amounts match the independent base record. Those rates retain their exact context bands under
`speed=standard`; the fast list amounts use `speed=fast`. An unexplained disagreement remains a
conflict instead of being silently relabeled.

Video duration rows with an omitted resolution or quality beside explicitly qualified siblings
use the source's `default` selector value, as image rows do. They are not wildcard prices over all
resolutions or qualities, and `default` does not infer a particular physical resolution.
Boolean audio and voice-control conditions require their own published values; a missing flag does
not become false because a sibling is true. Unresolved overlaps use the shared conflict fallback.
Native `duration_over_seconds` rows form ordered duration tiers within the same resolution, mode,
audio and voice-control scope. Preserve their strict lower bound and close the preceding band
inclusively at that threshold using the shared `duration_seconds` dimension. Fractional durations
remain exact: a tier over 15 seconds starts above 15, not at 16. A tier in one operation cannot
qualify another operation, and amounts never establish the threshold. This keeps HeyGen's normal
and extended-duration prices disjoint without treating advertised generation limits as tariff bounds.
Video model pages may publish a flat `$N/video` output rate instead of a duration rate; retain its
provider-published `video` unit rather than treating it as seconds. A transcription model page may
publish its input as `$N/hr` or `$N/sec`. These become `input_audio` quotes with the `hour` or
`second` unit respectively; the shared adapter scales hourly rates to processed audio seconds.
The denominator is read from the cell itself, so a priced
sibling keeps its own published unit. When the page describes one route and its Input cell is empty,
an exact summary quote per hour of audio supplies the same hourly input rate. An unrecognized denominator still rejects the page rather than
silently dropping the model.
Speech models may also publish `speech_output_cost_per_second`, which bills generated audio rather
than supplied input. Both the catalog entry and its endpoint may carry it; the amount becomes an
`output_audio` quote with the `second` unit that binds to generated audio seconds per job. It stays
independent of `speech_input_character_cost`, which remains a character-billed input rate, so a
model publishing either field keeps that rate instead of being reported as unpriced.
`capabilities.pricing.image_input_cost_per_image_usd` and
`video_input_cost_per_second_usd` add independently charged input-image and input-video terms.
Their bindings take billable input images and input-video seconds per generation job; they do not
reuse output duration or multiply input assets by generated sample count without evidence.

A visible model page fills an otherwise empty price object only when amount, denominator, and route
are unambiguous. A page is free only when every non-empty price column is `Free`. Detailed video rows
retain quality, resolution, and video-input conditions; image rows retain quality and resolution;
native web-search rows retain context tier. A missing or disagreeing detail registry leaves only the
affected term raw.
An otherwise valid model page may publish no usable pricing at all, including when the catalog and
its endpoint expose only empty or placeholder meters. That absence remains `unknown`; it does
not reject the complete catalog, become a free rate, or borrow a tariff from a sibling model.
An explicit numeric zero remains a numeric quote. A `varies_by_provider` catalog entry has no
unqualified executable rate: use the verified endpoint's exact route prices, including any route
whose own price is zero. A missing endpoint cannot turn the catalog's minimum or zero into a
route-independent fee. Equal-scope contradictory amounts survive extraction for canonical conflict
resolution; parsing order never chooses the winning quote.

Topaz Proteus, Starlight Precise 2.6 and Wonder 3.5 publish approximate prices subject to credit
rounding. Their detailed duration/resolution amounts remain evidence until a rounding contract
establishes executable USD charges. Kling's audio rows cannot acquire
`voice_control=false` merely because a separate row explicitly prices `voice_control=true`;
the public voice parameter guide does not establish that missing billing predicate.

The reviewed pricing component says listed token prices are off-peak and the published multiplier
applies during peak periods. With that claim and a valid native policy, publish distinct off-peak and
derived peak rates, retaining the policy as source evidence. The caller must supply the actual billing
period. The weekday/UTC/Chinese-holiday policy is not an executable calendar, and request time never
substitutes for a billed-period observation. A policy on one route cannot modify fixed-price siblings.
The renderer recognizer follows its bounded window/multiplier/holiday structure and owned return
text; minifier variable renaming cannot withdraw that unchanged contract.
Missing or changed basis wording and unsupported policy fields retain affected quotes as raw
`unknown_applicability`; independent non-token prices survive a recognized token policy.
The reviewed image-detail registry may put the price object directly under the model slug or
inside its `model` property. Both literal structures are parsed without executing JavaScript;
the wrapper cannot create a fictitious model named `model`.

The public Markdown model directory is a grouped presentation rather than exhaustive callable
inventory: it omits separately callable Batch IDs and includes service tools that are not models.
The no-key JSON model API remains the inventory authority; its response has no pagination cursor.
The per-model endpoint API owns route prices. Account generation history and billing endpoints do
not replace either public price surface.
Browserbase and DeepSeek Search/Fetch are independently callable tools listed in the public model
directory but absent from model JSON; all four corresponding model-endpoint probes return 404.
The already collected web-search guide therefore owns their tariffs without adding model rows or
making failed model routes a refresh dependency.

The search-price prose parser removes Markdown quote prefixes and folds whitespace before matching
reviewed sentences. Source line wrapping must not remove a known price; unrecognized commercial
wording still remains local. Public tool pages also contain structured `webSearchCallCost` base
amounts, but the inspected records omit Deep effort and excess-result/export pricing. The model
API and SDK do not provide a complete alternative search tariff. The guide therefore remains the
amount authority for the full search schedule.

## Search services

Provider-native web and Maps prices live in shared service books whose model references define
compatibility. Independently callable generic search tools are provider resources without a model
compatibility assertion. They appear in provider pricing and cannot make an unpriced model look
priced or add unrelated search services to every model detail.

Endpoint Web Search and X Search raw quotes retain their exact operation as well as route scope.
A missing denominator for ordinary Web Search cannot block a separately selected, known X Search
item charge. Selecting ordinary Web Search still exposes its own unresolved quote.

Independent search service books publish:

- Perplexity: `$5 / 1,000` successful requests;
- Exa: `$7 / 1,000` Auto or Fast requests, `$4 / 1,000` Instant requests, plus
  `$1 / 1,000` requested results above ten;
- Tako: `$7 / 1,000` Instant or Fast requests and `$12 / 1,000` Deep requests;
- Parallel: `$5 / 1,000` successful requests plus `$1 / 1,000` requested results above ten;
- Browserbase Search: `$7 / 1,000` requests regardless of the requested result count;
- Browserbase Fetch: `$1 / 1,000` plain raw requests, plus `$3 / 1,000` for proxies and
  `$3 / 1,000` for Markdown or JSON extraction; and
- DeepSeek Search and Fetch: `$0.75 / 1,000` billable requests for each independent service.

Browserbase Fetch retains independent provider-owned `format` and `proxies` conditions. The actual
upstream options determine the six disjoint totals; a requested format or an undocumented fallback
does not prove which option was billed. DeepSeek bills only successful nonempty upstream results
or page content, including results filtered before delivery. Failed, timed-out and empty responses
are unbilled. Generic successful-call telemetry does not prove that nonempty condition, so the
caller supplies the billable count. Fetch remains retrieval rather than model inference or search.

Exa and Parallel base and excess-result charges are additive terms on one offer. Their excess
quantity is the exact calculation `max(0, requested_results - 10)`, represented with a
unit-qualified constant and a zero-floor subtraction. Tako effort is the dedicated
`search_effort` selector rather than an overloaded operation or service tier. Tako inline-data
export and variable-cost cards remain separate raw surcharges beside numeric request rates.
Inline data depends on the fee per card and returned rows in each card's `content.export_pricing`;
variable-cost data depends on returned cards and their source. The default per-call cap is a spending
limit, never an additional rate.
The linked [Tako tariff](https://docs.tako.com/documentation/integrating-tako/contents/pricing)
defines a baseline plus source-dependent row charges, premium record classes and possible variable
minimums, with account-specific returned prices overriding list prices. Its current first-row
billing rules require the actual returned card. Neither the minimum row price nor a fixed request
fee can resolve that surcharge for a gateway result card.

## Published pricing inputs

Vercel's fixed first-party guides establish field-local acquisition contracts. Multiple facts with one
key are alternative AI SDK and Chat Completions request locations, not quantities to sum.

| Price-book need          | First-party input                                                 | Calculation or interpretation                                      |
| ------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| Input/output and context | Generation `native_tokens_prompt`, `native_tokens_completion`     | Direct only when one priced modality owns that side                |
| Reasoning visibility     | Generation `native_tokens_reasoning`                              | Published as an available input; no separate rate is invented      |
| Cache read/write         | Generation `native_tokens_cached`, `native_tokens_cache_creation` | Direct partitions when the members are present                     |
| Native web search        | Generation `billable_web_search_calls`                            | Successful billable calls per generation attempt                   |
| Route provider           | Generation `provider_name`                                        | Selects `route_provider`                                           |
| Fast mode                | `providerMetadata.gateway.routing.speed`                          | `fast` only when served fast; omission selects `standard`          |
| Service tier             | `providerMetadata.gateway.serviceTier`                            | Served Flex/Priority; omission selects `standard`                  |
| Region                   | Successful route metadata `inferenceEndpoint.geoRegion`           | Resolved region; a documented null endpoint selects global/default |
| Image count              | AI SDK image result `images` length                               | Completed generated images                                         |
| Video duration           | Request `duration` and successful result `videos` length          | Requested seconds multiplied by completed videos, per job          |
| Transcription duration   | Result `durationInSeconds`                                        | Input audio seconds on success                                     |
| Rerank request           | Presence of result `ranking`                                      | One successful rerank request                                      |
| GPT-Live duration        | `session.closed.usage.seconds`                                    | Final cumulative session duration; never sum snapshots             |
| Generic search calls     | `gatewayToolCalls` count for each gateway search tool             | Successful calls for that specific service                         |
| Exa/Parallel excess      | `numResults` / `maxResults`, including snake-case Chat fields     | Zero-floor subtraction of the included ten                         |
| Tako effort              | `effort` in AI SDK or Chat tool configuration                     | Selects Instant, Fast, or Deep request rate                        |

All generation-record fields are `conditional`: the authenticated lookup is asynchronous and the
runtime must retry a temporary “not found.” Terminal response selectors and successful result fields
are not stream-interrupt detectors. A non-terminal stream cannot be priced from missing terminal
metadata alone.

Search-count and regional-default evidence accepts whitespace wrapping inside the reviewed prose
without joining unrelated paragraphs. Service-tier evidence recognizes both the existing passive
omission wording and the explicit statement that AI Gateway omits the field when the provider
reports the standard tier. This omission default assumes the caller receives complete gateway
metadata; a client that drops that metadata needs request logs instead of guessing the served tier.
Region's absence default additionally requires the owned response statement that `inferenceEndpoint`
is null when no region is pinned. Request omission alone does not establish response-field semantics.
Losing that default statement removes only the default, while a still-documented resolved-region
field remains available.

The optional maintenance [semantic contract audit](../semantic-audit.md) independently checks the
meaning of emitted search counts, speed, tier and region mappings against complete original public
documents. Known missing mappings go directly to repair without a model call. Jev may request
review when source meaning contradicts an emitted contract; it never supplies a published fact.

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
- generated audio duration for speech synthesis, which no reviewed Vercel response field reports;
- realtime client-message counts and active-session duration outside the reviewed GPT-Live contract;
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
