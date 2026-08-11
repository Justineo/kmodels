# xAI

Status: current

## Sources and identity

- Statically extract, but never execute, the reviewed public model payload. Parse only
  reviewed language, embedding, image, audio, and video categories with count bounds,
  and fail closed when a new category, model field, voice endpoint field, voice pricing
  field, or rate-limit tier field appears. Known hidden operational fields such as
  clusters, RPM/RPS/TPM, capacity tiers, and the payload's Batch-discount hint are
  allowlisted but deliberately stripped. The catalog is non-exhaustive.
- Preserve the structured model `version` as identity. The public cluster map is also
  first-party model-region availability evidence; every model-bound public rate keeps
  its exact cluster region even though the current amounts agree across regions.
- The fixed `llms.txt` companion owns public pricing terms, releases, Speech to Speech
  models, lifecycle redirects, capability-wide statements, request examples, and the
  accounting contracts described below. The dedicated pricing page owns current public
  amounts when its exact scope is valid; conflicting embedded or Models-summary values
  remain warning evidence rather than rejecting the model or sibling rates. Hidden
  payload discount fields are not commercial evidence.
- Dated alias transitions in the public voice table are evaluated against the observation time and
  reconciled with the structured service alias at that same point in time. A mismatch
  suppresses only the documented alias join; exact structured Voice IDs remain. Redirected exact IDs remain separate `legacy` rows because their slugs continue to
  resolve. Their effective pricing is derived from the single documented redirect
  target from the redirect date. Voice configuration names without documented request
  model parameters do not become IDs.
- Optional authenticated `/v1/models` and detailed model inventories are account-scoped,
  non-creating observations. Their integer prices are validated at the boundary but do
  not replace the global public price book. Detailed inventories preserve their version,
  while the general inventory may enrich a uniquely matching public identity. Enable
  them with `XAI_API_KEY`. The extractor validates the complete documented field sets,
  envelopes, and examples for all eight list/detail routes before accepting a public
  refresh, and the runtime JSON parsers reject unreviewed fields instead of silently
  stripping them.
- The image-model API reference currently contradicts itself: its normative Response
  Body lists `image_price` and modalities, while both examples omit those fields and show
  three undocumented token-price fields. The field list remains the schema authority.
  The extractor accepts only that exact bounded example discrepancy or a future example
  that conforms to the listed fields; any different extra field fails closed.

## Mapping

- Tasks are non-exclusive. Multi-agent behavior stays in Responses/capability evidence;
  realtime is delivery.
- Publish an endpoint only when an allowlisted fenced request example contains an exact
  request URL and resolvable model ID or alias. Model bindings come from the example,
  never a hardcoded model list or task inheritance.
- Parse Speech to Speech prices per documented request model ID and resolve every one
  against the structured realtime services. Each version keeps one published audio-minute
  rate because xAI does not split it into input and output audio, plus its text-input
  event rate. Paid tools remain separate provider-service offers. Validate internal TTS, STT, and
  realtime service prices without publishing those service names as models.
- Parse Batch discounts and Priority multipliers from public pricing prose. Batch
  support comes from the Batch API support document, including explicit model
  exclusions; media Batch support remains at standard rates. Priority is a requested
  tier only when the response confirms that it was actually served. Streaming follows
  the documented output-modality-wide rule.
- Normalize fixed-point prices with decimal shifts. Preserve region, long-context
  threshold, service tier, media, duration, message, tool, and lifecycle-effective
  conditions. Reasoning tokens use the completion-token rate. The long-context switch
  uses total prompt tokens, including cached tokens, for the whole request.
- The `$0.05` pre-generation Responses usage-guideline violation fee is a normalized
  provider-operation amount with an unresolved outcome binding. Public TTS and
  REST/streaming STT rates are normalized as standalone provider-service offers: the
  official request schemas do not expose the internal `grok-tts` and `grok-stt`
  configuration names as request model IDs, so the catalog does not invent identities.
- Dates require exact ID, alias, or display-name bindings. API `created` is not a model
  date.

## Commercial topology audit

Design status: implemented for the mechanically refreshable first-party developer
sources. Model execution mechanisms, provider tools, Voice, TTS/STT, storage and
download, context compaction, custom voices, and the policy fee now have separate
books and charge bindings where public signals are sufficient. Consumer Grok plans,
partner-cloud pricing, private discounts, and other account-only terms remain documented
audit boundaries until an exact collectable contract supports their projection. ZDR is
an account-scoped amount-unpublished setting with exact exclusions for Batch, Files,
Collections, and agentic image generation; mixed stateful/stateless routes are not
removed wholesale.

### Public commercial source graph

| Surface                                                                                                                                        | Exact authority and completeness boundary                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The statically extracted `globalThis.__XAI_PUBLIC_MODELS__` payload on the public Models page                                                  | Exact current model/service identity, version, alias, region/cluster presence, fixed-point base rates, media input components, resolution rows, and Voice service configuration. The payload is first-party embedded data, but its public catalog is explicitly non-exhaustive and some operational or commercial fields are not documented for publication.                          |
| The dedicated [API pricing page](https://docs.x.ai/developers/pricing), exact model detail pages, and [xAI API page](https://x.ai/api)         | Current public USD list amounts, denominators, long-context threshold, cache rows, Batch discounts, Priority multiplier, direct Imagine components, Voice rates, tool rates, storage, transfer, and the Responses pre-generation violation fee. A summary “starting at” or base row does not erase a more specific first-party resolution, media-input, model-version, or region row. |
| Feature documents for prompt caching, Priority, Batch, context compaction, deferred completions, tools, Files, Collections, Imagine, and Voice | Applicability, API mechanism, lifecycle, stacking, billed-event semantics, exclusions, and request/result signals. These documents can split mechanisms that share one numeric table; feature support by itself does not create a price.                                                                                                                                              |
| Inference REST/gRPC/WebSocket references and the official xAI SDK contracts                                                                    | Exact routes, request selectors, response usage, per-tool counters, media result objects, asynchronous resources, and `cost_in_usd_ticks`. A request field proves selection, not realization; a response field can be the stronger outcome or settlement signal.                                                                                                                      |
| Optional authenticated inference model inventories and Management API model/ACL inventories                                                    | Exact inventory, prices, access, and route state visible to one API key or team at one observation. These are account-scoped evidence and cannot create or overwrite the global public book.                                                                                                                                                                                          |
| The Console billing contract, Management Billing API, prepaid/postpaid documentation, and Enterprise terms                                     | Account-effective usage, balances, invoice settlement, purchase-term precedence, negotiated services, tax, credits, limits, and payment timing. Aggregate usage has no published freshness SLA and is not a synchronous routing signal.                                                                                                                                               |
| The public [Grok plan page](https://x.ai/pricing), Grok application FAQ, and consumer/business terms                                           | Separate application subscriptions, seat plans, opaque weekly product allowance, Extra Usage Credits, and application enrollment. These facts do not cover direct API-key token usage unless an exact first-party term says so.                                                                                                                                                       |
| ZDR/security, custom-voice, retention, and data-residency documents                                                                            | Team enrollment and resource availability. ZDR disables stateful resources and several routes; custom voices are team resources. Neither is a model lifecycle or an implicit model-price modifier.                                                                                                                                                                                    |
| xAI's Azure AI Foundry, OCI Generative AI, and Vertex Model Garden links                                                                       | Exact existence of partner distribution routes only. The partner's first-party catalog, seller, price, region, marketplace agreement, and invoice own that route's commercial book.                                                                                                                                                                                                   |

Comparator catalogs are audit-only. models.dev, LiteLLM, Vercel, Portkey, gateway
catalogs, and cloud marketplaces may reveal a missing first-party xAI claim, but they
cannot create an xAI identity, turn an account observation into a public rate, or copy
a partner price into the xAI-direct book.

### Books, resources, and offer boundaries

- Direct Chat Completions and Responses text inference form one synchronous model
  usage offer per exact callable model ID. Streaming, Responses WebSocket transport,
  stateful response retrieval, structured output, caller function calling, and
  deferred retrieval are delivery, state, or request behaviors when no separate amount
  is published. Deferred completion returns the same completion result, uses the same
  chat rate limit, and publishes no discount; it is not Batch.
- Prompt cache read, short/long context, region, reasoning mode, and realized Priority
  are applicability-qualified terms of the same synchronous offer. Priority is not an
  independently acquired capacity offer: it is requested per call and only the
  response's realized `service_tier` selects the 2x token variant. Cache savings apply
  before that multiplier.
- `POST /v1/responses/compact` is a separately selectable model operation with its own
  response contract and generated compacted resource. The guide says the operation
  uses input and output tokens, but the reviewed public source does not explicitly bind
  those counters to the normal text table or show `cost_in_usd_ticks` in the compaction
  response. Preserve a context-compaction offer with amount `not_published` until an
  exact pricing or accounting contract closes that join; do not silently inherit the
  ordinary Responses price merely because both accept a model ID.
- Batch is a separate asynchronous offer, not a `service_tier` variant. It has a batch
  container, queued request resources, result pagination, cancellation/expiration,
  no per-minute request-limit consumption, per-result settlement, and a distinct
  completion horizon. Exact listed text models receive the published 20% discount on
  every token type; unlisted text models and supported image/video jobs remain Batch
  offers at standard rates. Batch and synchronous execution are alternatives for the
  same work item.
- Direct image generation and editing are one model-bound Imagine offer per exact image
  model. Generation and edit routes share one economic mechanism: each successful
  output image is charged at the selected resolution, while every accepted reference
  image adds the model's input-image component. `n`, multiple reference images,
  aspect ratio, response format, and URL versus base64 delivery do not create offers.
- Direct video generation, editing, extension, and polling are one asynchronous
  model-bound Imagine offer per exact video model where first-party docs bind that
  operation. Output resolution and realized duration select the output component;
  accepted reference images and input-video duration are additive components only for
  the exact models and operations that publish them. A request ID or poll is not a
  second charge.
- The Responses `image_generation` tool is a provider-service offer distinct from both
  synchronous text inference and direct Imagine calls. It runs the latest
  `grok-imagine-image-quality` service inside the agentic loop and uses Imagine rates,
  but the tool controls the prompt and exposes no resolution selector. Reuse the exact
  underlying rate facts without selecting the direct-image offer as another additive
  charge. Otherwise one generated image would be billed twice in the commercial graph.
- Web Search, X Search, Code Execution, File Attachment Search, and Collections Search
  are five provider-service offers. Their denominators, eligible routes, resource
  prerequisites, aliases, and successful-execution counters differ. The current
  collector's practice of copying all paid tool rows into every language and Speech to
  Speech model offer is not the target topology.
- Image Search is included in Web Search and therefore has no second paid offer.
  `view_image`, `view_x_video`, and xAI-managed Remote MCP transport have no invocation
  fee: their provider work is reflected in model tokens. Caller-defined functions are
  executed by the customer and have no xAI function-call fee. An external MCP server
  may charge separately, but that is an external provider/account book.
- Files and Collections are persistent account resources. File storage, Collection
  storage, File download, and Collection download are four provider-service offers
  with independent byte-time or transfer meters. Attachment or Collection search does
  not include storage, and storage does not include search or download. An existing
  retained resource can accrue storage without any model request.
- The `$0.05` pre-generation Responses policy fee is a real operation offer, not a
  generic model surcharge. It applies only when xAI catches a usage-guideline violation
  before generation. A violation caught during or after generation is charged as
  generation instead. Until the response/account contract exposes a stable outcome
  selector, normalize the amount and scope but keep automatic request-level binding
  unresolved.
- Speech to Speech is one exact model-bound realtime offer per public model version.
  Its single published audio-duration rate is not duplicated into invented input and
  output components; qualifying text-input events are additive. Web Search, X Search, Collections Search, Remote MCP,
  and client functions are capabilities of the exact Voice route; Code Execution,
  Attachment Search, and image generation are not projected onto Voice without exact
  first-party compatibility evidence.
- TTS is a provider-service offer rather than a `grok-tts` catalog-model offer because
  the public REST and WebSocket request schemas select a voice, not a public model ID.
  REST and streaming output share the same per-character rate and are delivery
  variants. Built-in or custom voice selection does not change the published rate.
- REST STT and streaming STT are separate provider-service offers. They are mutually
  exclusive processing mechanisms with different routes, session lifecycles, outcome
  contracts, and public hourly amounts; calling REST “batch” in the Voice summary must
  not turn it into the general asynchronous Batch API.
- A custom voice is an account resource, not a global model. Console creation is
  explicitly free for up to 30 retained team voices; API creation requires Enterprise
  enablement and has no published amount. Preserve the free Console resource allowance,
  API enrollment, region restriction, and higher-limit sales path separately. Using a
  custom voice still settles the selected TTS or Speech to Speech usage offer.
- The embedded Voice payload currently exposes a `pstnMinutePrice`, while the public
  pricing table and SIP guide do not define the billed interval, call-leg treatment,
  included telephony, or settlement signal. Retain that first-party atom as a bounded
  PSTN transport candidate rather than discarding it or publishing a normalized call
  charge whose semantics have not been documented.
- API self-serve, prepaid credits, postpaid invoicing, Enterprise support, custom rate
  limits, dedicated infrastructure, SSO, data residency, and volume pricing are
  procurement or settlement facts. A sales-scoped API agreement may be `custom_quote`,
  but negotiated account rates never rewrite the public model book.
- Free, SuperGrok Lite, SuperGrok, SuperGrok Heavy, Business, and Enterprise application
  plans are separate subscription books. Their shared weekly pool uses an unpublished
  weighted unit and Extra Usage Credits use a provider-owned conversion. Do not project
  those opaque benefits onto API tokens, tools, media, or Voice. Grok Build application
  entitlement likewise does not include API-key usage of `grok-build-0.1` without an
  exact cross-product term.
- ZDR is enrollment/applicability. It disables Files, Collections, Batch, deferred
  completions, stateful Responses, stored media outputs, agentic image generation, and
  persisted Voice history; it does not discount the remaining work. Default 30-day
  abuse-audit retention is not the separately metered File/Collection storage offer.
- xAI-direct regions and partner clouds are different routes. Azure, OCI, and Vertex
  offers settle with those sellers and remain in those providers' books even when the
  underlying model family and capability are the same.

### Commercial relationships

| Source offer or resource                 | Relation                          | Target and scope                                                           | Cost consequence                                                                                                                                                          |
| ---------------------------------------- | --------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web Search or X Search                   | `requires`                        | One exact eligible synchronous text, Batch text, or Speech to Speech offer | Successful provider search execution is additive to that realized model work. Declaring a tool or returning a failed attempt is not a charge.                             |
| Code Execution                           | `requires`                        | One exact eligible synchronous or Batch text offer                         | Add the successful execution count at the service rate; do not project onto Voice or media merely because a model has generic tool calling.                               |
| File Attachment Search                   | `requires`                        | One exact eligible agentic text offer plus an attached File resource       | The request implicitly activates search when a file is attached. File storage remains an independently accrued offer and is not auto-added per search call.               |
| Collections Search                       | `requires`                        | One exact eligible text/Batch/Voice offer plus a Collection resource       | Successful retrieval calls are additive. Collection storage is independent and a collection ID is an applicability prerequisite, not a zero-cost inclusion.               |
| Responses image-generation tool          | `requires`                        | One exact eligible Responses or supported Batch text offer                 | Model tokens and successful generated/edited images both settle. The direct Imagine offer is not added again for the same image.                                          |
| Paid built-in tool offers                | `compatible_with`                 | Other exact tool offers documented as combinable on the same route         | Multiple tools may coexist and each realized paid service settles independently. Compatibility never auto-selects a tool.                                                 |
| Image Search                             | included behavior                 | Exact Web Search execution                                                 | Image search is billed at the normal Web Search rate; never add a second search invocation price.                                                                         |
| `view_image`, `view_x_video`, Remote MCP | no paid offer relation            | Exact eligible model request                                               | No xAI invocation fee exists. Resulting image, video, prompt, or reasoning tokens remain model usage; third-party MCP charges stay external.                              |
| Caller-defined function                  | no xAI commercial relation        | Caller runtime and subsequent model requests                               | xAI does not execute or price the function. Each additional model response still settles its own model usage.                                                             |
| Batch inference                          | `exclusive_with`                  | Synchronous/deferred execution for the same work item                      | Choose one execution mechanism. Batch tools can still add service charges; the token discount does not imply a tool discount.                                             |
| Priority token variant                   | `exclusive_with` by applicability | Batch and media execution                                                  | Priority is supported only by Chat Completions and Responses, and cannot combine with Batch, image, or video generation. A default-tier response settles standard tokens. |
| Pre-generation violation fee             | `exclusive_with` by outcome       | Ordinary model generation for that rejected request                        | A request rejected before generation pays the fixed fee instead of generation. If generation occurred, settle generated work and do not add the pre-generation fee.       |
| File/Collection storage                  | no automatic relation             | Attachment/Collection search and downloads                                 | Retention accrues independently over time. Search does not purchase storage; download does not purchase search.                                                           |
| File/Collection download                 | no automatic relation             | Exact existing resource                                                    | Charge transferred bytes only when a download occurs. Creating, listing, or searching the resource is not a download.                                                     |
| Custom voice resource                    | `compatible_with`                 | TTS and exact Speech to Speech offers                                      | Voice selection changes identity/enrollment, not the published usage rate. Free creation slots do not include generated speech or realtime audio.                         |
| xAI-direct model offer                   | `exclusive_with`                  | Azure/OCI/Vertex execution for the same work item                          | One realized request has one seller and settlement route. Never add or compare a partner invoice as an xAI-direct component.                                              |

Do not encode a generic `tool_call`, “agentic,” “Voice,” “Enterprise,” or “cloud”
offer. Those labels respectively collapse distinct provider services, a request
behavior, three different audio mechanisms, procurement/account terms, and seller-
specific routes.

### Meters, charge signals, and resolution phase

| Commercial meter                   | Published denominator                                      | Strongest first-party quantity evidence                                                                                                                                                         | Resolution phase          |
| ---------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Uncached text/image prompt input   | million tokens                                             | Chat `prompt_tokens - prompt_tokens_details.cached_tokens`, Responses `input_tokens - input_tokens_details.cached_tokens`, plus exact modality detail where required                            | Outcome                   |
| Cached prompt read                 | million tokens                                             | Exact cached-token detail in the final usage object                                                                                                                                             | Outcome                   |
| Completion text                    | million tokens                                             | Chat `completion_tokens` or Responses `output_tokens`, excluding any separately reported reasoning only when the contract defines it separately                                                 | Outcome                   |
| Reasoning                          | million tokens at completion rate                          | `completion_tokens_details.reasoning_tokens` or `output_tokens_details.reasoning_tokens`; add to final completion work rather than assuming it is already inside the displayed final-text count | Outcome                   |
| Long-context band                  | total prompt tokens                                        | Total prompt/input tokens including cached tokens for the complete agentic request; request estimates do not select the band                                                                    | Outcome                   |
| Priority                           | all token types at 2x                                      | Response `service_tier === "priority"`; the requested tier alone is insufficient                                                                                                                | Outcome                   |
| Web/X/Code successful execution    | thousand calls                                             | Exact category in `server_side_tool_usage` or `server_side_tool_usage_details`; `tool_calls` contains attempts and may include failures                                                         | Outcome                   |
| File Attachment Search             | thousand calls                                             | Exact documented attachment/document-search usage field after adapter-level name binding; attached-file count and source count are not search-call counts                                       | Outcome / account         |
| Collections Search                 | thousand calls                                             | Exact Collections/file-search successful counter after route-specific alias binding                                                                                                             | Outcome / account         |
| Image-generation tool              | successful generated or edited image at Imagine resolution | Completed `image_generation_call` output items plus an exact resolution/result binding; `image_generation_calls` alone does not prove output count or rate variant                              | Outcome / account         |
| Direct image output                | image                                                      | Successful `data` items and selected/realized 1K or 2K resolution                                                                                                                               | Outcome                   |
| Direct image input                 | accepted source image                                      | Exact accepted input-image count for edit/multi-image operations                                                                                                                                | Request / outcome         |
| Direct video output                | second by resolution                                       | Completed result duration and exact 480p/720p/1080p output class                                                                                                                                | Outcome                   |
| Direct video input                 | image or second of source video                            | Accepted source-image count and source-video duration for the exact model/operation                                                                                                             | Request / outcome         |
| Speech to Speech audio             | minute of audio sent plus minute received                  | Accepted client audio duration plus emitted server audio duration; both directions are additive under “sent or received”                                                                        | Session outcome / account |
| Speech to Speech text input        | qualifying `conversation.item.create` event                | Count non-audio client events excluding `function_call_output`; `response.create` is not billable                                                                                               | Request / session outcome |
| TTS                                | million input characters                                   | Characters in the accepted synthesis text; speech tags and normalization remain account-reconciled until exact counting rules are published                                                     | Request / account         |
| REST STT                           | hour of accepted audio                                     | Submitted media duration accepted by the completed REST transcription                                                                                                                           | Request / outcome         |
| Streaming STT                      | hour of accepted streamed audio                            | Audio duration accepted across the WebSocket session, not wall-clock connection time                                                                                                            | Session outcome / account |
| File/Collection storage            | GiB-day                                                    | Time integration of retained resource `size_bytes` across create, expiration, and deletion boundaries; a list snapshot is insufficient by itself                                                | Resource/account          |
| File/Collection download           | GiB transferred                                            | Exact response bytes or account billing item for the download; stored object size is only a bound when transfer completion is proven                                                            | Outcome / account         |
| Responses pre-generation violation | rejected request                                           | Stable xAI outcome/billing item proving violation was caught before generation; currently not publicly bound                                                                                    | Outcome / account         |
| Context compaction                 | input/output tokens                                        | Compaction response usage, with amount unresolved until the rate or exact cost contract is explicit                                                                                             | Outcome / account         |
| Batch work                         | native meter of each successful result                     | Per-result usage and `cost_in_usd_ticks`; batch counters partition state but submitted, failed, canceled, or expired counts are not prices                                                      | Job outcome / account     |
| Custom voice creation/retention    | free slot allowance or unpublished Enterprise resource     | Team voice inventory and exact creation channel; the 30-resource limit is not an audio allowance                                                                                                | Account                   |
| PSTN transport candidate           | minute, semantics unresolved                               | Embedded `pstnMinutePrice` plus exact SIP call/account billing evidence; connection wall time is not assumed billable                                                                           | Session/account           |

`usage.cost_in_usd_ticks` is not a replacement denominator for these meters. It is
the strongest immediate post-request settlement observation for supported Chat,
Responses, image, video, streaming, and Batch results. It reconciles the component
estimate and captures account discounts, but cannot reveal an unknown public rate or
select an upstream before the request runs.

### Requested, realized, allowance, enrollment, and settlement facts

- Request facts include exact model/alias, endpoint, region, messages/media, Batch job,
  requested service tier, prompt-cache key, tools, attached resource IDs, output count,
  resolution, duration, voice, submitted audio/text, and storage/expiry operations.
  Output limits, tool declarations, a Batch enqueue, a file ID, or a requested Priority
  tier are not realized billable quantity.
- Realized facts include the resolved model, actual service tier, prompt/cache/output/
  reasoning usage, successful tool categories, generated artifacts, accepted media,
  completed Batch items, session audio/text events, transferred bytes, and exact cost.
  Agentic prompt usage is cumulative across xAI's internal calls and includes
  provider-defined prompt tokens, so a client tokenizer is only an estimate.
- The normal output/completion amount and reasoning amount both use the public output
  rate. A reviewed adapter must sum the two non-overlapping counters; it must not apply
  the output row only to visible final text or double-count reasoning when a future
  endpoint defines it as included.
- Batch state proves pending, succeeded, failed, and canceled outcomes. Completed
  results retain their per-request costs after cancellation. Public docs do not state
  an exhaustive failed/canceled/expired billing rule, so account settlement resolves
  those atoms rather than assuming every submitted row is charged or every failed row
  is free.
- The API's cumulative-spend tiers increase rate limits. They are capacity policy, not
  a token allowance, volume discount, or subscription benefit. A 429, concurrency cap,
  or `limitReached` response is likewise not a price.
- The 30 free custom-voice slots are a resource allowance, not 30 free creations per
  period and not included TTS/Voice usage. Higher slot limits and Enterprise API
  creation are enrollment/procurement facts until an exact amount is published.
- Grok application plans provide an opaque shared weekly allowance across Chat,
  Imagine, Voice, Build, and other products. Without a published benefit unit,
  reset quantity, product weights, or API-key target, no numeric allowance can be
  projected into an API model book. Extra Usage Credits and API prepaid credits are
  different balances.
- ZDR state, geography, API-key/team model ACLs, Enterprise contracts, data residency,
  and custom-voice eligibility are applicability/enrollment. Account inventory absence
  cannot globally retire a public model; public presence cannot promise access to every
  team.
- Self-serve API usage deducts prepaid credit first and can flow to monthly invoicing
  only when postpaid is enabled with a nonzero limit. The exact response cost is the
  request-level account authority; Management Billing is historical reconciliation;
  the invoice remains final for credits, negotiated rates, taxes, adjustments, and
  payment settlement.
- A private discount or purchase term is scoped by team, period, route, metric, and
  contract. It can override the public amount for that account without creating a
  conflict in the global public book.

### Commercial-atom disposition ledger

| Reviewed atom class                                                              | Design disposition                                                                                                                                                                           |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current direct text short/long/cache/output rows                                 | Normalize into exact model/region synchronous offers. Keep reasoning at the output rate and select the long band from realized total prompt usage.                                           |
| Priority 2x                                                                      | Normalize as a realized synchronous token variant; never as requested-only pricing or a capacity subscription.                                                                               |
| Batch model discount/support                                                     | Normalize as separate asynchronous offers with exact model and endpoint applicability. Media Batch remains standard-rate; unlisted text models receive no invented discount.                 |
| Deferred and WebSocket Responses delivery                                        | Keep as delivery/state variants of ordinary model inference when no separate amount is published.                                                                                            |
| Context Compaction                                                               | Normalize the separate model operation with `not_published` amount and exact usage evidence; do not inherit the normal text table without an official join.                                  |
| Direct image/video generation and editing                                        | Normalize exact model offers with additive input-media and output-resolution/duration components. Polling and output delivery are not additional charges.                                    |
| Web, X, Code, Attachment, and Collections tools                                  | Five provider-service offers replace all-model flattening. Bind the four documented `server_side_tool_usage` categories; keep Attachment amount normalized but its event binding unresolved. |
| Responses image-generation tool                                                  | Normalize as a separate provider-service offer priced from exact Imagine facts and completed image outcomes. Do not also select the direct Imagine offer.                                    |
| Image Search, view tools, Remote MCP, caller functions                           | Preserve included/token-only/external semantics. Emit no generic invocation price.                                                                                                           |
| File/Collection storage and download                                             | Normalize four standalone provider-service offers with retained-byte-time and transferred-byte meters. Keep search independent.                                                              |
| Responses pre-generation violation fee                                           | Normalize the fixed provider-operation amount, but leave automatic outcome binding unresolved until a stable response/account signal exists.                                                 |
| Speech to Speech versions                                                        | Exact model-bound realtime offers use one provider-owned billed-audio signal plus qualifying text-event terms; attach only documented tools.                                                 |
| TTS and REST/streaming STT                                                       | Normalize provider-service offers without invented model IDs. TTS delivery variants share one rate; REST and streaming STT are alternative offers.                                           |
| Custom voices                                                                    | Normalize a team resource, free 30-slot Console allowance, and amount-unpublished Enterprise API enrollment separately. Never admit a custom voice as a global model.                        |
| Embedded PSTN minute value                                                       | Preserve bounded first-party raw evidence until billed-leg semantics and a charge signal are documented. Do not discard or present it as a complete public telephone price.                  |
| API credits, invoicing, limits, exact cost, Management usage                     | Settlement/account evidence only. Never convert balance, spend tier, or aggregate account rate into an unqualified public model amount.                                                      |
| Grok application subscriptions and Extra Usage Credits                           | Normalize in separate subscription/balance books only where exact amounts and benefits are public. Do not project opaque weekly usage into API model details.                                |
| Enterprise support, dedicated infrastructure, data residency, and volume pricing | Preserve real sales-scoped provider-service/procurement offers as `custom_quote`; account purchase terms own effective rates.                                                                |
| ZDR and default retention                                                        | Preserve enrollment and route/resource applicability. Neither is a price or a free storage allowance.                                                                                        |
| Azure, OCI, and Vertex routes                                                    | Preserve exact route compatibility only. Price and settlement belong to the cloud seller's first-party book.                                                                                 |

### Authority and conflicts

Authority is claim-specific rather than one total source order:

1. The structured public payload owns exact public identity, version, alias, cluster
   presence, and fixed-point rows it actually exposes. Exact endpoint and feature docs
   own route, request/response, applicability, and billed-event semantics.
2. The dedicated current pricing page owns a covered public amount, denominator,
   Batch/Priority policy, provider-tool rate, storage/transfer rate, and violation fee.
   Exact model detail and xAI API tables own media-input and resolution rows omitted by
   a summary base amount. These are containment/specificity differences, not conflicts.
3. Structured and human-readable values must agree wherever they make the same exact
   claim. If they disagree, retain both observations, select only when source purpose,
   exact identity, effective date, or specificity resolves the claim, and show a local
   warning. Do not reject the model or unrelated price components.
4. Authenticated inference or Management inventories own account-effective access and
   account-scoped prices at the observation time. `cost_in_usd_ticks` owns actual
   request settlement; Management Billing and invoices own progressively broader
   account settlement. None silently rewrites the public list book.
5. Release/lifecycle and dated alias documents own transitions. An alias redirect can
   derive the target's effective price only for the documented validity period; API
   `created` and one account's absence are not retirement evidence.
6. Application pricing owns Grok plans; developer pricing owns API offers; each cloud
   partner owns its seller route. Corporate ownership or a shared model name does not
   merge those scopes.
7. If equally specific current first-party sources remain inconsistent and no reviewed
   rule selects one, withhold only the disputed amount, unit, relationship, allowance,
   or signal binding. Preserve the model, service, sibling terms, raw evidence, and
   provider snapshot.

Refresh remains deterministic and non-LLM. Model payload, public pricing, feature
documents, tool pricing, media details, Voice, storage/transfer, plan pages, API
contracts, and optional account evidence are independently validated claim groups. A
new tool field becomes a diagnostic and suppresses only its projection; a malformed
resolution row affects that model/rate atom; a missing non-exhaustive public model does
not erase retained identity; a failed optional account inventory cannot erase public
catalog or list prices. Fresh exhaustive evidence may remove only the exact identities
or routes it owns. Publication remains crash-atomic after claim-local validation, and
every recognized commercial atom receives a disposition: normalized, derived by an
exact multiplier, included, externally billed, account-only, historical, conflicting,
unsupported, ambiguous, or pending an exact join.

### Model-detail composition and cost coverage

Model details should project only exact xAI-direct offers: direct model usage, Batch,
realized Priority/cache/long-context variants, and provider services whose exact
`requires` path reaches that model offer. TTS, STT, unrelated Voice tools, storage,
downloads, custom voices, application plans, Enterprise procurement, and partner-cloud
prices remain standalone unless a first-party exact relation makes them relevant.

Rate details keep model input/cache/output/reasoning, media or Voice work, and paid
provider services as independently metered components. They never combine synchronous
and Batch routes, requested and realized Priority, duplicate search charges, caller
functions as xAI services, direct Imagine and the Responses image tool for one image, or
partner and xAI-direct settlement. Tool-image resolution, storage integration, PSTN
legs, and policy outcomes may remain unresolved. Keep that partial coverage visible;
the UI does not reject the model or invent a complete total.

## Public estimate and account-exact cost

- The official [pricing page](https://docs.x.ai/developers/pricing) is sufficient to
  calculate public list-price cost once the gateway knows the resolved model and
  region, actual prompt/cache/reasoning/output units, standard versus Batch service,
  actual Priority service tier, successful server-tool calls, and applicable media,
  voice, or operation units. Before execution, several of those are forecasts rather
  than facts; agentic internal turns and successful tools are especially not known from
  the client request alone.
- For supported inference responses, xAI provides the stronger first-party authority:
  [`usage.cost_in_usd_ticks`](https://docs.x.ai/developers/cost-tracking) is the exact
  amount charged for that request after applicable discounts, including token and
  server-side tool cost. One USD is 10,000,000,000 ticks. Streaming returns it only in
  the final usage chunk; image returns it synchronously, video in the completed poll
  result, and Batch exposes per-result cost plus an aggregate cost breakdown.
- Exact response cost is immediate post-response feedback, not a pre-request quote. It
  can drive accounting and an EWMA or similar signal for later cost-aware routing, but
  it cannot select the upstream for the same request. Pre-route balancing still needs a
  locally cached first-party rate book, account policy, request parameters, and predicted
  output/tool/cache usage.
- The authenticated
  [Management API](https://docs.x.ai/developers/rest-api-reference/management) uses a
  management key on `management-api.x.ai`. Its
  [Billing usage endpoint](https://docs.x.ai/developers/rest-api-reference/management/billing)
  returns historical aggregate USD usage, grouping and filtering dimensions, buckets
  down to one second, and a `limitReached` marker. xAI publishes no ingestion-lag or
  freshness SLA. Use it for reconciliation, budgets, and account-policy refresh, not
  as a synchronous hot-path load-balancing signal.
- The Console billing contract distinguishes prepaid credits from disabled-by-default
  monthly invoicing, uses prepaid balance first, and rejects requests after depletion
  when the invoiced limit remains at its default zero. Auto-top-up constraints, payment
  settlement, invoices, and tax details are account policy rather than model rates.
  Usage Explorer defaults to USD cost and can switch to token or billing-item dimensions,
  group by API key, and filter by API key, model, request IP, cluster, or token type.
- The Management API also exposes a team-wide models inventory and possible endpoint
  ACL inventory, separately from API-key-scoped inference inventories. It requires a
  distinct management key and a team ID, and API-key changes can take time to propagate
  across clusters. The current static source abstraction cannot safely parameterize that
  team URL, so these surfaces are validated and reconciled as account-only evidence but
  are not collected into global presence.
- Credits, prepaid balance, postpaid spending limits, invoices, taxes, private discounts,
  and account or geographic availability cannot be reconstructed from the public book.
  Cumulative-spend tiers affect rate limits, not the published inference rate. Exact
  response cost and the account Billing API are the authorities for account-effective
  charges.

## Request, response, and freshness

- Chat Completions reports prompt, completion, and cached prompt tokens; Responses
  reports input, output, and cached input tokens. Prompt-caching documentation names
  `usage.prompt_tokens_details.cached_tokens` and
  `usage.input_tokens_details.cached_tokens`. Reasoning, prompt-image, and cached-text
  details are also exposed where applicable.
- The requested `service_tier: "priority"` is not billing proof. Use the response's
  actual `service_tier`; xAI bills Priority only when the response confirms it.
- Tool response accounting distinguishes attempted `tool_calls` from successful,
  billable `server_side_tool_usage`. Prompt-token totals are cumulative across internal
  agentic calls. The inference service also adds predefined prompt tokens, so a client
  tokenizer can differ from billed prompt usage.
- The current Voice REST and WebSocket reference documents TTS, STT, and realtime
  response shapes but does not document `cost_in_usd_ticks` or a usage object for those
  responses. The broader cost-tracking prose is therefore not treated as proof of
  exact per-response Voice cost. Public character/audio/time rates remain usable;
  exact account settlement remains outside the public estimate until a stable Voice
  cost signal is documented.

## Extraction and reconciliation

- Refresh is deterministic and non-LLM. The static public payload owns model identity,
  fixed-point base prices, and region applicability. The public pricing section owns
  human-readable rates, Batch/Priority terms, tools, voice, storage, and the violation
  fee. Fixed official documentation sections own usage fields, exact response cost,
  billing history, Console balance/usage semantics, team inventory and ACL behavior,
  timing, and account-tier semantics. The complete documented inference model API route
  and field inventory is a drift contract even when no account key is configured.
- The extractor cross-checks public text/token/image/video/voice amounts against the
  structured payload, selects the exact dedicated price-table amount on a resolvable
  conflict, binds price sets only to exact model identities, and emits an explicit
  disposition for model price sets and reviewed commercial terms. Storage and download
  prices remain standalone provider-service books rather than model terms. Credits/limits and aggregate account cost are accounting evidence,
  not public rates.
- Catalog, price book, request/response accounting, and account billing remain separate evidence
  classes and are reconciled before output coverage is accepted.
- Third-party books remain audit-only. models.dev's direct sync is useful operational
  precedent: it requires a key with
  `api-key:model:*`, fetches the three typed inventories, expands aliases, updates only
  pre-authored rows, and reports missing canonical IDs. It intentionally cannot create
  rows because the APIs omit required metadata, but its passthrough schemas and omission
  of public docs, media prices, lifecycle, regions, tiers, and account contracts leave
  gaps this pipeline closes.
- LiteLLM's weekly updater imports OpenRouter and Vercel catalogs rather than refreshing
  native xAI rows from xAI. Portkey's PR/validation/S3 publication flow is also a
  community-maintained book, while ccusage consumes LiteLLM data instead of an independent
  xAI billing source. None of these values is imported; a missing value is filled only by
  adding exact current xAI evidence to this pipeline.
