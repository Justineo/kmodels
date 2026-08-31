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

The [Mantle guide](https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-mantle.html) supplies
service Regions. Optional authenticated ListFoundationModels data from us-east-1 may enrich an exact
public ID, but it cannot create global catalog presence or publish account data.

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

Charge bindings describe how a Gateway can apply a published rate; they do not calculate an invoice.

| Published meter                       | Request-visible quantity                                                                                                                                                   |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input/output/cache tokens             | usage.inputTokens, outputTokens, cacheReadInputTokens, and cacheWriteInputTokens, or the corresponding Batch result-item fields                                            |
| Image/audio/video/request model rates | Counted from the proxied request or completed response according to meter direction                                                                                        |
| Rerank                                | One search unit per submitted rerank query; a query can include up to 100 document chunks                                                                                  |
| Guardrails                            | ApplyGuardrail response usage fields such as contentPolicyUnits, topicPolicyUnits, and contentPolicyImageUnits; InvokeGuardrailChecks uses each returned check's textUnits |
| Intelligent Prompt Routing            | A model invocation whose target is a prompt-router identifier                                                                                                              |
| Bedrock Web Search                    | The proxied search query                                                                                                                                                   |
| Nova Web Grounding                    | The realized provider-hosted grounding request                                                                                                                             |

On-demand token usage aggregates per attempt. Batch usage aggregates per result item. Request-side
media and service quantities resolve from the request; generated output and provider-reported usage
resolve from the outcome.

The model invocation log and CUR remain useful audit sources, but account-period CUR quantities are
not used as a substitute for request-level Gateway signals.

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
- If the accepted provider partition would materially regress, refresh retains the last verified
  pricing snapshot and exposes the failure/staleness in provider metadata.

## Known limits

Public rate coverage is not account-bill parity. Kmodels does not include negotiated discounts,
capacity amortization, Marketplace private offers, taxes, credits, or free-tier balance. A model with
no uniquely bound current public rate remains pricing-unknown rather than borrowing a similar
model's amount.
