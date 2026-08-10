# OpenAI

Status: current

## Sources and identity

- `/api/docs/models/all.md` is the exhaustive global catalog. Follow only 80–140 exact same-host
  Markdown model-card links. The Markdown cards are the primary semantic source for IDs, display
  names, descriptions, documented routed aliases, snapshots, modalities, limits, endpoints,
  capabilities, and lifecycle badges. Require the card's `Model ID` to agree with its URL and the
  index to agree exactly with the fetched card set.
- Endpoint tables are complete matrices, not positive-only lists. Normalize only reviewed exact
  endpoint label/route pairs and exact `Supported`/`Not supported` states. A new, renamed, malformed,
  duplicated, or omitted row becomes a contract signal and is withheld locally; it does not reject
  the model's independent identity, prices, modalities, or card facts. Missing Batch or Fine-tuning
  rows produce `unknown`, not `false`. Supported-feature and supported-tool lists are positive lists;
  unknown additions likewise do not break unrelated extraction.
- Keep the rendered HTML cards in the optional `openai-overview` overlay only because the
  Markdown serialization currently omits the Standard/Batch labels for duplicated price tables.
  Bind every HTML card to an exact Markdown-catalog ID. This isolates DOM drift to pricing, so a
  failed HTML price refresh cannot invalidate an otherwise valid Markdown catalog refresh. The
  stable source ID is retained even though the overlay no longer owns alias discovery.
- The public Markdown price book is a non-exhaustive catalog supplement. An exact model-ID row is
  its own official identity and creates a minimal current row when that ID is absent from the model
  catalog; do not collapse a differently priced snapshot into a card alias. Bind non-ID labels only
  through a unique exact card display name or documented alias. This admits models such as
  `gpt-5-search-api` that OpenAI prices and documents outside `/models/all`. It fills cards that link
  out for pricing and adds explicit Batch, Flex, and Fast tiers. In the commercial topology,
  an exact row on the dedicated pricing page is the amount authority: model cards explicitly defer
  to that page for pricing. A card remains the semantic authority and an amount fallback when the
  pricing page has no exact row. Unequal current values keep both observations, select the pricing-
  page value, and surface the conflict on that exact rate; they do not invalidate sibling facts.
- The collector accounts for every reviewed price-book row. Model rates, built-in tools, storage,
  containers, and fine-tuning are normalized into their owning books; duplicate Standard rows are
  reconciled, and unmatched, ambiguous, or unsupported atoms remain bounded findings. An output
  model count is not a substitute for this input-row denominator.
- `/api/docs/models` currently exposes the same catalog rather than a separate alias authority.
  Accept an alias only from explicit matching-card prose such as “the `…` alias routes requests” or
  from that card's Snapshots list; do not infer family aliases from names or IDs.
- `/api/docs/deprecations.md` is a non-exhaustive lifecycle supplement because the current model
  catalog can omit a model whose future shutdown table proves it remains callable. ISO dates and
  exact English month dates are accepted. A future-shutdown row may create a missing public
  identity; an already retired or fine-tuned identity may only update an existing exact catalog
  row. In a `snapshot | aliases` cell, retain one snapshot identity and attach the remaining codes
  as aliases. “Legacy” alone is not deprecation.
- The data-residency support matrix is a non-exhaustive catalog supplement for exact model/
  snapshot IDs, API endpoints, and `{region, regional_processing}` availability. Preserve the
  matrix's United Arab Emirates snapshot exceptions instead of widening the row-level region list.
  Service-only rows do not create models.
- Authenticated `GET /v1/models` is account-scoped validation. Private rows and absence never change the global catalog, and raw responses are not retained.
- Enable the optional inventory with `OPENAI_API_KEY`.

## Official index and API contract

- Fetch `/api/docs/llms.txt`, `/api/reference/llms.txt`, the reviewed commercial guides, and the
  first-party `openai/openai-openapi` specification atomically with the Markdown catalog. The
  first-party GitHub repository is an official repository source; no third-party catalog is used
  as production evidence.
- The documentation index is a change detector. Every indexed pricing, cost, spend, usage, Batch,
  Fast, Flex, caching, rate-limit, and model-comparison page must be in the reviewed companion set.
  A newly indexed commercial page or organization Usage path is a bounded contract signal. It
  cannot erase already validated inventory, sibling rates, or accounting bindings.
- The OpenAPI contract must continue to expose the reviewed Models, Chat Completions, Responses,
  organization Costs, and organization Usage operations. Compare the complete set of
  `/organization/usage/*` paths, not only a minimum count, so a new billable meter becomes an
  explicit review signal. Also require the cache-write, uncached, modality, service-tier, and
  response-usage fields used by the accounting boundary below.

## Mapping

- Chat, Responses, Completions, and Assistants are `text_generation`; their exact routes remain distinct. Realtime maps to its result semantics, not a task named realtime.
- Keep enabled endpoint labels and relative paths in `api_endpoints`. Batch and Fine-tuning endpoints do not widen model tasks.
- Keep direct text, audio, image, embedding, per-image, per-second, and per-minute prices in native units. Explicit transcription-duration pricing is audio input. Realtime audio-duration pricing is input audio for transcription and translation, and output audio for speech synthesis or Speech to Speech.
- A Batch selector label does not relabel the currently rendered card. Use its checked state
  and an adjacent paired price group, when present, to distinguish Standard from Batch; use
  explicit price-book headings for Standard, Batch, Flex, and Fast.
- Derive long-context and cache-write prices only from published multipliers with decimal-string arithmetic.
- Explicit open-weight models use `not_applicable`. An explicitly free hosted moderation model uses
  a free offer. Absent or unparseable hosted prices remain `unknown`.
- The current refresh has four unknown-priced rows, each explained by exact source boundaries:
  deprecated `gpt-4-1106-preview` survives only through lifecycle evidence;
  `gpt-4o-2024-11-20` and `gpt-4o-tts` are present on support/API surfaces but have no exact current
  price row; and `gpt-5.4-cyber` is an exact current pricing-table identity whose input, cached-input,
  and output cells are all `-`. Family and successor prices are not inherited.
- Keep `sora-2-2025-10-06` as an alias of the current exact `sora-2` row: the official model card
  publishes that routing relationship, while the lifecycle table independently confirms the alias.
  Do not publish a duplicate lifecycle-only row for the same callable identity.
- Map exact Tools support to `computer_use` and code-execution capabilities, and explicit
  `reasoning.effort` value lists to effort control. A supported-feature entry establishes prompt
  caching directly; a numeric `Cached input` row on the same official model card is also positive
  prompt-cache evidence when that card omits the feature list. Account-tier rate-limit tables do not fit
  model-global scalar limits. Tool/service and fine-tuning rows stay out of model base offers but
  retain their public commercial facts in separate resource books. The regional-processing uplift
  remains unnormalized until its exact coverage rule is implemented.

## Commercial topology audit

Implementation status: migrated. This section defines the current OpenAI collector, canonical
topology, accounting boundary, and presentation behavior.

### Public commercial source graph

| Surface                                                                                                                                                                                                                                                                                                                        | Exact authority and completeness boundary                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`/api/docs/models/all`](https://developers.openai.com/api/docs/models/all) and exact model cards                                                                                                                                                                                                                              | Exhaustive public model-card inventory, callable IDs and aliases, endpoint support, tool compatibility, lifecycle badges, context rules, and card-local fallback rates. A positive tool list proves compatibility, not a charge.                                                                                                 |
| [Pricing](https://developers.openai.com/api/docs/pricing)                                                                                                                                                                                                                                                                      | Dedicated current list-price surface and amount authority for its exact rows: Standard, Batch, Flex, Fast, realtime/audio, image, video, transcription, specialized models, built-in tools, and fine-tuning. It is not an exhaustive model inventory. Each table is exhaustive only for its named mechanism and current row set. |
| [Batch](https://developers.openai.com/api/docs/guides/batch), [Flex](https://developers.openai.com/api/docs/guides/flex-processing), and [Fast](https://developers.openai.com/api/docs/guides/fast-mode)                                                                                                                       | Mechanism, endpoint, selector, fallback, failure, and settlement semantics. Their prose qualifies pricing rows but does not replace an explicit numeric row.                                                                                                                                                                     |
| [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) and [Realtime costs](https://developers.openai.com/api/docs/guides/realtime-costs)                                                                                                                                                              | Cache-read/write accounting, Realtime response-token accounting, streaming-duration accounting, and optional Realtime transcription as a separately billed model.                                                                                                                                                                |
| [Web search](https://developers.openai.com/api/docs/guides/tools-web-search), [File search](https://developers.openai.com/api/docs/guides/tools-file-search), [Code Interpreter](https://developers.openai.com/api/docs/guides/tools-code-interpreter), and [Shell](https://developers.openai.com/api/docs/guides/tools-shell) | Exact tool-call events, tool/API routes, model execution context, container memory and lifetime semantics. Pricing remains the amount authority.                                                                                                                                                                                 |
| [Your data](https://developers.openai.com/api/docs/guides/your-data)                                                                                                                                                                                                                                                           | Exhaustive region, endpoint, tool, exact model/snapshot, and regional-processing eligibility matrix. Storage residency alone does not trigger the regional-processing uplift.                                                                                                                                                    |
| [Responses reference](https://developers.openai.com/api/reference/resources/responses/methods/create) and [organization Usage/Costs reference](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage)                                                                       | Returned model, actual `service_tier`, request usage partitions, aggregated model/tool/storage counters, and delayed billed cost. Usage is the public accounting surface; Costs is the account settlement surface.                                                                                                               |
| Deprecations, spend limits, rate limits, and fine-tuning guides                                                                                                                                                                                                                                                                | Route/enrollment lifecycle and account constraints. They do not override a current numeric amount.                                                                                                                                                                                                                               |

The API documentation graph is not exhaustive for enterprise capacity procurement. Scale Tier is
documented by the Fast guide only at its interaction boundary; Reserved Tier and the complete public
capacity tables are not indexed in `/api/docs/llms.txt`. Treat those capacity products as known
resource candidates but keep their unreviewed numeric/procurement atoms bounded raw. A later
implementation must explicitly admit their first-party commercial surfaces; it must not infer terms
from Fast prose, a sales page title, models.dev, or LiteLLM.

### Resources, books, and offer boundaries

The resource graph contains public model routes, provider-owned services, account plans/capacity,
and the delayed settlement surface. The book and offer patterns are:

| Book/resource                         | Proposed offers                                                    | Boundary rationale                                                                                                                                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Public model                          | Synchronous PAYG inference                                         | Standard, Flex, and Fast are applicability variants of one synchronous Responses/Chat mechanism. They use the same request APIs and billing mode; the returned served tier selects the amount.                                                         |
| Public model                          | Batch inference                                                    | Separate offer because `/v1/batches` is a file-backed asynchronous job mechanism with a 24-hour completion window, separate limits, per-result responses, and independent failure/expiry semantics. Batch is not merely a discount label.              |
| Public model                          | Realtime response inference; streaming translation/transcription   | Realtime conversational Responses accrue modality tokens per response. Streaming translation and transcription bypass the normal Response lifecycle and accrue duration, so they are separate model mechanisms even when shown in one pricing section. |
| Public model                          | Direct and Batch image/video/audio/embedding/moderation mechanisms | Preserve the exact callable endpoint and native denominator. Direct versus Batch remains separate; modality, quality, resolution, and size remain variants unless the API mechanism changes. Explicitly free moderation is a free model offer.         |
| `openai.web-search` service           | Current Web Search; legacy Web Search Preview                      | Provider-executed searches own a per-search charge separate from model tokens. Current and Preview use distinct tool identities and pricing rules; image search and reasoning/non-reasoning are applicability variants, not pseudo-models.             |
| `openai.file-search` service          | Responses file-search execution                                    | The per-call charge applies only to Responses. It is separate from both model tokens and stored vector data.                                                                                                                                           |
| `openai.vector-store-storage` service | Stored vector data                                                 | Standalone state can exist without a model request. The byte-day rate and first-GiB benefit cannot share an offer with per-call execution because their dependency, meter, and lifetime differ.                                                        |
| `openai.containers` service           | Hosted container runtime                                           | Code Interpreter and Hosted Shell share the same container resource and memory schedule. Containers can be created and retained through `/v1/containers`, so the commercial resource is not a model or a universally dependent add-on.                 |
| `openai.chatkit-storage` service      | ChatKit upload storage                                             | Standalone Agent Kit account storage with its own byte-day rate and monthly account allowance; no model relationship is implied.                                                                                                                       |
| `openai.fine-tuning` service          | Training job                                                       | Training is a provider service parameterized by an exact eligible base model. Token-trained and hourly training terms remain native. Existing-customer-only access is enrollment, not model lifecycle.                                                 |
| Account capacity/procurement          | Scale Tier and Reserved Tier candidates                            | Distinct capacity mechanisms with account enrollment and overflow behavior. Their final offers, rates, allowances, and settlement edges remain bounded until their complete first-party surfaces are admitted.                                         |

Fine-tuned inference prices apply to account-created model IDs that are not public catalog resources.
Do not attach those rates to the base model or create guessed public model rows. Preserve the public
rows on a `derived_model` account-resource template, related to the exact eligible base model only
where first-party evidence establishes that derivation. Ordinary Responses, Chat Completions,
Realtime, Batch, and Assistants API endpoints have no separate API fee; this is an explicit
exclusion, not a free offer, because model and service usage remains charged.

### Relationship matrix

| Source                                             | Target                                                        | Relationship and applicability                                                                                                                                                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Batch model offer                                  | Same model's synchronous PAYG offer                           | `exclusive_with` for one submitted billable execution. This does not prevent an account from using both mechanisms for different work.                                                                                                                   |
| Current Web Search or Web Search Preview execution | Exact supported synchronous model offer                       | `compatible_with` for the Responses-tool route. Search-content tokens contribute to the selected model's exact input-rate term without copying that amount. Batch compatibility remains unasserted unless exact first-party evidence establishes it.     |
| Responses file-search execution                    | Exact supported synchronous model offer                       | `compatible_with` for the Responses-tool route. The call charge is independently selected; vector-store storage is a separate resource and is not pulled into the same relationship.                                                                     |
| Hosted container runtime                           | Exact model offer supporting Code Interpreter or Hosted Shell | `compatible_with` for the exact integration. The caller explicitly selects both components, while the container remains independently creatable and retainable; no false global `requires` edge or copied model rate is needed.                          |
| Realtime input transcription model mechanism       | Realtime conversational model offer                           | `compatible_with` when input transcription is configured. The caller explicitly selects both mechanisms and both rates apply; independent transcription remains valid.                                                                                   |
| Scale Tier                                         | Fast/PAYG model usage                                         | The Fast guide proves separate billing and that Fast usage does not consume Scale bundles. It does not prove a canonical `exclusive_with` edge or the complete overflow/allowance rule. Keep the remaining relationship raw pending the capacity source. |
| Client function calls or remote MCP                | OpenAI model offer                                            | No OpenAI service-price relationship. Only model tokens are in the OpenAI partition; third-party execution or MCP charges are external facts.                                                                                                            |

Standard, Flex, and Fast have no offer edges because they are served-tier variants of the same
synchronous offer. A provider service's positive model-card compatibility is not itself a charge.
The route-local container and Realtime-transcription cases use exact compatibility plus explicit
selection: the UI can compose them without a permanent add-on role or a false acquisition
dependency.

### Meters, denominators, signals, and phase

| Commercial atom                     | Denominator                                                                                                                  | Exact public signal or gap                                                                                                                                                                          | Aggregation and earliest exact phase                                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Uncached model input                | input tokens                                                                                                                 | Responses `usage.input_tokens - usage.input_tokens_details.cached_tokens - usage.input_tokens_details.cache_write_tokens`; organization Usage publishes `input_uncached_tokens` and modality splits | Per response/result item at `outcome`; billing-bucket aggregate at `account`                                                           |
| Cached input read                   | cached input tokens                                                                                                          | Responses `usage.input_tokens_details.cached_tokens`; Realtime `cached_tokens`; organization Usage `input_cached_tokens` and modality splits                                                        | `outcome`; account aggregate also available                                                                                            |
| GPT-5.6+ cache write                | cache-write input tokens                                                                                                     | Responses `usage.input_tokens_details.cache_write_tokens`; organization Usage `input_cache_write_tokens`                                                                                            | `outcome`; account aggregate also available                                                                                            |
| Model output                        | output tokens by modality                                                                                                    | Response/Realtime usage and organization Usage output fields; reasoning tokens remain included in output rather than creating a second charge                                                       | `outcome`                                                                                                                              |
| Long-context band                   | full request token rates                                                                                                     | Total input-token count selects the published `>272K` band and applies its input/output rates to the full request                                                                                   | Exact at `outcome`; a tokenizer can only estimate at `request`                                                                         |
| Batch model usage                   | native token, image, video-second, or endpoint denominator                                                                   | Each successful result body carries the endpoint's normal response usage. Completed work in an expired batch remains chargeable; submission count is not a token-charge signal                      | Per result item at `outcome`; organization Usage grouped by `batch` at `account`                                                       |
| Streaming translation/transcription | processed audio minute                                                                                                       | Realtime streaming duration/session data and organization audio-transcription `seconds`, after exact unit conversion                                                                                | `outcome` or account aggregate                                                                                                         |
| Generated image/video               | generated item or generated second                                                                                           | Endpoint result count/final duration; requested size, quality, and resolution select applicability but do not substitute for realized quantity                                                      | `outcome`                                                                                                                              |
| Web Search execution                | search action/call                                                                                                           | Responses `web_search_call.action.type=search`; organization Usage `web_search_calls.num_requests`                                                                                                  | Per response at `outcome`; account aggregate later. `open_page` and `find_in_page` are not counted as searches without price evidence. |
| File Search execution               | file-search call                                                                                                             | Responses file-search call item; organization Usage `file_search_calls.num_requests`                                                                                                                | `outcome`; account aggregate later                                                                                                     |
| Vector-store storage                | GB-day                                                                                                                       | Organization Usage exposes bucketed `usage_bytes`, not a documented byte-time integral                                                                                                              | Unbound. A byte snapshot is dimensionally insufficient for a GB-day rate.                                                              |
| Container runtime by memory         | Published 20-minute container-session block; separate prose says eligible sessions bill by minute with a five-minute minimum | Organization Usage exposes only `num_sessions`; container metadata exposes activity/expiry, not the provider's billable minute counter or proration rule                                            | Preserve the numeric schedule and billing-granularity facts, but leave the charge unbound and do not derive a per-minute rate.         |
| ChatKit upload storage              | GB-day                                                                                                                       | No reviewed public usage counter                                                                                                                                                                    | Numeric price, unbound charge; settlement only at `account`                                                                            |
| Fine-tuning training                | training tokens or training hour by exact row                                                                                | Fine-tuning job counters may establish trained tokens, but no reviewed public signal establishes billable training hours for the hourly row                                                         | Token rows `outcome` when exact; hourly row remains unbound                                                                            |
| Public list settlement              | USD amount                                                                                                                   | Organization Costs `amount`, groupable by line item/project/API key                                                                                                                                 | Daily bucket at `account`; never a request-time routing signal                                                                         |

Pre-GPT-5.6 cache writes have no separately priced cache-write term: the guide states that writes
carry no additional fee, so their tokens remain ordinary uncached input rather than a zero-priced
second charge. A dash is interpreted per column and evidence: no separate cache-write term, no
published long-context variant, unsupported cached input, or `not_published` for a row whose whole
price block is dashed. It is never mechanically converted to numeric zero.

Web Search also publishes a second accounting effect: search content is charged at the selected
model's input-token rate, with a fixed 8,000-input-token block per non-preview call for
`gpt-4o-mini` and `gpt-4.1-mini`; Preview non-reasoning search content is free. That is not another
search-call rate. Represent it as a contribution to the exact selected model input-rate term without
copying that rate. Because the public docs do not establish whether every returned request-usage
counter already includes the billed content, leave its charge binding unbound and prevent double
counting.

### Requested, realized, allowance, and settlement facts

- `service_tier=auto`, a project default, `flex`, `fast`, and the legacy `priority` request spelling
  are request facts. The returned `service_tier` is the outcome fact that selects Standard, Flex, or
  Fast pricing. Normalize returned `priority` to the public Fast tier for models covered by the Fast
  guide. A ramp-rate downgrade returns `default` and must settle at Standard rates.
- Flex `429 Resource Unavailable` failures are explicitly uncharged. Retrying with `auto` or an
  omitted selector is a new request whose project default may cost more; no silent fallback is
  inferred.
- Batch completion, per-line success/failure, cancellation, and expiry are outcome facts. Preserve
  charges for work completed before expiry; do not charge every submitted line or erase successful
  siblings because other lines failed.
- Cache read/write partitions, model-selected search execution, generated quantity, and the long-
  context threshold are outcomes. Size/quality, explicit tool configuration, requested tier, and
  selected regional endpoint are request facts.
- Regional processing requires the exact data-residency matrix, a processing-capable region, exact
  model/snapshot eligibility, and the published release cutoff. Apply the 10% uplift as an
  applicability variant to every covered mechanism. Never derive a release date from an ID or
  apply the uplift from storage residency alone.
- The first GiB of vector-store storage is an allowance whose account/reset scope is not stated on
  the price row and therefore remains raw. ChatKit's first GiB is explicitly per account per month.
  Prompt-cache discounts are rates, not allowances. Batch/Flex prices are mechanisms/variants, not
  coupons. Explicitly free moderation is a price state.
- Fine-tuning data-sharing discounts are enrollment/applicability facts. The announced wind-down is
  `closed_to_new` enrollment for training while existing fine-tuned inference routes retain their
  own base-model lifecycle; neither fact changes the published rate by itself.
- Organization Costs is the authority for account-effective spend, credits, negotiated terms, and
  invoice reconciliation. It is delayed daily settlement and never overwrites the public list-price
  observations.

### Commercial-atom disposition ledger

| Reviewed atom class                                                                                                | Design disposition                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact Standard/Flex/Fast, Batch, realtime/audio, image, video, transcription, embedding, specialized-model amounts | Normalize into the model offer/mechanism and exact native meter. Preserve explicit applicability rather than copying family prices.                                                               |
| Cache, context, modality, quality, resolution, served-tier, region, and data-sharing differences                   | Normalize as applicability variants only where exact source semantics establish the selector and phase.                                                                                           |
| Free moderation                                                                                                    | Normalize as a free model offer. Numeric zero is not substituted.                                                                                                                                 |
| Web/File Search call rates, vector storage, containers, and ChatKit storage                                        | Normalize into separately owned provider-service books. Bind only the call counters whose units and billable triggers match; retain storage/runtime prices when usage integration is unavailable. |
| Search-content token charges                                                                                       | Normalize a contribution to the exact model input-rate term; leave its quantity binding unbound while request-usage inclusion remains unclear.                                                    |
| Container 20-minute rate, per-minute billing, and five-minute minimum                                              | Preserve the numeric schedule and raw billing granularity together; do not infer proration or a per-minute amount. The public session counter has the wrong unit, so the charge remains unbound.  |
| Fine-tuning training                                                                                               | Normalize as a provider-service offer with `closed_to_new` enrollment. Token rows bind to trained-token usage; hourly signal gaps remain unbound.                                                 |
| Fine-tuned inference on private derived IDs                                                                        | Normalize on a public `derived_model` account-resource template; never attach the private ID or its inference price to the base-model row.                                                        |
| Whole dashed price row such as an exact Cyber identity                                                             | Exact `not_published`; do not inherit a family/successor rate. Cell-local dashes use their documented non-numeric meaning.                                                                        |
| Scale/Reserved capacity and enterprise procurement                                                                 | Known resource candidates, bounded raw until their complete first-party surfaces are reviewed and admitted outside the API docs index.                                                            |
| API endpoint access, bandwidth/connections where explicitly unpriced, rate/spend limits                            | Explicit exclusion from price terms. Preserve route or account constraints separately; “API not priced separately” is not a free model execution.                                                 |
| Bedrock-billed OpenAI models, remote MCP charges, taxes, private discounts, balances, invoices                     | Explicit exclusion from the OpenAI public list-price partition. Bedrock belongs to AWS; third-party and private settlement stay external/account scoped.                                          |

### Authority, conflicts, and claim-local refresh

- For an exact covered amount, the dedicated pricing row supersedes the card fallback because cards
  link to the pricing page for details. Keep an unequal card observation as superseded/conflicting
  evidence and show a local hint. A conflict in one rate does not suppress other rates or the model.
- Model cards own identity, aliases, endpoint/tool support, and model-local context semantics. The
  pricing page cannot widen tool compatibility or invent aliases. Your Data owns region and exact
  processing eligibility. API/reference guides own usage-field semantics. Costs owns account spend.
- Parse each price table, row, cell, model card, guide relationship, and API binding independently.
  A malformed service row cannot erase model pricing; a missing card price cannot erase identity; a
  broken usage field cannot erase a numeric rate. Retain the prior claim only when its authority is
  non-exhaustive for fresh absence, with its original observation and a stale marker.
- A fresh exhaustive `/models/all` omission may remove that catalog identity subject to the existing
  lifecycle supplement rules. Pricing and lifecycle pages cannot re-admit arbitrary missing models;
  only the already reviewed exact supplement cases apply.
- A new commercial page, price column, tool kind, Usage path, or response field becomes a bounded
  coverage warning. It does not reject the provider. A row with a safe exact identity may be kept
  raw while recognized siblings refresh. Every normalized or raw atom remains traceable to the
  exact official source and source hash.
- Matching is deterministic: exact ID first, then a unique documented alias/display name. No family
  inheritance, fuzzy match, confidence vote, LLM, models.dev, or LiteLLM participates in refresh.

### Model-detail composition and cost coverage

Model details present synchronous PAYG and Batch as alternative model mechanisms; Realtime,
streaming duration, image/video, and other endpoint-specific mechanisms appear only on exact models
that expose them. Standard/Flex/Fast are selectable or realized tier variants inside synchronous
PAYG, not three radio offers. Provider services appear separately with precise names and units.

Web/File Search may compose additively with an exact supported Responses model. Containers and
Realtime input transcription must preserve their standalone ownership while showing route-local
additive use; they must not be hidden merely because a false global dependency was refused.
Vector-store and ChatKit storage remain standalone account services. Publication enrollment and
regional-processing notes render as badges/conditions, not calculator toggles without the required
request/account context.

Before a request, exact public rates support estimates from the requested mechanism, predicted
tokens/outputs, requested region, and requested service tier, with unresolved outcome warnings.
After a response, returned model, served tier, cache partitions, output usage, generated quantity,
and emitted search/file-search calls can correct the public-list estimate. Storage byte-days,
container minutes, capacity coverage, credits, and negotiated settlement remain partial until
account evidence exists. The UI should show that partial coverage rather than treating a known
model-token subtotal as the complete charge.

## Current request accounting boundary

- Price a completed Responses or Chat Completions request from the returned model, actual
  `service_tier`, and usage breakdown—not only the submitted request. `service_tier: auto` can use
  the project default, and Fast requests can be downgraded and billed as Standard. For GPT-5.6 and
  earlier, a Fast request is reported as `priority`; normalize that response value to the public
  Fast price tier.
- Responses usage publishes input, cached-input/cache-write, output, and reasoning-token counts.
  The organization Usage API additionally exposes uncached and modality-specific token totals and
  can group completion usage by model, batch, and service tier. Endpoint-specific request counts
  remain necessary for tool charges.
- The organization Costs API is the billing authority for account-specific effects, credits,
  negotiated terms, and the final charged amount. It exposes only daily buckets and aggregate line
  items, not a synchronous per-request quote. Use it for delayed reconciliation, never hot-path
  cost-based load balancing. Route on a public-price estimate before the request and correct the
  estimate from the response; do not wait for Costs API data.

## External comparators

- [models.dev](https://github.com/anomalyco/models.dev) is coverage-only evidence. Its OpenAI sync
  uses authenticated `/v1/models` to monitor account-visible availability while preserving
  community-authored TOML facts and deliberately not treating absence as lifecycle evidence. That
  confirms the API inventory boundary above, but its curated facts and PR-based updates are not an
  acceptable production source for this provider.
- [LiteLLM's model catalog](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)
  is also coverage-only evidence. Its broad community-maintained JSON and frequently refreshed
  hosted view are useful for finding IDs or meters to investigate in official sources, but never
  supply or override a Kmodels fact.
