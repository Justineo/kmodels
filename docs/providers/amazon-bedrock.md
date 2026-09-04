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

The [Bedrock pricing page](https://aws.amazon.com/bedrock/pricing/) is an optional, narrower overlay
for reviewed OpenAI and Stability tables that can lead the bulk feeds. The exact
[Cohere Embed 4 Marketplace page](https://aws.amazon.com/marketplace/pp/prodview-j3fgisven2yrs) is an
optional product-specific overlay. AWS states that service pricing pages control when an
informational Price List differs, so an exact page row may replace only the same narrower scope.
If one reviewed provider panel temporarily contains no recognized pricing table, that drift is
reported for the panel while a recognized sibling panel can still contribute exact rates.

The [Mantle guide](https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-mantle.html) supplies
service Regions. Optional authenticated ListFoundationModels data from us-east-1 may enrich an exact
public ID, but it cannot create global catalog presence or publish account data.

Claim-local accounting companions establish only calculator inputs, independently from the rate
sources:

- Converse, ConverseStream metadata, TokenUsage, CacheDetail, and prompt-caching references establish
  terminal input, output, cache-read, cache-write, TTL-specific cache-write, served-tier, and speed
  fields;
- the Batch results guide establishes terminal job-manifest input/output totals;
- the model-invocation-log schema establishes runtime-only input/output counters and Region for
  reconciliation use;
- ApplyGuardrail and InvokeGuardrailChecks references establish their exact returned usage fields.

A missing or drifted accounting companion removes only its own input or selector mapping. It does
not change a numeric rate, create a raw price, or invalidate a sibling accounting path.

Every fixed companion is optional at acquisition time. A temporary page or Price List failure must
not erase the independently valid model catalog; provider-level pricing coverage and stale-snapshot
rules decide whether a new price partition can advance.

## Identity and model mapping

- Runtime, Mantle, and Agent Runtime endpoints are distinct.
- Rerank uses bedrock-agent-runtime and the Rerank operation. A normal model card may also expose
  Runtime invocation separately.
- Runtime and Mantle IDs stay distinct unless AWS publishes the exact same ID.
- Per-card paths are preserved; an explicit openai/v1/responses path is not rewritten to a common
  default.
- Region and deployment type remain exact pairs. Geo/global availability requires its published
  inference-profile alias. Mantle stays in-region and intersects the Mantle service-region table.
- A billing product binds only through one exact model identity or one unique reviewed family match.
  An explicit different version never falls back to a similar name.
- A current support-table row establishes an active rerank model even when no normal model card
  exists. Unknown limits and capabilities remain unknown.
- Legacy remains callable. An exact effective EOL date maps to retired; “No sooner than” does not.
- The regional authenticated API contributes only recognized positive facts. A new enum value leaves
  the affected fact unknown and emits a contract signal rather than rejecting the row.

## Rate normalization

A model book contains separate on-demand and batch offers. Batch is removed from the service-tier
dimension after it becomes the offer mechanism. Standard, Priority, Flex, resolved speed, Region,
routing scope, cache behavior, and context thresholds remain ordinary applicability dimensions.

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
