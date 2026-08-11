# Mistral AI

Status: current

## Sources and identity

- The exhaustive public bundle statically parses the official
  `mistralai/platform-docs-public` model index, 55–90 imported definitions, feature
  schema, and endpoint registry. Never execute remote TypeScript.
- Every import must resolve once. The first API name is canonical, later API names are
  aliases, and definitions without an API name do not create rows. A separately
  published version remains part of identity without changing `model_id`.
- The official [API pricing page](https://mistral.ai/pricing/api/) is the preferred
  first-party amount companion, not a replacement catalog. Its structured model cards add
  USD/EUR list prices and may fill an exact ID or alias whose repository definition
  has no rate. For the target commercial topology, its exact current card is the
  amount authority while the repository owns model identity, lifecycle, routes, and
  model-local semantics. An unequal repository amount remains a visible conflicting
  observation; it does not invalidate the selected page amount or sibling facts. A
  failed page fetch leaves repository fallback amounts intact and withholds only page-
  owned currencies and provider-service rows.
- Optional fixed first-party companions cover prompt caching, Batch, regional inference, the
  OpenAPI response schemas, [Admin usage metrics](https://docs.mistral.ai/admin/admin-api/usage-metrics),
  the [Admin Billing API](https://docs.mistral.ai/api/endpoint/beta/admin/billing),
  account billing, subscriptions, tools, Libraries, Vibe plans, Forge, Compute, and
  private deployment. They are claim-local commercial/accounting guards and do not
  create model identities.
- The OpenAPI companion is parsed as indentation-bounded YAML contracts rather than
  searched as one unbounded string. The collector guards `GET /v1/models`, its
  `ModelList`, base/fine-tuned cards and capability vocabulary, plus the exact usage
  schemas used by chat/FIM/embeddings, OCR, transcription, speech streams, and
  Conversations. A marker copied into an unrelated schema cannot satisfy a missing
  field in the reviewed block.
- Callable identity count stays within reviewed bounds. Numeric/free current-pricing
  coverage is measured after coalescing repeated model/version identities and applying
  exact public price-card supplements; a coverage drop is diagnostic and cannot reject
  otherwise valid model rows or price siblings.
- Optional `/v1/models` is account-scoped. Ignore private fine-tunes; overlay only
  exact public base models or unambiguous aliases. It cannot create rows or retain raw
  data, and API `created` is not a release date. `BaseModelCard.type` is optional in
  the official schema, so its documented `base` default is accepted; an unreviewed
  list-level field such as a future pagination cursor rejects the inventory instead
  of silently truncating it. Enable it with `MISTRAL_API_KEY`.

## Mapping

- Every used feature must exist and every endpoint key must resolve to a valid
  relative path. Unknown features, dangling references, invalid paths, or
  contradictory explicit-free prices reject the provider.
- Separate official definitions may share one exact API ID/version for different
  operations. Their evidence coalesces under that identity; minute rates retain
  `chat_completions` or `transcription` conditions so neither overwrites the other.
- Batch is endpoint/delivery evidence, not a task. Parse the repository lifecycle
  vocabulary directly: `GA` is active/stable, `PublicPreview` is active/preview, and
  `Deprecated` and `Retired` keep their stated meanings. Unknown values reject the
  provider.
- Preserve native token, character, duration, and page rates. Public-page audio
  generation is per 1,000 characters and is normalized to the shared per-million-
  character unit. Preserve both published USD and EUR rather than applying an
  exchange rate. Every amount carries `billing_currency=USD` or `EUR`; currency is
  an explicit offer selector, so parallel list currencies do not overlap during
  conflict analysis.
- Derive Batch rates only for models with explicit Batch support, using the published
  50% multiplier. Derive cache-read rates only for supported Chat/FIM models, using
  the published 10% input-price multiplier. Use decimal-string arithmetic and retain
  the multiplier as evidence.
- Explicit free prices remain exact when the provider publishes units. A callable
  non-retired definition with no repository price and no matching price card is
  `not_published`, not free. Retired definitions have no current hosted offer:
  historical repository amounts are excluded and their state is `not_applicable`.
- Regional rates are not attached without exact model-region availability. Regional
  inference currently multiplies standard list prices, including cache reads/writes,
  by 1.1 and excludes Agents, Batch, and Files.
- Enterprise uplifts, Agent/API tool calls, Libraries, code execution, web search,
  image, news, data-capture, and fine-tuning charges are provider-service facts. The
  extractor recognizes and reconciles them but does not duplicate them onto every
  model without exact compatibility and a provider-service pricing representation.

## Commercial topology audit

Design status: implemented. The collector and canonical pricing adapter now publish the
Mistral books, offers, relationships, charge bindings, authority decisions, and
claim-local failure boundaries described below. Account-effective prices, regional
inventory, plan allowances, and private contracts remain outside the static public
snapshot where first-party evidence does not establish an exact public join.

### Public commercial source graph

| Surface                                                                                                                                                              | Exact authority and completeness boundary                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The current [API pricing page](https://mistral.ai/pricing/api/) and structured price cards                                                                           | Current Mistral-hosted model amounts, USD/EUR alternatives, explicit free rows, Batch/cache discounts, Enterprise API uplift, Agent/tool/Libraries rows, classifier fine-tuning, and stated denominators. It is a price book, not exhaustive model identity or route compatibility.                                                                         |
| `mistralai/platform-docs-public` model index, exact definitions, schema, and endpoint registry                                                                       | Global model identity, aliases, lifecycle, weights/license links, features, endpoint routes, and embedded USD fallback amounts. A repository price cannot widen a dedicated price card, revive a retired route, or create a provider service.                                                                                                               |
| Prompt-caching, [Batch](https://docs.mistral.ai/studio-api/batch-processing), and [regional-inference](https://docs.mistral.ai/studio-api/regional-inference) guides | Distinct mechanisms, exact multipliers, endpoint restrictions, and region behavior. Batch supports only the enumerated operations and one model per job; regional availability comes from that regional endpoint's model inventory, not the global list.                                                                                                    |
| Agent, Conversations, built-in-tool, Libraries, Connectors, and function-calling guides plus OpenAPI                                                                 | Exact provider execution boundary, model/tool request shape, route support, final `connector_tokens` and connector counters, tool execution/output events, Library processing metadata, and client-executed function boundary. They do not make every tool compatible with every model.                                                                     |
| OCR/Document AI, audio, transcription, and speech guides plus OpenAPI                                                                                                | Exact operation, result shape, and response quantities: processed pages, submitted audio seconds, token usage, and generated files. A response quantity is a charge signal only when it matches the public denominator.                                                                                                                                     |
| Fine-tuning guide, current classifier cards, fine-tuning jobs/models API, and OpenAPI                                                                                | Training, storage, derived inference, minimum-job, account-created model, `trained_tokens`, and job-cost facts. The current pricing cards and the API's deprecated route tag disagree on lifecycle; that local conflict cannot remove the product or turn private model IDs into global rows.                                                               |
| Public plan page, subscription/billing guides, help-center plan/key guidance, and invoices                                                                           | Vibe subscription price, seats, product allowances, PAYG extension, API key/plan boundaries, credits, spend limits, and settlement. The public sources currently disagree on whether one global plan allowance covers API and Vibe or API Free/Scale and Vibe budgets are separate; no cross-product allowance is canonical until that claim is reconciled. |
| Admin `GET /v1/admin/usage`, its `prices` rows, usage categories, and billing event types                                                                            | Account-effective currency, period, API zone, billing group/metric, unit price, consumption, and aggregate cost. The contract explicitly recognizes API token/page/audio/connector/Library events plus deployment tokens, GPU-hours, and reserved instances. It is delayed organization/workspace settlement, not a per-request quote.                      |
| Deployment guides, Mistral services, Forge, Mistral Compute, cloud-partner pages, and commercial/deployment terms                                                    | Distribution versus execution, seller/operator, dedicated capacity, customization, private cloud/on-premises, and partner-billing boundaries. Public pages establish real commercial routes but usually only a contact-sales path, not a transferable token price.                                                                                          |

Comparator catalogs are audit-only. LiteLLM, models.dev, or a cloud marketplace may
point to a missing first-party claim, but cannot establish a Mistral-direct amount,
route, lifecycle, or tool denominator.

### Books, resources, and offer boundaries

- Each admitted current API model receives only the Mistral-hosted offers proven for
  its exact endpoint identity. Chat/FIM, embeddings, moderation/classification, OCR,
  transcription, and speech retain their native routes and meters. Multiple endpoints
  can share one offer only when charge ownership, rates, and selection are the same;
  endpoint-specific amounts stay in separate offers rather than becoming additive
  terms.
- Batch is a separate asynchronous usage offer. It uses `/v1/batch/jobs`, files or
  inline requests, a queued job lifecycle, result files, and a 50% rate. It is not a
  `service_tier` selector on synchronous inference. Only exact models and operations
  supported by both the model definition and Batch contract receive this offer.
- Prompt caching is a realized rate component of an eligible Chat/FIM inference offer,
  not an offer or prepaid cache product. A submitted `prompt_cache_key` is only a hint;
  returned cached-token counts select the 10% input rate. Do not infer that Batch and
  cache discounts stack merely because the pricing UI exposes both toggles; an exact
  combined billing rule is required before publishing a 5% row.
- Global and regional inference are the same usage mechanism at different endpoint
  routes. Regional `eu` is a 1.1× applicability variant for exact models returned by
  the EU inventory; `us` remains coming-soon until callable. Regional stateful
  features, Batch, Files, Agents, and built-in tools are excluded. Function calling is
  supported but is client execution, not a regional provider-tool charge.
- Enterprise API is an independently acquired sales-scoped usage route with a stated
  75% uplift on select APIs. It is not a universal support add-on and not the same as
  the public regional 1.1× route. Until exact eligible APIs/models are published, keep
  the multiplier and `contact_sales` enrollment as a bounded offer and project it onto
  no model.
- OCR and Document AI annotations use one model and `/v1/ocr` mechanism. Plain OCR
  pages and annotated pages are mutually exclusive applicability variants of the page
  term, not two charges for one page. Library ingestion's cheaper OCR row is a
  different provider service and must not replace the direct OCR model rate.
- Audio chat, offline transcription, realtime transcription, and text-to-speech are
  endpoint-specific mechanisms. Voxtral Small chat can incur audio-minute input,
  text-token input, and output-token components together. Transcription uses submitted
  audio duration. TTS charges submitted text characters even though the repository
  stores the amount on its output side and a streaming response may report tokens;
  `output_audio / million_characters` is therefore not the canonical meter.
- The Agent API itself publishes no generic orchestration surcharge: its price is the
  selected model's token cost plus exact executed built-in-tool charges. Agent objects,
  persistent Conversations, handoffs, and memory are resources/routes, not tool-call
  pseudo-models. A user-defined function executes in the caller's environment and has
  no Mistral tool-call rate.
- Code execution, Web search, Premium news, and image generation are separate
  provider-service offers. They bind only to exact provider-executed model routes;
  image generation also retains its separately documented Chat Completions path.
  Supported tools may coexist and are not alternatives. Custom MCP connectors remain
  distinct managed resources with no reviewed public generic connector amount.
- Libraries require one provider-service book with at least two commercial
  mechanisms. Document processing has page-OCR and indexing-token terms. Retrieval has
  the separately published per-call amount and requires an eligible model Conversation
  offer plus an existing Library resource. Creating or retaining a Library is not
  itself evidence of a storage charge; product-plan storage quotas are allowances, not
  API Library rates.
- Data Capture is an observability/compliance service charged per captured million
  tokens, not model inference and not an Agent tool. Its exact covered endpoints,
  eligible plan, and capture-token counter are not sufficiently joined by the public
  sources, so keep one unprojected provider-service offer and bounded prerequisites
  rather than attaching `$0.04/M` to every model.
- The classifier 3B/8B cards describe a customization product, not stable global model
  IDs. Training is a one-time provider-service offer with a per-trained-token rate and
  a per-job minimum. The `$4` minimum remains USD-labeled; an EUR training rate does
  not authorize an invented EUR floor. Storage is a recurring per-account-model offer,
  and derived-model inference is an account-scoped usage offer. The private model
  stays out of the global catalog while its public template prices remain
  representable.
- Vibe Free, Pro, Education, Team, and Enterprise are application subscriptions, not
  aliases for API model offers. Their message/search/image/storage/fair-use benefits
  remain plan allowances only when the exact quantity, beneficiary, and reset are
  public. PAYG extension may settle at API rates, but it does not make subscription
  usage a model-route price.
- Forge customization, Mistral Compute dedicated clusters, private cloud, on-premises,
  and enterprise deployment are real Mistral-owned service/capacity offers with public
  `custom_quote` amounts. Mistral Compute's GPU/CPU clusters and managed Kubernetes or
  Slurm are capacity products, not per-token inference. Admin `gpu_hour` and
  `reserved_instance` events are account evidence, not global public rates.
- Cloud partners such as Azure, Bedrock, Vertex, Snowflake, IBM, and Outscale own the
  infrastructure bill and collection route. Partner terms explicitly make the partner
  responsible for billing and fees. Those rates belong to each partner's provider
  book; Mistral-direct list prices are neither copied nor composed with them. Open-
  weight download is distribution, while self-hosted compute is externally borne and
  commercial-license requirements remain separate.

### Commercial relationships

| Source offer or resource         | Relation               | Target and scope                                                                    | Cost consequence                                                                                                                                                    |
| -------------------------------- | ---------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Synchronous inference            | `exclusive_with`       | Batch, Enterprise API, partner/private/self-hosted execution for the same work item | One realized execution uses one settlement mechanism; do not add two inference prices.                                                                              |
| Batch inference                  | `exclusive_with`       | Synchronous inference for the same request item                                     | The 50% amount replaces the direct rate for realized Batch usage; it is not an additive discount service.                                                           |
| EU regional inference            | no offer relation      | Global and regional applicability variants of the same synchronous offer            | Apply the 1.1× route amount once, including exact cache components; route applicability prevents a global-plus-regional sum.                                        |
| Exact built-in tool execution    | `requires`             | One eligible provider-executed model-inference offer                                | Model usage and the executed provider-tool service can both settle. Enabling a tool without execution does not select its service rate.                             |
| Several built-in tool offers     | `compatible_with`      | Other exact tools supported in the same Conversation                                | Mistral explicitly permits multiple tools. Compatibility does not imply execution or a bundle.                                                                      |
| Client function calling          | no commercial relation | Caller-executed function and model inference                                        | Function schemas/results can increase model tokens; external execution keeps its own operator cost and receives no Mistral tool-call fee.                           |
| Library retrieval call           | `requires`             | One eligible Conversations/Agents model-inference offer                             | The exact Library call and model tokens may both settle. The previously ingested Library is a resource prerequisite, not another per-call charge.                   |
| Library document processing      | no model relation      | Library document resource                                                           | OCR pages and indexing tokens are independent ingestion components and never inherit direct OCR-model prices.                                                       |
| Classifier fine-tuning training  | account resource       | Public 3B or 8B classifier model template                                           | Training, storage, and later inference remain separate offers. No global model row or base-model edge is created while the exact eligible base join is unpublished. |
| Data Capture                     | bounded raw            | Exact captured API usage and eligible account plan                                  | The token capture fee may be additive, but public evidence does not yet prove exhaustive endpoint/plan/model attachment.                                            |
| Vibe subscription PAYG extension | bounded raw            | Exact plan allowance exhaustion and API-rate settlement route                       | Public plan/key sources disagree on the shared allowance boundary, so no automatic model-price composition is safe.                                                 |
| Published open-weight artifact   | no automatic relation  | Exact downloadable artifact and its published license                               | Artifact location and license are retained separately from hosted inference. No acquisition amount or free execution is inferred from an open license.              |

Do not encode a generic `tool_call` relationship. `web_search`,
`web_search_premium`, `code_interpreter`, Library retrieval, generated images, and
client function calls have different owners, denominators, and charge signals.

### Meters, charge signals, and resolution phase

| Commercial meter                          | Denominator                                      | Strongest public quantity binding                                                                                                                                                                          | Resolution phase           |
| ----------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Uncached text input                       | million tokens                                   | `usage.prompt_tokens - cached_tokens`, or exact input/billed metric                                                                                                                                        | Outcome                    |
| Cached prompt read                        | million tokens                                   | `usage.prompt_tokens_details.cached_tokens` or documented equivalent                                                                                                                                       | Outcome                    |
| Text output                               | million tokens                                   | `usage.completion_tokens`                                                                                                                                                                                  | Outcome                    |
| Embedding/classification/moderation input | million tokens                                   | Operation usage input tokens; account billing metric if synchronous response is incomplete                                                                                                                 | Outcome / account          |
| Audio input to chat or transcription      | minute                                           | Returned `prompt_audio_seconds / 60`; otherwise measured submitted media duration                                                                                                                          | Outcome                    |
| TTS submitted text                        | million characters                               | Characters in the accepted synthesis text after exact provider normalization                                                                                                                               | Request / account          |
| Direct OCR or annotated document          | thousand processed pages                         | `usage_info.pages_processed` plus exact operation mode                                                                                                                                                     | Outcome                    |
| Batch model work                          | Native model meter for an executed item          | Per-item response usage; job outcome counters partition results but do not establish charged quantity by themselves                                                                                        | Job outcome / account      |
| Code execution                            | thousand executed calls                          | Final `usage.connectors.code_interpreter`; completed tool-execution entries are corroboration                                                                                                              | Outcome / account          |
| Web search / Premium news                 | thousand executed calls                          | Final exact connector counter (`web_search` or `web_search_premium`)                                                                                                                                       | Outcome / account          |
| Generated image                           | thousand successful images                       | Successful image artifacts/files; a connector call is insufficient if one call can yield a different image count                                                                                           | Outcome / account          |
| Library OCR                               | thousand processed pages                         | Completed document `number_of_pages` and Library billing event; upload alone is not billable quantity                                                                                                      | Resource outcome / account |
| Library indexing                          | million indexed tokens                           | Completed document processing token fields and `api_libraries_tokens`; exact billing-field mapping must be established before request-level calculation                                                    | Resource outcome / account |
| Library retrieval                         | call                                             | Final `usage.connectors.document_library` count                                                                                                                                                            | Outcome / account          |
| Agent connector context                   | million tokens                                   | `connector_tokens` is reported and included in response `total_tokens`; current public prose does not assign it unambiguously to input/output price, so retain the component and reconcile through billing | Outcome / account          |
| Data Capture                              | million captured tokens                          | Exact Data Capture extraction/billing metric, currently account-only                                                                                                                                       | Account                    |
| Fine-tuning training                      | million trained tokens                           | Completed job `trained_tokens`; job metadata cost/currency and Admin fine-tuning usage reconcile                                                                                                           | Job outcome / account      |
| Fine-tuned model storage                  | model-month                                      | Retained account model over the billing period; archival is not assumed to stop storage billing                                                                                                            | Account                    |
| Fine-tuned inference                      | million input/output tokens                      | Derived account model's exact response and billing metric                                                                                                                                                  | Outcome / account          |
| Compute/private deployment                | GPU-hour, reserved instance, or deployment token | Activated capacity/resource timeline and Admin billing event                                                                                                                                               | Account                    |

Tool configuration, model `tool_call` capability, an Agent ID, a queued Batch row,
uploaded files, generated output limits, a regional base URL, RPM/TPM limits, and a
subscription fair-use headline are selectors, resources, or controls. None is a
billable quantity by itself.

### Requested, realized, allowance, enrollment, and settlement facts

- Request facts select exact model/alias, endpoint, global or regional base URL,
  currency, operation mode, Batch, prompt-cache key, tools, Library IDs, submitted
  text/audio/page quantities, and output limits. Realized facts select cached tokens,
  processed pages/audio, model token totals, successful Batch items, actual connector
  executions, generated images, and completed training/resource usage.
- Regional model inventory and public endpoint availability are route facts. The
  requested `eu` route is enough to select its 1.1× variant only after the exact model
  is present there. `us` being documented as coming soon does not create an active
  route.
- Batch job counters describe completion state. Model-native response usage is the
  strongest request-level quantity. Public sources do not establish a complete
  failed/canceled/timeout billing rule, so neither submitted nor failed counts are
  assumed charged or free; account settlement resolves that claim.
- Built-in tools charge on actual executions or outcomes, not on declaration. Final
  connector counters are stronger than counting streaming `started`/`done` events,
  which may be retried or replayed. Image pricing uses images rather than generic
  calls; client functions remain external.
- Plan enrollment, Enterprise API access, Scale/PAYG key type, regional eligibility,
  accepted licenses, and sales contracts are independent of model lifecycle and
  public list-price validity. `contact_sales` does not mean an offer is unavailable or
  that its amount is zero.
- Included plan usage, credits, spending limits, and rate limits remain distinct.
  Credits offset settlement; a spending limit can suspend access; RPM/TPM is capacity;
  an opaque fair-use benefit cannot become a numeric allowance.
- Admin usage is the account-effective rate/aggregate authority for its period, zone,
  workspace, billing group, metric, event type, and currency. It may reflect negotiated
  terms and plan coverage. Invoices remain final for taxes, seats, credits, failed
  payments, and adjustments. Neither surface rewrites the global public list book.

### Commercial-atom disposition ledger

| Reviewed atom class                                                       | Design disposition                                                                                                                                                          |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact current hosted model USD/EUR rows                                   | Normalize into exact endpoint/model usage offers. Currency is applicability; parallel currencies are not conflicts.                                                         |
| Batch 50% policy and exact supported operations/models                    | Normalize into separate asynchronous offers; retain unsupported or unjoined rows claim-locally. No generic Batch service-tier variant.                                      |
| Cached-input 10% policy                                                   | Normalize as a realized cache-read component of eligible direct offers. Combined Batch/cache stacking remains unproven.                                                     |
| Regional 1.1× policy and regional inventory                               | Normalize as route-qualified variants only after exact live regional inventory binding.                                                                                     |
| Enterprise API 75% uplift on select APIs                                  | Preserve as an unprojected sales-scoped usage offer until exact API/model applicability is public.                                                                          |
| OCR, Document AI, transcription, audio-chat, and TTS rows                 | Normalize with page, audio-duration, text-token, output-token, and submitted-character meters. Do not reuse image/audio output pseudo-meters.                               |
| Agent API “model cost + tool call”                                        | Preserve as a composition rule, not a numeric generic Agent or tool-call term.                                                                                              |
| Code execution, Web search, Premium news, and image rows                  | Normalize into precisely named provider-service offers with exact outcome meters and eligible Conversation routes.                                                          |
| Libraries OCR/indexing/call rows                                          | Normalize ingestion and retrieval mechanisms separately. Preserve exact Library response/account signals and do not inherit direct OCR rates.                               |
| Custom MCP Connectors, handoffs, memory, and orchestration with no amount | Preserve resource/route facts or `not_published` service candidates; never infer free from absence.                                                                         |
| Data Capture per-token row                                                | Preserve one unprojected provider-service offer plus raw plan/endpoint prerequisites until exact counter and compatibility join.                                            |
| Classifier 3B/8B training, minimum, storage, and inference rows           | Normalize provider-service templates and account-scoped offers; no global derived-model row. Keep the deprecated-route/current-price conflict local.                        |
| Vibe plan prices and benefits                                             | Normalize subscription offers only for exact public amounts and allowances. Keep API/Vibe allowance conflict unresolved and out of model details.                           |
| Free or limited-period API rows                                           | Publish explicit `free` only for the exact current callable route. Missing end dates require observation freshness and do not justify indefinite historical free status.    |
| Retired models still shown on pricing page                                | Retain historical amount evidence but publish no current hosted offer; a stale price card cannot override lifecycle.                                                        |
| Open-weight artifacts and licenses                                        | Normalize distribution/license facts separately from execution. Self-host compute is externally borne; non-commercial or revenue-threshold licenses are not free inference. |
| Forge, Mistral Compute, private/on-prem/enterprise deployment             | Normalize real provider-service/capacity offers as `custom_quote`; account billing rows do not create global prices.                                                        |
| Cloud-partner routes                                                      | Preserve exact model-route compatibility. Price and settlement belong to the partner provider; no copied Mistral-direct amount.                                             |
| Admin usage `prices`, consumption, and cost                               | Account-effective reconciliation only, qualified by period/workspace/zone/metric. Never publish private rates as global list.                                               |

### Authority and conflicts

Authority is claim-specific rather than one total source order:

1. The model repository owns canonical API identity, aliases, lifecycle, feature, and
   endpoint facts. Exact endpoint and OpenAPI documents own request/response contracts.
2. The dedicated current API pricing card owns a covered public amount and denominator;
   the repository amount is a fallback. If they disagree, select the price-card amount,
   retain the repository observation, and show a local warning. Voxtral Small's current
   `$0.30/M` repository versus `$0.40/M` page output row follows this rule.
3. The repository lifecycle owns route retirement. A current-looking marketing card
   cannot revive retired Leanstral or Mixtral routes; its amount is historical/stale
   evidence for that lifecycle claim.
4. Feature-specific docs own multiplier, applicability, billed-event, and restriction
   semantics. A pricing-page toggle cannot prove exact Batch/cache stacking, regional
   availability, tool compatibility, or a response-field binding.
5. Admin price rows own account-effective period/zone/metric amounts; invoices own
   final settlement. Public list and account prices are different scopes, not conflicts.
6. If equally specific current first-party sources still disagree and no reviewed
   source-purpose, containment, effective-date, or account-scope rule selects one,
   withhold only the disputed amount, unit, signal binding, relationship, or allowance.
   Keep the model, service, sibling terms, and provider snapshot.

Refresh remains deterministic and non-LLM. Each source item in a complete bundle receives one disposition:
normalized, derived from an exact public multiplier, superseded/conflicting, duplicate,
historical, externally billed, account-only, unsupported, ambiguous, or pending an exact
join. A missing tool join suppresses only that projection; a malformed Library signal
leaves only its request-level quantity unresolved; a plan conflict withholds only the
cross-product allowance; a failed optional account inventory cannot erase the public
catalog. An incomplete public commercial bundle retains the accepted provider pricing
partition. Publication stays crash-atomic after fact-local validation.

### Model-detail composition and cost coverage

Model details should project only exact Mistral-hosted offers: direct endpoint-specific
usage, Batch, regional variants, cache components, and provider tools whose exact
`requires` path reaches that model offer. Library ingestion, Data Capture, fine-tuning,
Vibe plans, Forge, Compute, private deployments, and cloud-partner prices remain
standalone unless a first-party exact relation makes them relevant.

The calculator must treat a request as a set of independently reconstructed components:
model input/cache/output or media/page work, plus actually executed provider services.
It must not add mutually exclusive direct/Batch/global/regional routes, count a client
function as a Mistral service, use connector calls for image-denominated pricing, or
present subscription fair use as a numeric discount. A public estimate can be exact for
some components while tool image count, connector-token rate assignment, Data Capture,
or account allowance remains unresolved; that partial coverage is preferable to
rejecting the model or inventing a total.

## Public estimate and account-exact cost

- Public list prices can calculate a request estimate only after the gateway resolves
  the actual model/alias, endpoint, currency, global versus regional zone, standard
  versus Batch execution, predicted cache hits, and any tool/service usage. Request
  content and output limits determine forecast units; a request parameter alone is
  not proof of the final billed units.
- Account-level subscription allowance, credits, pending pay-as-you-go usage,
  workspace spending limits, enterprise agreements, taxes, and invoice adjustments
  are not derivable from the public price book. They affect effective account cost
  even when the request's public list-rate calculation is exact.
- Mistral does provide an authenticated `GET /v1/admin/usage` for organization cost
  and consumption. It can filter by month/year, workspace, and `global`, `us`, or
  `eu` API zone. Its response includes currency, cost categories, and the exact
  `prices` used for billing, keyed by zone, billing group, billing metric, and event
  type. This is the first-party authority for account-effective reconciliation.
- The Admin endpoint is organization/workspace/zone aggregate billing data, not a
  synchronous per-request quote. The documentation publishes no ingestion-delay or
  freshness SLA. Use it to refresh account price policy, budgets, and delayed
  reconciliation; do not place it in the hot path for cost-based load balancing.

## Request, response, and freshness

- Chat/FIM/Embeddings responses use the official `UsageInfo` schema with prompt,
  completion, and total tokens. Prompt-cache responses additionally expose cached
  prompt tokens through the documented direct count and/or prompt-token detail
  object; calculate uncached input as prompt tokens minus cached tokens. Streaming
  completion chunks retain the same usage schema.
- Transcription returns `UsageInfo`, including audio seconds where applicable. OCR
  returns pages processed. Transcription stream completion exposes the same usage
  object. These synchronous response facts refine the gateway's estimate immediately
  after completion.
- Non-streaming text-to-speech returns audio data without a usage object, while the
  streaming done event now carries token `UsageInfo`. Neither response reports the
  submitted character count used by the public character-based rate, so the gateway
  must still measure input characters itself. Conversation usage separately reports
  connector tokens and per-connector counts; other Agent/tool charges still require
  endpoint-specific accounting.
- Pre-route load balancing should therefore use a locally cached first-party rate
  book, account/zone policy, and request parameters. Post-response accounting should
  replace predicted units with returned token/cache/audio/page usage. Later compare
  the aggregate against Admin usage and invoices; do not wait for aggregate billing
  data before choosing a route.

## Extraction and reconciliation

- Refresh is deterministic and non-LLM. The repository AST owns identity, lifecycle,
  features, endpoints, downloadable-weight facts, and its embedded USD rates.
  Structured web components on the API and Vibe pricing pages own exact USD/EUR rows.
  Identity and unsafe route-shape corruption still fail the provider; accounting,
  commercial-companion, discount, and individual price-card drift suppress only the
  affected derivation, charge binding, projection, or row and emit diagnostics.
- Price-card binding uses exact canonical IDs first, then published aliases. A card
  that matches no model, matches multiple candidates, or uses an unknown label/unit
  remains an explicit reconciliation diagnostic. An exact unequal repository amount
  is retained as conflicting evidence while the dedicated current price-card amount
  is selected for the target topology.
  Duplicate responsive cards are excluded after requiring identical structured
  content; they are not counted as additional evidence.
- Every reviewed repository rate, discount policy, page row, free/not-published
  state, retired price, and recognized provider-service charge gets a disposition.
  Numeric/free model coverage is a separate diagnostic and cannot hide skipped input
  rows or erase valid siblings.
- Sources are classified as catalog, price-book supplement, accounting contract, or account
  inventory, and their observations are reconciled before output coverage is accepted.
- The public repository is itself a published artifact: its checked-in release
  workflow creates a PR to `platform-docs-public` from tagged documentation releases.
  The collector follows the raw `main` index and every exact import on each refresh,
  so additions and retirements require no hand-maintained model allowlist or LLM
  interpretation. Identity schema, callable count, and bundle-size guards stop
  publication when the model inventory mechanism changes shape; pricing and accounting
  claims remain best-effort and fact-local inside the complete source bundle.
- Live ambiguities are retained as upstream disagreements, not treated as missing parser mappings.
  The repository publishes Voxtral Small output at `$0.30/M` while the pricing page
  publishes `$0.40/M`; the target selects the dedicated page amount and retains the
  repository observation as a warning. The pricing page also advertises retired
  Leanstral as temporarily free and still prices both input/output for retired Mixtral
  8x7B and 8x22B. Those stale amount facts do not revive retired offers.
- Canonical compilation retains USD and EUR facts as applicability-qualified
  alternatives. A selected price-page value carries the explicit
  `mistral_public_price_page_over_repository` policy while the superseded repository
  amount remains raw evidence for the UI warning; cross-currency alternatives are not
  conflicts.

## Comparator audit

- Third-party books remain audit-only. A value absent from this catalog is imported
  only after an exact current first-party model/offer source is added to this
  deterministic pipeline. Historical aliases or unsupported values in ccusage,
  LiteLLM, or models.dev do not establish a current Mistral-hosted price.
- models.dev's Mistral TOML and LiteLLM's monolithic cost map are manually maintained comparison
  surfaces. They flatten lifecycle, multi-currency, non-token, Batch, and cache conditions and do not
  establish a current Mistral-hosted offer.
