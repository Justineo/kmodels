# Amazon Bedrock

Status: current

## Offer boundary

[Shared ownership rules](../commercial-topology.md#offers-and-dimensions) govern this provider.

Use one public AWS inference relationship per model. On-demand and Batch are execution conditions; Standard/Priority/Flex, resolved speed, geography and routing qualify rates. Keep Converse, Sonic, invocation-log and Batch-manifest quantities on their own scoped variants. Guardrails, routing and grounding retain separate service books. AWS Price List product offers and SKUs are source identities, not Kmodels account contracts. Reserved and provisioned commitments remain excluded.

The source authorities and evidence limits below remain authoritative. Adapter keys such as
`sync`, `batch`, `usage`, and operation/model-specific labels describe extraction contexts;
`source_contexts` binds them to the published relationship and its conditions. They are not
additional user-selectable agreements. Migration preserves monetary facts, conditional accounting,
source revisions and independently charged subjects.

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
The Nova `Geo Cross-region inference and in-region` tables and Anthropic's owned
`Geo and In-region Cross-region Inference` on-demand table establish shared route scope.
Their optional [Bedrock](https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/bedrock/USD/current/bedrock.json)
and [Foundation Models](https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/bedrockfoundationmodels/USD/current/bedrockfoundationmodels.json)
metered unit maps resolve page tokens to exact native rate codes. Join by that code, not a region
display name: AWS uses both `EU (Frankfurt)` and `Europe (Frankfurt)` for the same billing Region.
The Anthropic table can reference separately published map names. Discover these names from that
owned table instead of assuming all tokens use the default map. Acquisition is bounded to eight
maps, four MiB each, under the reviewed AWS USD/current map origin; failures remain priced-source
dependencies. Each token resolves only in its own map, with its exact `RegionlessRateCode`.
The native SKU owns the billing Region. The join must also agree on model identity, tier, meter,
native unit, amount, cache TTL and any explicitly qualified speed. A rate code can be published for
multiple exact model labels without making their identities interchangeable. Nova's latency-optimized
page suffix qualifies speed and requires the native optimized SKU; it is not another model.

For Nova Pro, the [latency guide](https://docs.aws.amazon.com/bedrock/latest/userguide/latency-optimized-inference.html)
explicitly names `us-east-1`, `us-east-2` and `us-west-2` through cross-Region inference, although
its profile summary table omits Oregon. The [March 2025 launch announcement](https://aws.amazon.com/about-aws/whats-new/2025/03/latency-optimized-inference-amazon-nova-pro-foundation-model-bedrock/)
corroborates those three Regions. The omission does not negate the explicit support statement.
Current pricing provides stronger evidence for the amounts: the owned Standard table's optimized
input/output tokens resolve to six exact native rate codes across those three source Regions.
The [Nova Pro card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-pro.html)
independently establishes the US profile and its source Regions. Intersect these facts; do not
hardcode the three Regions or copy Virginia's price into another Region. Equal current prices
($1 input and $4 output per million tokens in the reviewed evidence) do not make Region irrelevant.
`tests/fixtures/bedrock/nova-pro-latency.json` retains the reviewed card, owned price row, six optimized
SKUs, two non-optimized tier controls, the optimized unit-map entries and the source-Region billing
guide. The regression replays collection and
public lookup for all three Regions, with Northern California, EU geography, bare-ID routing and
other tiers as negative controls against borrowing those quotes. It establishes published price
applicability, not authenticated invocation success or an exhaustive feature compatibility matrix.

The guide's positive evidence concerns cross-Region inference. General model availability and
the pricing page's combined Geo/in-Region heading are less specific about optimized in-Region
execution; do not describe an in-Region catalog price as proof that this feature works on a bare-ID
request. Likewise, the Standard table owns the optimized quotes; absent optimized rows in Priority
or Flex do not by themselves prove that the API rejects that combination. Service tier and actual
returned latency class remain distinct fields, and neither API enums nor broad availability may
create missing prices. The API's actual response owns the billed tier/speed, including fallback.

Geo applicability requires positive Runtime source-region evidence. Prefer the profile's own Source
Region row. A sole published Geo ID within an AWS partition can use the card's Runtime Geo
availability rows without discovering its destination topology. This requires a literal ID in the
owned programmatic table and AWS's documented geography-prefix vocabulary; a guessed prefix or
two competing profiles cannot establish the mapping. An explicitly present but malformed profile
table never falls back to the overview. Destination Regions never establish billing applicability.
Cards can also explicitly define their availability table as source Regions and name the geographic
profile in prose, as Pegasus 1.5 does. Apply this evidence before
excluding profile-only models that have no in-Region Runtime ID. Preserve a separate in-Region rate
only where that exact model access and endpoint support it, including Mantle where documented.
Keep unresolved source-region applicability as raw evidence instead of inventing an in-Region route.
For models outside the owned Amazon/Anthropic tables, the current cross-Region guide's explicit
comparison (`Geographic: Standard pricing`, separately from Global savings), together with its
source-Region billing statement, establishes ordinary Standard geographic pricing. This policy
qualifies otherwise unmarked Runtime SKUs independently of their billing unit, including per-image,
per-second and embedding-request prices. It cannot override explicit in-Region labels,
non-Standard tiers or a conflicting page join. GovCloud requires its own native regional quote
and documented GovCloud profile; commercial prices cannot cross the partition boundary.
The dedicated `US GovCloud CRIS` Source Region table takes precedence over the less specific
overview's unsupported icons. Explicit regional EOL dates still exclude expired routes.
Missing policy evidence withholds the SKU extension. Missing `geo` text or
equal amounts alone never establish a shared tariff. Global discounts, Batch and reserved prices
are not derived from this rule. Price context bounds still come from the native SKU and reviewed card;
the page's `Long Context` label does not supply a numerical threshold.

OpenAI model cards can nest short/long-context tables under a GovCloud heading. Retain the parent
partition, child context bounds, endpoint, tier and cache TTL together. These explicit Geo prices
do not depend on the generic Standard SKU policy. Duplicate headings preserve quoted amounts as
raw evidence instead of admitting executable prices. Native SKU identity can also use the complete
model name between the region prefix and meter suffix of a usage type. Keep variant and precision
tokens (for example, Nemotron Nano 12B v2 VL BF16); an abbreviated display label alone cannot join it.

The regression fixture covers Sonnet 5.5, Opus 4.6 and Haiku 4.5, including a synthetic catalog key
whose literal Runtime request IDs are profiles. It checks AU/US/EU, both AU source Regions, cache TTLs,
Global and Mantle, as well as mismatched evidence and missing source-region rows. Provider-wide
migration checks compare every mapped ID before and after publication; a successful parser alone
does not prove that retained canonical data or the website has adopted the correction.
Meta Llama 4 Scout and Writer Palmyra X5 fixtures also exercise the Standard policy and its absence;
map acquisition tests cover custom paths, deduplication, failed dependencies and the owned host.
Residual-route fixtures cover all six GovCloud Nemotron/GPT-OSS IDs, Luna/Terra's nested GovCloud
prices, GPT-5.4/5.5's single commercial Geo profile, and all five TwelveLabs Geo IDs listed below.
They test numeric lookup and website projection, distinct context bands and units, expired source
Regions, missing policy evidence, ambiguous profiles, duplicate sections and variant-name mismatches.
`GetInferenceProfile` describes destination routing; it is not a prerequisite when the public card
already determines the source Region and rate. The source limits below remain explicit.

### Exact-ID evidence and remaining limits

The following cases distinguish extraction coverage from missing route-specific public quotes.
An amount for Mantle in-Region is not an amount for Runtime Geo or Global. The reviewed sources
are each model's owned card, the current Bedrock pricing page and all three native Price List feeds.
Absence here does not establish that AWS never charges for the route or that a private quote is absent.

| Exact published IDs                                                                                                                                            | Price evidence and handling                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `us-gov.nvidia.nemotron-nano-3-30b`, `us-gov.nvidia.nemotron-super-3-120b`, `us-gov.nvidia.nemotron-nano-12b-v2`, `us-gov.nvidia.nemotron-nano-9b-v2`          | Native GovCloud Standard SKUs plus the dedicated GovCloud CRIS source-region table. The 12B model also requires the complete native usage-type name join; its abbreviated price-list label is insufficient.                                                                                                                         |
| `us-gov.openai.gpt-oss-120b-1:0`, `us-gov.openai.gpt-oss-20b-1:0`                                                                                              | Native GovCloud Standard SKUs plus the dedicated GovCloud CRIS source-region table; commercial and Mantle rates remain separate.                                                                                                                                                                                                    |
| `us-gov.openai.gpt-5.6-luna`, `us-gov.openai.gpt-5.6-terra`                                                                                                    | Explicit Geo rows under nested GovCloud short/long-context headings, including 30-minute cache writes.                                                                                                                                                                                                                              |
| `us.openai.gpt-5.4`, `us.openai.gpt-5.5`                                                                                                                       | Native source-region Standard quotes and the sole commercial Geo ID in each card. Public Runtime availability establishes source Regions; authenticated destination discovery is unnecessary.                                                                                                                                       |
| `us.twelvelabs.marengo-embed-3-0-v1:0`, `eu.twelvelabs.marengo-embed-3-0-v1:0`, `us.twelvelabs.marengo-embed-2-7-v1:0`, `eu.twelvelabs.marengo-embed-2-7-v1:0` | Native per-second, per-image and per-text-request quotes plus explicit profile source Regions. Geo pricing policy is independent of billing unit.                                                                                                                                                                                   |
| `us.twelvelabs.pegasus-1-5-v1:0`                                                                                                                               | Native source-region quotes plus the card's named US profile and explicit source-region overview. The three destination Regions do not restrict the source list.                                                                                                                                                                    |
| `cohere.rerank-v3-5:0`                                                                                                                                         | Prices exist, but the generic card's Runtime row conflicts with the Rerank operation's required `modelArn`. Do not publish this bare ID as a callable price mapping. The explicitly documented `arn:aws:bedrock:us-east-1::foundation-model/cohere.rerank-v3-5:0` remains mapped and priced; do not synthesize other regional ARNs. |
| `us.anthropic.claude-3-haiku-20240307-v1:0`, `eu.anthropic.claude-3-haiku-20240307-v1:0`                                                                       | The relevant Geo routes reached EOL on 2026-09-10. Historical numeric quotes exist; they cannot authorize current source-region applicability.                                                                                                                                                                                      |
| `global.openai.gpt-5.4`, `us-gov.openai.gpt-5.4`, `global.openai.gpt-5.5`                                                                                      | Reviewed public sources lack an applicable quote for these routes. Commercial Geo quotes do not establish Global prices; the GPT-5.4 GovCloud card row explicitly prices Mantle in-Region. Keep these unresolved.                                                                                                                   |
| `us.openai.gpt-5.6-cyber`, `global.openai.gpt-5.6-cyber`, `us.openai.gpt-daybreak-blue-5.6-sol`, `global.openai.gpt-daybreak-blue-5.6-sol`                     | Cards publish route identifiers but their price tables contain only in-Region rows. The price page and native feeds supply no independently applicable Geo/Global quote. Keep these unresolved rather than copying Mantle amounts or deriving a Global discount.                                                                    |

The relevant owned cards are [Claude 3 Haiku](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-3-haiku.html),
[GPT-5.4](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-54.html),
[GPT-5.5](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-55.html),
[GPT-5.6 Cyber](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-56-cyber.html)
and [Daybreak Blue GPT-5.6 Sol](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-daybreak-blue-56-sol.html).
For reranking, the [required modelArn field](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_agent-runtime_BedrockRerankingModelConfiguration.html)
and [Rerank usage guide](https://docs.aws.amazon.com/bedrock/latest/userguide/rerank-use.html) own request addressing.

### Additional native price joins

The Embed 4 reader accepts the current product-name-first Marketplace title only alongside its
exact product heading and listing ID. A title-layout change cannot disable the authoritative
product tariff while leaving conflicting bulk SKUs as the only visible current rates.

Ray v2 resolution follows the exact native usage-type suffix (`StandardRes` or `HdRes`/`HDRes`)
across the Foundation Models and Service feeds. The Foundation Models `inferenceType` labels both
SKUs HD, so using that broad label conflates separate tariffs. The pricing page's owned metered-unit
map joins those exact SKUs to 540p and 720p respectively. The public selector preserves the native
`Standard`/`HD` vocabulary; amounts never determine a resolution or resolve a conflicting rate.
If one reviewed provider panel temporarily contains no recognized pricing table, that drift is
reported for the panel while a recognized sibling panel can still contribute exact rates.
Exact model-card Pricing tables supplement the Price Lists when the card states the unit and
identifies the matching endpoint and inference-profile aliases. A partial bulk inventory cannot
suppress another published tariff or meter. Coequal card and bulk observations reach canonical
assembly together: equal amounts combine their evidence, while unequal overlapping amounts remain
bounded conflicts. A card does not silently override a native SKU. Kimi K3 publishes
Global, US and India cross-Region input, output, 30-minute cache-write,
and cache-read rates in its [model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-moonshot-ai-kimi-k3.html).
The card's single 30-minute cache-write column establishes a fixed 1800-second rate condition.
Keep that predicate even when the runtime API has no configurable TTL. Display a proven single
value as a readonly field in the same layout as selectable conditions. Other exact durations
likewise remain variants of `cache_write_text`. Consumers can query each duration independently.
Known `cacheDetails` mappings remain optional metadata; unsupported durations must not borrow an
aggregate counter or lose a known price.

These card rows are scoped to Bedrock Runtime, the published geography, and Standard tier. Named
CRIS price rows use the reviewed Bedrock geography vocabulary and require a matching profile alias
on the card. Unqualified `Geo CRIS` requires one evidenced alias geography. Unknown row labels and
unbound geographies produce reconciliation findings. The same geography vocabulary applies to
OpenAI card qualifiers and inference profile declarations.
Kimi K3's Priority and Flex multiplier clause names Global and US base rates. Derived prices stay
within those geographies and the API scope stated in Service Tiers. The older Responses/Chat
Completions restriction and the current declaration supporting those APIs plus Converse/InvokeModel
produce their respective exact operation selectors. Missing or contradictory declarations retain
Standard rates and report tier scope drift. An API selector does not authorize borrowing another
operation's usage counters.
[Grok 4.6](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-xai-grok-4-6.html)
states its multipliers as a percentage premium and discount followed by `apply these multipliers to
the Standard rates shown above`. That wording is the same unrestricted declaration as the
`times the Standard rate` form: every published Standard amount, including In-Region, Geo CRIS and
Global CRIS, receives the derived tier rate, and the card's Service Tiers section must still supply
the API scope. Neither multiplier sentence authorizes an operation selector on its own, so an
unrestricted card publishes tier rates without an operation condition. Only prose that keeps
`Priority is billed at` while matching neither reviewed wording remains tier scope drift.
The same reader accepts cards without a cache-write column, including
[Grok 4.7](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-xai-grok-4-7.html).
Its Geo CRIS geography must resolve uniquely from the card's inference-profile aliases; it is
never inferred from the provider name. The card's GovCloud table and commercial table apply to
their own source Regions, as established by the Runtime availability table. The current
Priority and Flex declaration covers Responses, Chat Completions and InvokeModel. Converse has
Standard pricing. Published multipliers derive scoped tier rates from the corresponding
Standard amounts. A bad price cell removes only that
component, retaining the other meters in its row. Runtime card evidence does not authorize a
join to a Mantle SKU.
Runtime-only tariff readers check the card's positive endpoint before interpreting its tables.
Mantle-only commercial and GovCloud tables, such as Grok 4.3, cannot trigger Runtime duplicate-table
failure or acquire Runtime prices; independently parsed model facts and native SKUs survive.
Unresolved card cells use dedicated `model_card_price:*` raw term keys. Their partial scopes cannot
collide with ordinary numeric meter terms or reject independently bound native SKUs.
The OpenAI Bedrock cards use separately owned Standard and Ultrafast tables. Each heading supplies
its own exact short/long input-context bound; its model context window supplies none. Commercial
rows are limited to the card's positive regional and endpoint availability. Named Geo CRIS rows
accept the published geography before `Geo CRIS` or in parentheses. When a card has multiple
commercial profile geographies, the profile's own Source Region table bounds both named and
unqualified Geo CRIS rates. Unresolved profile regions never inherit another geography's rates.
GPT-6 Luna's `Call the model` and `Supported Regions` sections supply the same evidence, including
the endpoint-scoped `Source Region` and `US Geo CRIS` columns and literal `Supported` cells.
The card already includes its stated commercial fee, so no extra percentage is applied. Both
`30m` and `30-minute` cache-write headers mean a 1,800-second cache TTL with a per-token charge,
not a multiplication of the token quantity. An unqualified cache-write column uses that TTL when
the card's Prompt caching section establishes it as the sole supported TTL. An em dash is an
explicitly unavailable component.

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

The [model discovery guide](https://docs.aws.amazon.com/bedrock/latest/userguide/models-get-info.md)
defines distinct Runtime and Mantle inventories. Runtime uses `ListFoundationModels` and
`ListInferenceProfiles`; Mantle uses `/v1/models`, even when inference uses `/openai/v1`.
The foundation API can include compatibility/deprecated IDs. Its lifecycle timestamps can enrich
missing dates on exact public matches, but it contains no prices, context limits or complete
cross-Region source lists. `GetFoundationModel` adds no tariff contract.
The current read-only credentials successfully list foundation models, but model details, system
inference profiles and SigV4 Mantle discovery return 403. This is an access limit, not an empty
inventory or evidence that a model is unavailable. The three public Price List JSON feeds remain
the full structured pricing acquisition; owned cards and exact public page rows qualify their gaps.

GPT-6.1 Sol's [model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-1-sol.md)
uses a Runtime `Scope` overview instead of repeating every source Region. This cannot discard its
independent Mantle availability, literal request IDs or prices. The overview establishes routing
support only. Its exact US profile's Source Region rows establish geographic availability, including
the two Canadian source Regions; destination lists establish none. Global source Regions come from
the card-linked [model-region matrix](https://docs.aws.amazon.com/bedrock/latest/userguide/models-region-compatibility.md),
now a bounded optional collection companion. Select the matrix block by the exact model-card link
and its endpoint-qualified Global column. Never copy a sibling model's rows, a Geo source list or
a destination list. Missing, duplicate, malformed or unlinked evidence withholds the affected Global
rates as raw quotes while other model facts and independently scoped rates survive. Commercial
Global rows do not grant GovCloud or China applicability.

The card's `Regional (bedrock-mantle in US East (N. Virginia))`, `US CRIS (bedrock-runtime)` and
`Global CRIS (bedrock-runtime)` labels supply the reviewed route qualifiers. Standard and Ultrafast
retain their literal prices, exact 272K input-context boundary and sole 30-minute cache TTL. The
stated premium and sixfold speed-tier multiplier are already included and are not applied again.
The Runtime OpenAI-compatible base-URL statement owns `/openai/v1` operation paths. The pricing
page now links frontier OpenAI models to their cards; an absent legacy literal table still emits
its optional-overlay diagnostic and cannot remove prices collected from those cards.

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

### Inference model ID pricing

The direct association reader joins literal request IDs to the public relationship through exact `on-demand` source-context predicates.
It reads each model card's Programmatic Access table and its explicit request-ID statement.
It does not require API request syntax, capability matrices, protocol selection, or account-resource
configuration. The catalog display, aliases, name comparison, and downstream Kong compatibility
remain independent of this relation.

An in-Region base ID requires the row's published in-Region endpoint URL. A base ID printed next
to an unsupported in-Region endpoint remains a catalog identity, not a direct request association
for that endpoint. Geo and global profiles retain their complete published IDs. An explicit
`N/A` base identity uses the existing synthetic catalog key; removing an ID prefix never creates
a base request ID.

Only dimensions consumed by the model's on-demand prices become fixed selectors: endpoint,
deployment scope, commercial profile geography, and an explicitly evidenced region. A profile's
commercial geography comes from its own `Geo: US` (or other reviewed geography) declaration.
If prices distinguish geography but that declaration is missing or ambiguous, the association is
withheld and a source-contract finding is recorded. Prefixes do not establish geography.
Both published spellings of the Geo inference ID label are recognized, including explicit
`Geo: AU`, `Geo: CA`, `Geo: JP`, and `Geo: US-GOV` headings. GovCloud cards declare their
geography as `Geo: US-GOV` and publish the matching `us-gov.` profile prefix; the reviewed
vocabulary stays closed, so an unrecognized label still withholds the association.

The request Region remains a separate caller-supplied price condition. For profiles with regional
prices, this interpretation requires the [cross-Region guide](https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.md)
statement that billing uses the Region from which the profile is called. Routing geography is
not a physical residency guarantee; the reader does not infer execution locations.
Context length, served service tier and priced operation remain ordinary commercial
conditions. Requested tier is not substituted for served tier.

The [Rerank model configuration](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_agent-runtime_BedrockRerankingModelConfiguration.md)
defines `modelArn`. The [direct-use example](https://docs.aws.amazon.com/bedrock/latest/userguide/rerank-use.md)
supplies one literal accountless Cohere foundation-model ARN in `us-east-1`. Only this literal
can establish an association through that evidence. Bare support-table IDs, other regional ARNs,
application profiles, custom deployments and account-owned IDs are not synthesized.

Source revisions are captured with the direct facts. The shared compiler resolves exact offer
references against the accepted catalog/price pair; changed or withdrawn evidence removes the old
association. Unreviewed IDs return an unknown mapping. Known conditions that exclude every
candidate return no applicable prices. Static output and the UI use the shared price matcher.

Coverage is limited to reviewed native model-card ID declarations and the literal Rerank example.
Batch request-ID semantics are not yet mapped. Alternate card layouts or unresolved profile
geographies remain unknown while canonical prices are preserved. Durable data adoption requires
a separately authorized refresh.

### Catalog identity

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

A model book combines on-demand and Batch tariff contexts under one public relationship. Batch is an execution condition; source tier labels remain evidence. Standard, Priority, Flex, resolved speed, Region,
routing scope, cache behavior, and context thresholds remain ordinary applicability dimensions.

Native Global token SKUs ending in `input-tokens-cross-region-global`,
`output-tokens-cross-region-global`, or `cache-read/write-input-token-count-cross-region-global`
identify the ordinary Standard tariff. The exact meter suffix supplies this scope independently of
amounts and sibling quotes; explicit Priority, Flex, and Batch labels retain their own scope.
Unreviewed suffixes remain unclassified. Leaving Standard unqualified would overlap every tier and
turn otherwise disjoint tariffs into false price conflicts. This is service-tier scope, not latency
speed. The model card's Service Tiers section and the
[service-tier guide](https://docs.aws.amazon.com/bedrock/latest/userguide/service-tiers-inference.html)
establish Standard as the ordinary pay-per-token tier.

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
rather than another Region, currency or Batch branch's cache policy. Rates survive these acquisition
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

The AWS Price List feeds publish roughly 23,000 price dimensions per refresh, and the normalized
facts expand region and service-tier selectors into about 20,500 rate variants. The atomic
pre-compaction projection for this provider is therefore larger than its compacted partition
(about 143 MB against about 93 MB). The working bound that admits it is 256 MiB while the
published partition budget stays 128 MiB. The complete catalog budget is 320 MiB to include scoped
commercial selection evidence; each provider's compacted and uncompacted bytes remain bounded
independently.

Public rate coverage is not account-bill parity. Kmodels does not include negotiated discounts,
capacity amortization, Marketplace private offers, taxes, credits, or free-tier balance. A model with
no uniquely bound current public rate remains pricing-unknown rather than borrowing a similar
model's amount.
