# Amazon Bedrock

Status: current

## Boundary

The Bedrock catalog represents public models and public rates that an AI Gateway can use to price an
upstream inference request. The shared pricing model is unchanged: model or service book, offer,
term, applicability-qualified rate, and optional charge binding. Bedrock-specific code only extracts
AWS source semantics and maps them into that contract.

Included:

- callable foundation, embedding, image, video, audio, and rerank models;
- on-demand and Batch inference rates;
- request-visible selectors such as Region, endpoint, deployment scope, service tier, context range,
  cache class/TTL, speed, modality, operation, resolution, and quality;
- Guardrails, intelligent prompt routing, Bedrock Web Search, and Nova Web Grounding when their
  charge is attributable to the proxied request.

Excluded:

- Provisioned Throughput and Reserved capacity commitments;
- model training, customization, imported-model runtime, and storage;
- Knowledge Bases, Flows, Data Automation, prompt optimization, and model evaluation;
- AgentCore Runtime, Browser, Code Interpreter, Gateway, Identity, Memory, Registry, Payments, and
  the rest of the AgentCore platform;
- Marketplace settlement, private discounts, taxes, account credits, and invoice reconciliation.

These exclusions are deliberate scope decisions, not missing price records. Capacity and training
can affect an account's total spend, but they do not define the public marginal rate of a normal
upstream generation request. AgentCore is an independent agent platform that works with models from
Bedrock or other providers; its infrastructure prices therefore do not belong in the Bedrock model
price book.

## First-party sources

The exhaustive catalog starts from the official
[model-card index](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards.html), follows its
bounded publisher indexes, and parses the linked model cards. Callable IDs and aliases come only from
each card's Programmatic Access table.

The official
[rerank support table](https://docs.aws.amazon.com/bedrock/latest/userguide/rerank-supported.html)
supplements model cards. It currently identifies Amazon Rerank 1.0 and Cohere Rerank 3.5 with exact
model IDs and Regions. This is necessary because a callable reranker can appear in the maintained
support table before it has a normal model card.

Public rates come from three machine-readable AWS Price List offers:

- [AmazonBedrock](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/current/index.json)
- [AmazonBedrockFoundationModels](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrockFoundationModels/current/index.json)
- [AmazonBedrockService](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrockService/current/index.json)

The Foundation Models feed has its own 16 MiB response ceiling so the growing native inventory
fits within a bounded acquisition budget. Oversized or malformed feeds still fail as pricing
dependencies rather than publishing a partial commercial partition.

The [Bedrock pricing page](https://aws.amazon.com/bedrock/pricing/) is an optional, narrower overlay
for reviewed OpenAI and Stability tables that can lead the bulk feeds. The exact
[Cohere Embed 4 Marketplace page](https://aws.amazon.com/marketplace/pp/prodview-j3fgisven2yrs) is an
optional product-specific overlay. AWS states that service pricing pages control when an
informational Price List differs, so an exact page row may replace only the same narrower scope.
The losing Price List amount remains informational evidence. Unequal observations within the same
reviewed page retain equal authority and become a bounded canonical conflict; their order cannot
select a winner.
If one reviewed provider panel temporarily contains no recognized pricing table, that drift is
reported for the panel while a recognized sibling panel can still contribute exact rates.
Exact model-card Pricing tables supplement the Price Lists when the card states the unit and
identifies the matching endpoint and inference-profile aliases. A partial bulk inventory cannot
suppress another published tariff or meter. Coequal card and bulk observations reach canonical
assembly together: equal amounts combine their evidence, while unequal overlapping amounts remain
bounded conflicts. A card does not silently override a native SKU. Kimi K3 currently publishes
Global and US cross-Region input, output, 30-minute cache-write,
and cache-read rates in its [model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-moonshot-ai-kimi-k3.html).
These card rows are scoped to Bedrock Runtime, the published geography, and Standard tier. Its
Priority and Flex multipliers produce rates explicitly qualified by the Responses or Chat Completions
operation. They are not broadened to Converse/Invoke, nor bound to those APIs' usage/selector paths.
If the API restriction cannot be recovered, Standard rates survive and tier scope drift is reported.
The same reader accepts cards without a cache-write column, including
[Grok 4.7](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-xai-grok-4-7.html).
Its Geo CRIS geography must resolve uniquely from the card's inference-profile aliases; it is
never inferred from the provider name. Explicit, unqualified Priority/Flex multipliers on the
card derive separate tier rates from its Standard amounts. A bad price cell removes only that
component, retaining the other meters in its row. Runtime card evidence does not authorize a
join to a Mantle SKU.
Runtime-only tariff readers check the card's positive endpoint before interpreting its tables.
Mantle-only commercial and GovCloud tables, such as Grok 4.3, cannot trigger Runtime duplicate-table
failure or acquire Runtime prices; independently parsed model facts and native SKUs survive.
Unresolved card cells use dedicated `model_card_price:*` raw term keys. Their partial scopes cannot
collide with ordinary numeric meter terms or reject independently bound native SKUs.
The OpenAI Bedrock cards use separately owned Standard and Ultrafast tables. Each heading supplies
its own exact short/long input-context bound; its model context window supplies none. Commercial
rows are limited to the card's positive regional and endpoint availability. An explicit Geo CRIS
geography must match a published inference-profile alias; a regional qualifier restricts that row.
The card already includes its stated commercial fee, so no extra percentage is applied. Both
`30m` and `30-minute` cache-write headers mean a 1,800-second cache TTL with a per-token charge,
not a multiplication of the token quantity. An em dash is an explicitly unavailable component.

For [GPT-6 Astra](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-astra.html),
literal Ultrafast amounts come from its tables rather than a guessed speed or price multiplier.
The unique Service Tiers section must establish the Responses `service_tier` instruction and the
endpoint must independently support Responses. Those quotes carry the Responses operation, with
Mantle limited to `us-east-1` and Runtime restricted to the published US Geo or Global profile.
Converse/Invoke counters and selectors cannot supply their acquisition paths; callers can supply
the semantic billable quantities themselves. Unknown units, headers, API scope and malformed or
duplicate table owners retain local raw quote evidence and diagnostics while readable sibling
bands remain usable. Fenced, quoted or unowned instructions establish no contract.
Loss of these owned price or service-tier contracts produces unresolved/unsupported diagnostics
and enters the existing repair investigation even when source bytes are unchanged. Ordinary raw
prices outside a reviewed contract do not gain that trigger.

The [Responses API guide](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-responses-api.html)
now links its former regional table to
[Regional availability by endpoints](https://docs.aws.amazon.com/bedrock/latest/userguide/endpoints-region-availability.html)
and [Inference endpoints](https://docs.aws.amazon.com/bedrock/latest/userguide/endpoints.html).
Fixed companions fetch both pages. Mantle availability requires an explicit positive Mantle cell
in the geography's table and the independently documented `bedrock-mantle.{region}.api.aws`
endpoint template with Responses API support. Runtime-only rows, unknown support markers,
duplicate regions, missing companions, or a changed hostname cannot establish Mantle availability.
The model card must independently support that region and endpoint. The earlier combined
Region/Endpoint table remains readable for historical replay when neither new companion exists.
The `bedrock-mantle` dependency key still fetches `inference-responses-api.md`; the obsolete
`bedrock-mantle.md` URL is not used. Missing optional Price Lists do not prevent catalog or
regional-contract parser replay; pricing completeness separately protects publication.
Optional authenticated ListFoundationModels data from us-east-1 may enrich an exact
public ID, but it cannot create global catalog presence or publish account data.
It uses the standard AWS credential chain. Long-lived access keys require the access-key ID and
secret; temporary credentials additionally require `AWS_SESSION_TOKEN`. Rejected or revoked
credentials skip only this regional inventory overlay.

Claim-local accounting companions establish only calculator inputs, independently from the rate
sources:

- Converse, ConverseStream metadata, TokenUsage, CacheDetail, ServiceTier, PerformanceConfiguration,
  and prompt-caching references establish
  terminal input, output, cache-read, cache-write, TTL-specific cache-write, served-tier, and speed
  fields;
- the Batch results guide establishes terminal job-manifest input/output totals;
- the model-invocation-log schema establishes runtime-only input/output counters and Region for
  reconciliation use;
- ApplyGuardrail's response reference, GuardrailUsage, and InvokeGuardrailChecks references establish
  their exact returned usage fields.

The independent optional `bedrock-accounting` source owns Sonic event contracts. Its
[Nova Sonic guide](https://docs.aws.amazon.com/nova/latest/userguide/output-events.html) and
[Nova 2 Sonic guide](https://docs.aws.amazon.com/nova/latest/nova2-userguide/sonic-output-events.html)
declare separate text and speech deltas. Model scope comes from the owned
[bidirectional model parameter](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InvokeModelWithBidirectionalStream.html)
and the specific [API compatibility section](https://docs.aws.amazon.com/bedrock/latest/userguide/models-api-compatibility.html#models-supporting-invokemodelwithbidirectionalstream).
The older general API page's single-model statement does not exclude newer models positively
documented by the specific compatibility guide. These contracts do not create catalog models or
publish prices. Separate source records retain their own hashes, extractor versions and observation
times, so accounting extraction can evolve independently of the price extractor. Provider-atomic
retention still preserves the whole accepted price transaction when the required bundle cannot
refresh; a new API document cannot silently add current contracts to historical price evidence.

API fields must be owned by the corresponding Contents or Response Elements definition list, with
the exact declared object/scalar type. Request fields, nested definitions, prose mentions, duplicate
fields and duplicate type declarations cannot establish a returned counter. Served-tier and speed
selectors independently require the shared component's String field and reviewed enum values.
Batch counters come from the `manifest.json.out` example; log counters come from the version-1.0
`ModelInvocationLog` example in Log entry format; checks come from Response format. Static syntax
inspection accepts numeric examples and AWS's `number` placeholder only at the documented path,
without executing snippets. Duplicate properties or uncertain object spreads withhold the mapping.
These shapes were checked against the current first-party API pages and guide examples; fixtures
preserve their relevant ownership and type structure rather than standalone identifier lists.

A missing or drifted accounting companion removes only its own input or selector mapping. It does
not change a numeric rate, create a raw price, or invalidate a sibling accounting path.

Every fixed companion is optional at acquisition time. A temporary page or Price List failure must
not erase the independently valid model catalog; provider-level pricing coverage and stale-snapshot
rules decide whether a new price partition can advance.
For the three configured Price Lists, malformed JSON, rejected product/term/dimension structure,
offer/URL or SKU disagreement, and duplicate documents report a typed pricing-dependency failure.
Catalog discovery remains usable, while collection rejects the whole new commercial partition as
`source_schema_changed` and captures no partial replay input. The accepted prices and their previous
replay input remain together. An unrelated offer such as AgentCore is excluded from this boundary.
Accounting companions also require a unique document for each owned contract. A duplicate withholds
only that document's mappings; it cannot reject model discovery or remove unrelated rates.

Marketplace completeness comes from its declared `rateCardCount` and `totalRateCards`, both of which
must equal the acquired inventory. The number of Regions is not frozen. In-Region and Global tariffs
are independently qualified, so one need not have an identical Region population to the other.
Repeated query payloads must describe the same inventory independent of row order, and duplicate
Region/scope claims remain rejected.

## Identity and model mapping

- Runtime, Mantle, and Agent Runtime endpoints are distinct.
- Rerank uses bedrock-agent-runtime and the Rerank operation. A normal model card may also expose
  Runtime invocation separately.
- Runtime and Mantle IDs stay distinct unless AWS publishes the exact same ID.
- Programmatic Access placeholders such as `N/A` are not IDs. Callable Bedrock model IDs retain
  the lower-case dotted provider namespace printed on the card.
- Responses can also run on Bedrock Runtime where a model card explicitly lists that API and endpoint.
- Per-card paths are preserved; an explicit openai/v1/responses path is not rewritten to a common
  default. An exact OpenAI `/openai/v1` base-path statement supplies Responses and Chat
  Completions paths on the named endpoint, rather than inheriting the generic `/v1` path.
- Region and deployment type remain exact pairs. Geo/global availability requires its published
  inference-profile alias. Mantle stays in-region and intersects the Mantle service-region table.
- Newer model cards publish Runtime and Mantle availability in separate tables. Each positive
  region/scope row applies only to its named endpoint; the shared legacy single-table layout
  remains supported. A legacy availability cell with a dated EOL remains callable before that date.
- A billing product binds only through one exact model identity or one unique reviewed family match.
  An explicit different version never falls back to a similar name.
- A current support-table row establishes an active rerank model even when no normal model card
  exists. Unknown limits and capabilities remain unknown.
- Legacy remains callable. An exact effective EOL date maps to retired; “No sooner than” does not.
- Published launch dates also accept a strict day-first ordinal such as `18th Sept 2026`; invalid
  calendar dates remain unknown with a source diagnostic.
- The regional authenticated API contributes only recognized positive facts. A new enum value leaves
  the affected fact unknown and emits a contract signal rather than rejecting the row.

## Rate normalization

A model book contains separate on-demand and batch offers. Batch is removed from the service-tier
dimension after it becomes the offer mechanism. Standard, Priority, Flex, resolved speed, Region,
routing scope, cache behavior, and context thresholds remain ordinary applicability dimensions.

Native `On-demand Inference` input/output token SKUs establish their own latency class: the
`-latency-optimized` suffix means optimized, and the ordinary token SKU means standard. This
classification does not depend on another quote, its amount, Region or service tier. The native
optimized model-label suffix describes the same callable model; it is removed for the unique
identity join only when that SKU independently establishes optimized latency. Other labels retain
their full identity. Unqualified Marketplace, card and unrelated units do not acquire standard
speed from a neighboring optimized quote. Billing selectors use the actual returned performance
configuration, because an optimized request can fall back to standard latency and its tariff.

Price List context ranges come from the exact model card's unique `Pricing` section. Native
short/long-context headings or the reviewed prompt-length pricing statement establish each bound
independently; a model's maximum context window does not establish its tariff threshold. Quoted,
fenced, duplicate, malformed or contradictory claims cannot supply a bound. A `long_ctx` SKU
without a proven lower bound remains raw with its exact amount, unit and SKU; no universal 200K
cutoff is assumed. A missing opposite band does not manufacture a complementary range.
Full input-context length is caller supplied; uncached Converse input usage alone is not that total.

Price List and reviewed pricing-page rows share the same deployment-scope vocabulary:
`in_region`, `geo_cross_region`, and `global_cross_region`. The page does not introduce a separate
`geo` alias for the same geographic cross-Region mechanism.

The collector preserves exact AWS decimal amounts and normalizes only reviewed units, including:

- 1K/1M tokens, individual tokens, requests, search units, images, pages, audio/video duration, and
  generated media;
- input, output, cache-read, and cache-write token meters;
- embedding inputs by the resource actually billed: text/tokens, image, audio, video, or request;
- Nova Grounding requests as a separate model-linked Web Search service;
- Guardrail text/image units by policy and API;
- prompt-router and Bedrock Web Search requests.

Token modality belongs to the price row, independently of the model's tasks. Unqualified Input
and Output token rows remain generic, including on transcription and speech-capable models.
Explicit Text and Speech/Audio components remain distinct. The native `1k tokens` and `1K tokens`
units both denote one thousand tokens; their original unit spelling and decimal remain evidence.
An explicit text-only token quote carries its own typed billable quantity before accounting
contracts are joined. Its meaning cannot depend on another modality's price being available.

Services, acquisition contracts and provider vocabulary return independently of model rows. Native
Price List service dimensions establish canonical rate terms at the parser boundary, including
exact provider units, policy/API usage signals and region. Guardrail inputs must belong to the same
source as their rate. A missing accounting field withholds only its acquisition method. Nova
Grounding is a source-owned service with its exact compatible model reference; it is not recovered
by interpreting a model-local raw marker during assembly.

The machine `pricePerUnit.USD` amount applies to the Price List `unit` field. Descriptive prose is
audit evidence and cannot change that denominator. For example, AWS can describe a TextUnit SKU as
`$0.15 per 1K` while its machine amount is already `0.0001500000` per TextUnit; that amount must not
be divided by 1,000 again. A denominator explicitly encoded by the unit itself, such as `Per 1000
requests`, remains a scaled request unit. Unknown native units stay localized raw facts and emit
unsupported-unit reconciliation instead of being reported as normalized. A machine zero remains an
explicit numeric rate without inventing an offer-wide free state.

Raw service payloads and annotations remain passive after extraction. Assembly accepts canonical
service rates and preserves unknown raw evidence; it cannot construct charges or applicability from
raw amount, unit, description or policyType fields. Old replay inputs with obsolete extractor
versions retain the already accepted partition through the shared compilation version guard.

Provisioned and Reserved dimensions are explicitly excluded before canonical pricing assembly. They
never become capacity books or model-local rate choices.

Automatic Prompt Optimization dimensions are also excluded before model identity matching. An
`OptimizePrompt` charge pays for the separate prompt-rewrite operation, even though the request
names a target model; it is not an inference input-token rate for that model.

A Nova Web Grounding service book already carries the exact compatible model reference and the
grounding offer is itself the separately charged request component. That ownership is sufficient;
the canonical projection does not add a redundant `requires` edge back to the same model's
on-demand offer.

The Marketplace representation can omit an endpoint. Endpoint-neutral on-demand token facts bind to
the exact callable ID without manufacturing duplicate Runtime and Mantle prices. Explicit Mantle,
Batch, Region, context, or service-tier evidence remains qualified.

Numeric formatting differences compare as equal after exact unit conversion. Unequal same-scope
claims remain conflicts unless the narrower official-page authority rule resolves them.
An unsupported invocation dimension with a known model keeps its source amount, unit and bounded
scope as raw evidence, alongside readable sibling rates. Explicit Price List cache-write durations,
including `30m`, retain their own TTL rather than falling back to five minutes.

## Request-cost bindings

Charge bindings describe how a downstream calculator can apply a published rate. Kmodels neither
collects these values nor runs a usage ledger.

| Published meter             | Exact input contract                                                                                                                                                                                | Aggregation |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| On-demand input tokens      | Converse/ConverseStream `usage.inputTokens`; this is uncached input when prompt caching is active. A runtime invocation-log input count is an alternative only when no separate cache rate applies. | Attempt     |
| On-demand output tokens     | Converse/ConverseStream `usage.outputTokens`; runtime invocation log `output.outputTokenCount` is a reconciliation-only alternative.                                                                | Attempt     |
| Cache read/write tokens     | TokenUsage cache-read/cache-write members. TTL-priced writes use the `cacheDetails` member whose `ttl` is exactly `5m` or `1h`; an absent filtered member is zero.                                  | Attempt     |
| Batch input/output tokens   | Terminal `manifest.json.out` input/output totals. Per-record `modelOutput` is deliberately not normalized because its shape depends on the selected model invocation type.                          | Job         |
| Service tier and speed      | Converse response or terminal stream-metadata `serviceTier.type` and `performanceConfig.latency`; returned `default` maps to the published `standard` tier.                                         | Attempt     |
| Region                      | Route configuration supplied by the consumer, or model invocation-log `region` for reconciliation.                                                                                                  | Attempt     |
| Guardrails                  | ApplyGuardrail top-level `usage` fields; InvokeGuardrailChecks `usage.<check>.textUnits`.                                                                                                           | Request     |
| Media and request rates     | A semantic quantity and unit are published, but no provider field is fabricated when model-specific request/response schemas do not establish one.                                                  | Job/attempt |
| Rerank                      | Provider-billed search units. A request locator is not claimed because documents beyond the first 100 create additional units and the Rerank response exposes no billed counter.                    | Request     |
| Web Search / Nova Grounding | Realized provider-hosted queries or grounding requests. Tool enablement is not treated as billed usage; the binding remains input-unbound until AWS publishes an exact counter.                     | Request     |
| Intelligent Prompt Routing  | Accepted invocations addressed to a prompt-router identifier. The semantic binding is retained without embedding an identifier predicate in the canonical wire.                                     | Request     |

The model invocation log contract is intentionally marked `reconciliation_only` and applies only to
`bedrock-runtime`. It gives a downstream service exact locators for token quantities and Region;
the log itself also supplies `schemaVersion`, `requestId`, `operation`, and `modelId` for the
downstream join. Mantle traffic is not falsely covered by that path.
TTL-filtered input mappings require the corresponding Converse response or stream contract as well
as TokenUsage and CacheDetail. A priced TTL other than the independently verified `5m` and `1h`
contracts retains a distinct semantic signal with no fabricated locator; an aggregate cache-write
counter cannot stand in for that TTL's quantity.

Audio-token and input-video-duration rates retain distinct billable quantity signals, including
Batch job quantities. A missing model-specific usage contract cannot remove their semantic binding
or make an aggregate token counter stand in for that component.
Text-only charges require their own billable partition. Converse, invocation-log and Batch aggregate
counters cannot supply it. Related media prices in overlapping currency, applicability, validity and
execution mechanism can also withhold an unproved aggregate acquisition path; they do not change
an unqualified quote's quantity into text-only usage. Disjoint modality quotes do not affect its
acquisition. Cache-dependent invocation-log eligibility uses the same tariff scopes,
rather than another Region, currency or Batch offer's cache policy. Rates survive these acquisition
gaps; consumers can supply exact billable partitions themselves.

For independently owned Sonic models on the Runtime bidirectional API, each `usageEvent` supplies
four conditional counters at `/event/usageEvent/details/delta/{input,output}/{textTokens,speechTokens}`.
The `sonic_usage_event` aggregation boundary means one incremental event, including multiple events
sharing the same session, prompt and completion IDs. Consumers price each delivered event once;
cumulative `details.total` and `total*Tokens` values are not added to those deltas. Exact per-token
arithmetic introduces no intermediate money rounding. Explicit text and speech quotes use their
own counter; an unqualified token quote sums the two independently reported modalities.
Every model in the book must own the protocol, and every rate scope must be Runtime without a
different operation restriction. These mappings do not cover another model, Mantle, Invoke,
Converse or Batch merely because it has similar fields or a related name. Bidi-only models also
do not borrow generic invocation-log selectors. A missing counter is unknown, including when its
sibling fields remain readable; a separately priced cache partition with no native counter is not
silently omitted from input acquisition. Model ownership, event shape and incremental semantics
require their own unquoted unique declarations. Known sibling fields survive local type drift,
and the existing partial-contract diagnostic admits investigation even on unchanged source bytes.

CUR is not a request-level input. AWS states that CUR aggregates by usage type over an hour or day
and carries no request identifier. A billing service may join invocation logs to CUR at
model/usage-type/day grain, but that invoice reconciliation and its account-specific adjustments are
outside Kmodels.

## Resilience

- Each model card is parsed independently. Unknown API or endpoint labels are skipped locally and
  recorded without discarding the rest of the card. A malformed identity, date, or required table
  isolates only that card; valid sibling cards continue.
- Model-card modality evidence may publish API and endpoint support in the same table or in separate
  endpoint and per-endpoint API tables. Both layouts bind only recognized endpoints and API paths.
- Mantle and rerank supplements are additive. Their absence or drift cannot remove Runtime models.
- Every Price List product, term, and dimension is interpreted independently. Invalid siblings are
  skipped with reconciliation evidence.
- An unknown Price List offer, including AgentCore, is ignored rather than rejecting Bedrock.
- Optional pricing-page and Marketplace overlays are isolated. Drift preserves structured Price
  List rates and records the overlay failure.
- A page row never creates a model. A billing product absent from the current callable catalog is
  excluded as stale or unbound evidence. Compound or future pricing labels such as the current
  Daybreak rows remain unbound even when they mention a known family: an exact card/ID must establish
  whether they are aliases, variants, or separate callable models.
- Unsupported invocation units remain bounded raw facts. Out-of-scope commercial facts are discarded,
  not retained as raw pricing.
- An unsupported or drifted usage field is not a raw commercial fact. The numeric rate and semantic
  charge binding remain; only the unavailable `quantity_method` or `selector_source` is omitted.
- If the accepted provider partition would materially regress, refresh retains the last verified
  pricing snapshot and exposes the failure/staleness in provider metadata.

## Known limits

Public rate coverage is not account-bill parity. Kmodels does not include negotiated discounts,
capacity amortization, Marketplace private offers, taxes, credits, or free-tier balance. A model with
no uniquely bound current public rate remains pricing-unknown rather than borrowing a similar
model's amount.
