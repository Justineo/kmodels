# Gemini API

Status: current

## Sources and identity

- The exhaustive English-pinned bundle starts at the official model index,
  follows every reviewed model-card target, and includes fixed pricing,
  lifecycle, release, Gemma, Interactions, Live, and machine-readable v1beta
  Discovery references. Fixed first-party companions also cover billing,
  implicit and explicit caching, token usage, Flex and Priority inference,
  Batch, Search and Maps grounding, File Search, URL Context, Code Execution,
  model tuning, Deep Research and managed agents, the account-specific Google
  Cloud Pricing API, Cloud Billing export latency, and Google's published
  Gemini API billing service identity. These policy documents are drift guards
  and do not create model rates.
- A card target may describe one model or a family. Every property table with a
  labeled model or agent code is parsed independently, so shared overview pages
  do not silently collapse to their first model. Callable IDs still come only
  from those labeled cells; paths and headings never become IDs.
- Keep current and historical IDs, explicit aliases, facts, and dates bound to their source rows.
- Optional authenticated `/v1beta/models` is account-scoped. Exact `name` stays
  authoritative when `baseModelId` is absent. Refresh follows the documented
  `nextPageToken` chain with `pageSize=1000`, rejects repeated tokens or bounded
  page/model overflow, then removes pagination metadata before parsing.
  Malformed items reject the source; it cannot create rows or retain raw data.
- Enable the optional inventory with `GEMINI_API_KEY`.

## Mapping

- Tasks are non-exclusive. Agent and computer-use rows remain text generation with endpoint/capability evidence. Live audio is `speech_to_speech`.
- Interactions and every supported method require exact listed IDs plus fixed
  method/route references. The public Discovery JSON owns REST paths, inventory
  pagination, the Model schema, GenerateContent response observability, and
  usage/service-tier fields; the Live and Interactions pages own their distinct
  WebSocket and REST routes. Names, modalities, spelling, and neighboring tasks
  never imply an endpoint.
- Only reviewed `supportedGenerationMethods` with pinned REST/WebSocket routes
  add endpoint or delivery facts. Missing or unknown methods remain unknown.
- Pricing sections bind through an exact model ID or one unique explicit alias.
  An unknown reference is reconciled as unbound without creating a model. An
  unknown table shape, unit, meter, or agent formula is retained claim-locally
  as bounded raw evidence, while recognized sibling rows continue to refresh.
  Refresh fails only if the pricing document yields neither normalized nor raw
  facts, rather than using a fragile model-count coverage threshold.
- `Free Tier` and `Paid Tier` are account eligibility, while Standard, Batch,
  Flex, and Priority remain inference service tiers. Only the exact phrase
  `Free of charge` becomes a zero rate. A storage price stated “per million
  tokens per hour” remains a token-hour denominator, and search grounding
  stated per 1,000 requests remains request pricing.
- Interpret each paid table cell under its published billing header as one commercial value. Under a token header, a token price is primary and adjacent per-image figures are equivalent usage examples, even across line breaks; they are not additional charges. A per-image value is used only when the cell has no token price.
- Shared Google Search allowances stay as bounded raw allowance facts because
  their quota spans several models and cannot truthfully become a per-model
  allowance. Agent pricing likewise stays as a raw base-price formula because
  the total is the selected underlying model consumption plus tools. Neither is
  converted to zero or a fabricated fixed price.
- Grounding uses the official generation-specific denominator: Gemini 3 Search
  and Maps rates are per executed search query, while Gemini 2.5 and older rates
  are per grounded prompt. Search and Maps become separate provider-service
  books with `web_search` and `maps_search` meters; the former denominator uses
  a provider search unit and the latter a request unit.
- Every commercial pricing claim gets a reconciliation disposition. Numeric and
  explicit free rates are normalized; shared allowances and agent formulas are
  raw; `Not available` or availability-only cells are explicit non-numeric; the
  data-use row is excluded. Unknown identities remain unbound and unknown
  numeric structures remain raw instead of becoming guessed rates.
- Release dates require exact codes in a dated changelog item containing a
  reviewed release verb. Prefix text is allowed; names and date-like ID
  suffixes are not release evidence.

## Commercial topology audit

Design status: implemented. Model pricing is split into synchronous and Batch
offers; Standard, Flex, and Priority are realized-tier variants of synchronous
execution. Search, Maps, explicit cache storage, File Search, and managed-agent
formulas/environment policy are provider resources, and all offers use direct
Google settlement. File Search storage and query-time embedding are explicit
free states. Indexing, retrieval, and agent totals remain bounded formulas until
an exact realized target rate can be referenced without copying or guessing it.

### Public commercial source graph

| Surface                                                                                                                                                                                                                                                                                                                                                 | Exact authority and completeness boundary                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Models](https://ai.google.dev/gemini-api/docs/models), exact model cards, the [v1beta Discovery document](https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta), lifecycle, release, Gemma, Live, and Interactions references                                                                                                      | Public callable identities, explicit aliases, endpoint/method support, lifecycle, model limits, and response schemas. These surfaces establish model and mechanism compatibility, not prices merely because a model is callable.                                                                                                               |
| [Gemini Developer API pricing](https://ai.google.dev/gemini-api/docs/pricing)                                                                                                                                                                                                                                                                           | Current public amounts for its exact model, modality, context, service-tier, cache, media, tool, and agent rows. It is not an exhaustive model inventory. Each table is exhaustive only for its named mechanism and row set; adjacent per-item or per-minute figures are usage equivalences when the same cell publishes a primary token rate. |
| [Standard inference](https://ai.google.dev/gemini-api/docs/text-generation), [Flex](https://ai.google.dev/gemini-api/docs/flex-inference), [Priority](https://ai.google.dev/gemini-api/docs/priority-inference), and [Batch](https://ai.google.dev/gemini-api/docs/batch-api)                                                                           | API mechanism, selector, eligibility, downgrade/failure behavior, job lifecycle, result granularity, and usage signals. A documented percentage discount or premium checks an exact price row but never synthesizes a missing amount.                                                                                                          |
| [Context caching](https://ai.google.dev/gemini-api/docs/caching) and [GenerateContent explicit caching](https://ai.google.dev/gemini-api/docs/generate-content/caching)                                                                                                                                                                                 | Implicit cache-read behavior, explicit cache resource and TTL lifecycle, cache token observability, and storage semantics. They do not establish a separate cache-write price.                                                                                                                                                                 |
| [Google Search](https://ai.google.dev/gemini-api/docs/google-search) and [Google Maps grounding](https://ai.google.dev/gemini-api/docs/maps-grounding)                                                                                                                                                                                                  | Tool compatibility, executed-query or successfully grounded-prompt denominator, generation-specific allowances, and grounding response evidence. Pricing owns amounts; these guides own when a configured tool becomes billable.                                                                                                               |
| [File Search](https://ai.google.dev/gemini-api/docs/file-search), [URL Context](https://ai.google.dev/gemini-api/docs/url-context), [Code Execution](https://ai.google.dev/gemini-api/docs/code-execution), and [Computer Use](https://ai.google.dev/gemini-api/docs/computer-use)                                                                      | Persistent store and indexing lifecycle, retrieved/tool-use token accounting, code/result token accounting, and client-executed tool boundaries. Tool compatibility is not an independent tool fee.                                                                                                                                            |
| [Deep Research](https://ai.google.dev/gemini-api/docs/deep-research), [managed agents](https://ai.google.dev/gemini-api/docs/agents), and [agent environments](https://ai.google.dev/gemini-api/docs/agent-environment)                                                                                                                                 | Agent identity, asynchronous orchestration, default/composable tools, underlying inference formula, environment lifecycle, and the Preview no-environment-fee policy. Cost estimates are examples, not reusable rates.                                                                                                                         |
| [Model tuning](https://ai.google.dev/gemini-api/docs/model-tuning)                                                                                                                                                                                                                                                                                      | Current Developer API tuning availability. Vertex AI tuning is a different provider surface and cannot supply Gemini API offers.                                                                                                                                                                                                               |
| [Billing](https://ai.google.dev/gemini-api/docs/billing)                                                                                                                                                                                                                                                                                                | Free/Paid enrollment, Prepay/Postpay settlement timing, balance/credit behavior, spend controls, failed-request statements, and project/API-key attribution. These account facts do not replace public list rates.                                                                                                                             |
| [Cloud Billing Pricing API](https://docs.cloud.google.com/billing/docs/how-to/get-pricing-information-api), [detailed usage export](https://docs.cloud.google.com/billing/docs/how-to/export-data-bigquery-tables), and the [Gemini API GenAI-credit SKU group](https://cloud.google.com/skus/sku-groups/google-developer-program-premium-genai-credit) | Exact public/account SKU prices and delayed effective settlement. Gemini API service `AEFD-7695-64FA` and exact SKU IDs are strong billing identities. The credit-eligible SKU group is not guaranteed to be an exhaustive price book, and its descriptions never justify fuzzy model matching.                                                |

Gemini Enterprise Agent Platform, Vertex AI endpoints, Vertex tuning, and Vertex provisioned
throughput have different provisioning and billing surfaces. They belong to the `vertex` provider
audit even when they expose a Gemini-branded model.

### Resources, books, and offer boundaries

| Book/resource                           | Offers                                                                | Boundary rationale                                                                                                                                                                                                                                                                                  |
| --------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public model                            | Synchronous inference                                                 | Standard, Flex, and Priority use the same synchronous generation mechanism. They are requested/realized service-tier variants whose exact returned tier selects the amount; three copied model offers would misrepresent Priority downgrade and Flex failure behavior.                              |
| Public model                            | Batch inference                                                       | Separate offer because the Batch API is an asynchronous job mechanism with file/inline requests, independent quota, item results, cancellation, expiry, and a target completion window. The published 50% relation is not enough to manufacture a missing exact Batch row.                          |
| Public model                            | Live, TTS, image, video, music, embedding, and other direct endpoints | Preserve each exact callable mechanism and its native denominator. A Batch variant remains separate where the API and exact price row support it. Modality, resolution, duration, and context bands remain applicability variants unless they change the API/job mechanism.                         |
| `gemini.google-search` service          | Generation-specific grounding execution                               | The provider-executed search charge is separate from selected-model tokens. Gemini 3 query billing and Gemini 2.5-or-older grounded-prompt billing are applicability variants of the service, not copied pseudo-model prices.                                                                       |
| `gemini.google-maps` service            | Generation-specific Maps grounding                                    | Maps has its own successful-grounding condition, model compatibility, denominators, rates, and allowances. It must not inherit Google Search merely because both are grounding tools.                                                                                                               |
| `gemini.explicit-cache-storage` service | Stored explicit-context tokens                                        | A cache is an account resource that persists and accrues token-hours independently of later inference. Cache reads remain terms of the selected model offer; no official source establishes a cache-write fee.                                                                                      |
| File Search store                       | Persistent indexed corpus                                             | The store is an account resource. Storage and query-time embedding are explicit free offers; indexing and retrieval retain Google's target-rate formulas plus compatible model scope as raw until the realized target model can be bound exactly. No independent paid File Search rate is invented. |
| Deep Research agent                     | Provider-hosted asynchronous agent route                              | The agent orchestrates underlying Gemini inference and separately priced tools. It has no faithful flat model rate, and its published dollar ranges are estimates. Represent the agent resource and realized components without pretending it is a base model.                                      |
| Managed agent and environment resources | Provider-hosted agent route and sandbox environment                   | Underlying model/tool usage remains charged normally. Environment CPU, memory, and sandbox execution are unbilled only during Preview, so the current book retains that statement as applicability-bounded raw policy rather than a permanent zero rate.                                            |
| Billing account                         | Free/Paid enrollment and Prepay/Postpay settlement                    | Enrollment and money-movement timing select applicability and settlement but are not model service tiers or additional usage offers.                                                                                                                                                                |

Code Execution, URL Context, Computer Use, custom function tools, remote MCP, and generic
Interactions orchestration do not receive standalone Google-price books. Code/results, fetched
content, and retrieved corpus content contribute quantities to the selected model's input or
output meter; browser/MCP/customer execution belongs to the external cost partition. A universal
zero-rate tool offer would incorrectly imply that the composed model work is free.

### Relationship matrix

| Source                                   | Target                                             | Relationship and applicability                                                                                                                                                                                                                       |
| ---------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Batch model offer                        | Same model's synchronous offer                     | `exclusive_with` for one submitted billable execution. An account may use both mechanisms for different work.                                                                                                                                        |
| Google Search execution                  | Exact compatible synchronous model offer           | `requires` only when the provider executes a qualifying search. The model inference charge remains additive. A tool declaration, support badge, or empty/unexecuted query is not a charge.                                                           |
| Google Maps grounding                    | Exact compatible synchronous model offer           | `requires` only for the realized qualifying grounding event. Gemini 2.5-or-older Maps additionally requires a response with at least one Maps-grounded result.                                                                                       |
| Explicit cache storage                   | Exact model identity used to create the cache      | The cache resource is model-bound, but storage can persist without a current inference request. A later request using it combines its own model offer and cache-read term; relationship existence never copies token-hour charges onto each request. |
| File Search indexing                     | Compatible embedding model rates                   | The current book preserves the official target-rate formula and compatible embedding-model scope as bounded raw because the source does not bind one realized model per indexing job. Storage and query-time embedding remain explicit free states.  |
| File Search retrieval                    | Compatible generation model rates                  | The current book preserves the official model-input formula and compatible generation scope as bounded raw. Retrieved tokens do not become a duplicate File Search token rate.                                                                       |
| Code Execution or URL Context            | Exact compatible generation model offer            | No standalone price offer is created. Their returned token quantities are charged through the selected model's input/output terms; a future contribution edge requires exact non-overlapping response counters.                                      |
| Computer Use                             | Exact compatible computer-use model offer          | `requires` for model planning; client browser execution is external. Dedicated legacy computer-use model pricing remains ordinary model inference rather than a tool fee.                                                                            |
| Deep Research or managed agent execution | Realized model and provider-service offers         | The current agent resource retains Google's underlying-model-plus-tools formula as raw. Default tool availability establishes compatibility, not execution; no flat agent amount or speculative component edge is emitted.                           |
| Client fallback after Flex rejection     | New synchronous request and its realized tier      | A new independently priced runtime `attempt`, not an edge between Flex and Standard. Preserve its requested/resolved model, route, credential, outcome, and usage.                                                                                   |
| Priority automatic downgrade             | Same synchronous offer's realized Standard variant | No offer edge and no second request. Requested Priority and returned Standard are request/outcome facts on one attempt.                                                                                                                              |
| Promotional or prepaid account benefit   | Exact eligible Gemini API settlement usage         | Allowance/settlement target, not a model dependency. Generic Google Cloud credits do not qualify without the exact billing policy.                                                                                                                   |

Standard, Flex, and Priority have no offer relationships because they are variants of one
synchronous offer. Implicit cache eligibility and a model's tool support are compatibility facts,
not evidence that cache or tool work occurred.

File Search indexing/retrieval stays raw until a realized target model can be
bound mechanically. Code Execution and URL Context reuse model usage terms and
therefore have no separate rate or contribution book. This avoids duplicating
an already included response counter while leaving room for an exact
`contribution` edge when first-party usage evidence becomes non-overlapping.

### Meters, denominators, signals, and resolution phase

| Commercial atom                           | Published denominator                                                            | Charge or reconciliation signal                                                                                                                                                                      | Earliest reliable phase       |
| ----------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Uncached model input                      | Input tokens by modality                                                         | Interactions `total_input_tokens` and details; GenerateContent prompt/cache modality partitions. Subtract only fields whose source schema defines inclusion; never infer overlap from similar names. | Outcome                       |
| Cached input read                         | Cached input tokens by modality                                                  | Interactions cached-token usage or GenerateContent `cachedContentTokenCount`; implicit and explicit hits share the selected model's cache-read rate.                                                 | Outcome                       |
| Tool-use/intermediate model input         | Input tokens at the selected model's modality rate                               | Interactions tool-use tokens and GenerateContent tool-use-prompt tokens; exact API schema determines whether they are additive to or included in another reported total.                             | Outcome                       |
| Model output including thinking           | Output tokens by modality plus billed thinking tokens                            | Candidate/output and thought token partitions. Thinking is priced at the output rate but remains separately observable; do not create an independent thinking price.                                 | Outcome                       |
| Long-context band                         | Full request usage at the exact published context threshold                      | Tokenized request/context length selects the row; the threshold is not an allowance and does not price only tokens above the breakpoint.                                                             | Request estimate / outcome    |
| Document input                            | Document tokens charged at the published image-input token rate                  | `DOCUMENT` modality details. Response modality identity selects the rate; a generic total-token count is insufficient.                                                                               | Outcome                       |
| Explicit cache storage                    | Cached tokens × retained hours                                                   | Cache resource token count, create/update/expiry timestamps, and TTL. A cache-write request is not a separate fee.                                                                                   | Account resource / settlement |
| Batch model usage                         | Successful item/result's native model denominator                                | Per-item response usage or exact billing SKU. Submitted item count and enqueued tokens are quota facts; failed/canceled job status cannot erase already realized sibling results.                    | Job outcome / account         |
| Gemini 3 Search/Maps                      | Executed search query                                                            | Interactions grounding-tool count and step query evidence; empty queries are excluded. Exact response/billing evidence resolves count where aggregate usage is incomplete.                           | Outcome / account             |
| Gemini 2.5-or-older Search                | Grounded prompt                                                                  | Qualifying grounded response/support URL and exact generation-specific usage or SKU. One prompt may contain multiple internal queries without changing this denominator.                             | Outcome / account             |
| Gemini 2.5-or-older Maps                  | Successfully Maps-grounded prompt                                                | At least one Maps-grounded result plus exact supported model/generation. Configuration alone is insufficient.                                                                                        | Outcome / account             |
| Native image generation                   | Output image tokens where primary; otherwise generated image                     | Output token/image count and requested/realized resolution. Adjacent per-image dollar examples do not become additional charges beside a token row.                                                  | Outcome                       |
| Veo video                                 | Successfully generated output second at exact variant/resolution/audio rate      | Successful result duration and exact model/variant. Requested duration cannot substitute for a failed or shorter result.                                                                             | Outcome                       |
| Lyria music                               | Generated clip/song request at the exact model row                               | Successful model result. Fixed clip/full-song identities select the price; output audio seconds are not the published denominator.                                                                   | Outcome                       |
| Live, TTS, translation, and native audio  | Tokens by modality                                                               | Operation-native modality usage. Published per-minute figures remain equivalences when the same row's primary rate is per token; session wall time is not a separate charge.                         | Outcome                       |
| Embeddings                                | Input tokens; native item/time examples only where no primary token row exists   | Embedding response/batch usage with exact modality. Per image, video second, or frame figures beside a token rate are equivalences.                                                                  | Outcome                       |
| File Search indexing                      | Indexed content tokens at the selected embedding model rate                      | Index operation and exact embedding-model usage/billing SKU. Store bytes are not a substitute.                                                                                                       | Job outcome / account         |
| URL Context/File Search retrieved content | Tool-use/input tokens at the selected generation model rate                      | Tool-use and modality partitions plus exact selected model. Preserve as usage contribution until inclusion in aggregate usage is proven.                                                             | Outcome                       |
| Code Execution generated/reused content   | Output tokens when produced; input tokens when reused by the model               | Code-execution parts and usage partitions. Executed code cells, runtime duration, CPU, and memory have no independent published denominator.                                                         | Outcome                       |
| Agent orchestration                       | Every realized underlying model token plus each qualifying priced tool execution | Agent/Interaction steps, aggregate usage, grounding counts, and exact billing SKUs. Missing underlying model identity makes the estimate partial; published `$1–$3` examples are not rates.          | Step/outcome / account        |
| Public/account settlement                 | Exact Gemini API SKU amount in account currency                                  | Cloud Pricing API exact SKU, detailed usage export, credits, adjustments, and invoice attribution. SKU description text alone cannot bind a model.                                                   | Account settlement            |

TPM/RPM, usage tiers, spend caps, queued Batch tokens, account balance, and model/tool
availability are admission or settlement constraints. They never become charge quantities merely
because they use token, request, or currency units.

The pricing page can publish cache-storage rows scoped to Standard, Flex, or Priority, while the
explicit cache-creation API has no reviewed service-tier selector. Preserve each exact numeric row
and its source scope, but leave its request-to-storage attribution unresolved until an exact billing
SKU or account record supplies it. Do not assign every cache to Standard or manufacture a cross-tier
storage rule.

### Requested, realized, allowance, enrollment, and settlement facts

- `service_tier=flex`, `priority`, an omitted/default selector, model ID, Batch submission,
  modality, output configuration, tools, cache name, and TTL are request/resource facts. Returned
  service tier, model version, usage partitions, grounding counts, successful generated quantity,
  agent steps, and per-Batch-item results are outcome facts.
- Priority is currently available only to eligible paid usage tiers. If capacity limits are
  exceeded, Google automatically serves the same request as Standard and bills Standard. Flex has
  no automatic Standard fallback: an unavailable Flex request fails, and any client retry is a new
  separately priced route attempt.
- The pricing table currently contains Priority `Free of charge` cells while the mechanism guide
  excludes Free Tier projects. Mechanism eligibility is the stronger applicability authority, so
  those zeros are unreachable under current public rules. Retain the conflicting cells as local
  evidence/warnings; do not expose a usable free Priority estimate or reject unaffected rates.
- Search and Maps free usage is an account/project benefit with generation/model grouping and reset
  scope defined by the exact table. It is not a per-model zero rate. Gemini 3 query allowances and
  Gemini 2.5 grounded-prompt allowances retain different denominators and scopes.
- Free versus Paid is project/account enrollment on the same API mechanism, not a service tier.
  Exhaustion of a Free Tier rate limit stops work rather than silently converting the same request
  to paid overage. Usage tier, rate limit, and account caps remain eligibility/admission facts.
- Prepay and Postpay change settlement timing, not public list rates. Prepaid balance expiry,
  minimum funding, promotional-credit precedence, and the approximately ten-minute deduction lag
  are account facts. A zero balance can stop all keys while in-flight long work still creates
  delayed charges.
- Only promotional credits explicitly eligible for Gemini API apply. The generic Google Cloud
  welcome credit is not inferred as eligible. Taxes, currency conversion, negotiated prices,
  enterprise discounts, and adjustments belong to account settlement.
- A documented HTTP 400/500 request is not token-billed but still consumes quota. Status alone is
  insufficient for Batch or agent jobs: preserve every successful result/step whose usage or exact
  SKU proves realized work.

### Commercial-atom disposition ledger

| Reviewed atom class                                                                                            | Design disposition                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact Standard/Flex/Priority synchronous amounts                                                               | Normalize into one synchronous model offer with requested/realized service-tier applicability. Never derive an absent amount from the advertised percentage relation.                                                     |
| Exact Batch amounts                                                                                            | Normalize into a separate model offer and native item-result meter. Do not infer whole-job charges from submissions or status.                                                                                            |
| Live, TTS, image, video, music, embedding, robotics, and other direct endpoint amounts                         | Normalize only on exact model/mechanism rows, preserving modality, resolution, context, and native denominator.                                                                                                           |
| Token rate plus adjacent per-image/minute/second/frame value                                                   | Normalize the token rate; retain the adjacent value as a usage equivalence, not a second charge. Use the native item/time value only where no primary token price is published.                                           |
| Cache-read and explicit cache-storage amounts                                                                  | Cache read stays in the model offer; storage enters a provider-service book with token-hour meter. No cache-write term is invented. Tier-scoped storage attribution remains unbound where the API lacks the selector.     |
| Search and Maps amounts                                                                                        | Normalize into separate provider-service books with exact generation-specific denominator and outcome trigger.                                                                                                            |
| Shared Search/Maps allowances                                                                                  | Normalize as account/project allowances only when exact generation, model group, denominator, quantity, and reset scope are all published; otherwise retain the allowance atom bounded raw. Never duplicate it per model. |
| Code Execution, URL Context, File Search retrieved content, and File Search indexing                           | Reuse exact model usage where response counters already establish it. Preserve File Search target-rate formulas raw until the realized model/rate binding is mechanical; do not copy target rates.                        |
| File Search storage and query-time embedding                                                                   | Explicit free states because the official page publishes these without a preview qualifier.                                                                                                                               |
| Managed agent environment compute during Preview                                                               | Bounded raw no-billing policy because Preview is not a permanent applicability interval.                                                                                                                                  |
| Deep Research and managed-agent formulas                                                                       | Preserve as component composition. Normalize every independently priced underlying component; keep the whole partial when exact model/step identity is absent. Never convert published dollar examples into fixed rates.  |
| `Not available`, availability-only cells, or unsupported tuning                                                | Explicit non-numeric/exclusion for the exact cell. Do not turn absence or a dash into zero and do not import Vertex tuning.                                                                                               |
| Free Tier `Free of charge`                                                                                     | Normalize as an explicit free applicability variant only when current mechanism/model eligibility makes the cell reachable. Unreachable Priority zeros remain conflict evidence.                                          |
| Model data-use statement                                                                                       | Explicit non-commercial exclusion from price terms; preserve it as provider policy where needed.                                                                                                                          |
| Exact Cloud SKU public/contract amount                                                                         | Normalize only with exact SKU/service binding. Account price and settlement may supersede the public amount for that account without rewriting the public observation.                                                    |
| Rate limits, usage tiers, balance, spend caps, taxes, generic credits, API-key metadata, Vertex/Enterprise use | Keep as admission, enrollment, external, or settlement facts. They are not Gemini API public usage rates.                                                                                                                 |
| Unrecognized price row, unit, agent formula, tool kind, SKU relation, or allowance scope                       | Retain the safe exact atom bounded raw with a coverage warning; withhold only the unresolved claim. It must not erase recognized siblings, model identity, or previous independent sources.                               |

### Authority and conflicts

- The exact pricing-page cell owns its public list amount. Mechanism guides own selectors,
  eligibility, failure/downgrade behavior, billable outcome, and usage-field semantics. Model
  cards/Discovery own identity and compatibility. Cloud Pricing API and Billing export own exact
  SKU/account amounts and settlement; they do not create model identity.
- Join public models by exact ID or one unique documented alias. Join billing only by exact Gemini
  API service and SKU identity supplied by a first-party source/account record. Never fuzzy-match
  descriptions, inherit a family price, vote across comparators, or involve an LLM in refresh.
- An exact account-contract amount supersedes public list price only for that account and same SKU,
  currency, region, validity, and tier. Preserve both observations and show the conflict/scope. A
  Search allowance conflict cannot suppress model inference; a cache-storage ambiguity cannot
  erase cache-read rates; an unknown agent step cannot erase known components.
- Parse each model row, price cell, tool rule, allowance, cache/agent resource, and SKU binding
  independently. A newly malformed table or unknown column creates a claim-local warning. Retain a
  previous accepted claim only when the fresh authority is not exhaustive for absence, with its
  original observation and stale marker.
- Fresh exhaustive model-card/API absence may remove identity subject to the provider's lifecycle
  rules. Pricing, tools, agent pages, and SKU listings cannot re-admit arbitrary missing models.
  Conversely, a missing price never removes a valid model.
- Every discovered commercial atom receives one disposition: normalized, raw/unbound,
  non-numeric, or excluded. New but safely identified atoms remain bounded raw so refresh continues
  best effort; malformed unrelated siblings do not reject the provider bundle.

### Model-detail composition and cost coverage

Model details should present synchronous and Batch as alternative mechanisms. Standard, Flex, and
Priority render as requested/realized variants within synchronous inference, with the Priority
downgrade and Flex no-fallback conditions visible. Endpoint-specific media/embedding offers appear
only on exact compatible models and retain their native meters.

Search and Maps render as additive provider services only after a qualifying execution. Cache-read
terms remain with model inference; explicit cache storage remains a standalone account resource.
File Search should show explicit free storage/query embedding plus its raw indexing/retrieval
composition. URL Context and Code Execution should explain that their token usage is charged through
the selected model rather than show a fake duplicated price. Deep Research and managed agents should
show the raw component formula and an incomplete-coverage warning whenever the realized underlying
model, tool count, or account SKU is unavailable.

Before dispatch, the catalog can estimate from exact model/mechanism, requested tier, predicted
modality/context/quantity, configured tools, and published account enrollment, while marking
outcome-dependent components. After the response or job, returned tier, usage partitions, executed
grounding, successful media quantity, and agent/Batch results refine the public-list estimate.
Allowances, cache/storage duration, promotional credits, contract prices, delayed SKU settlement,
tax, and currency remain partial until account evidence exists. A known model-token subtotal must
never be presented as the complete composed charge.

## Public estimate and account-exact cost

- The public price page is enough for a list-price estimate only when the
  gateway knows the exact model, free or paid project, API operation, actual
  Standard/Flex/Priority/Batch tier, context threshold, input/output modality,
  output resolution or duration, cache outcome and storage TTL, grounding tool
  count, and agent-loop usage. A request parameter alone is insufficient when
  Priority can be downgraded; use the returned tier or response header.
- Gemini billing-account levels determine eligibility, rate limits, and account
  caps. Prepay versus Postpay determines when money moves, not a different
  published model rate. Free versus paid eligibility does change applicable
  rates. Promotional credits, tax, currency conversion, Enterprise volume
  discounts, and custom contracts are account-level adjustments.
- The preview Google Cloud Pricing API and the account pricing export are the
  first-party sources for list and contract SKU prices when the Gemini charge has
  an exact SKU binding. Google's SKU-group publication confirms that Gemini API
  is billing service `AEFD-7695-64FA`; the group is a credit-eligibility list,
  not an exhaustive model-price catalog. Query the account Pricing API under
  that service and join exact SKU IDs from billing data instead of matching SKU
  descriptions. Detailed usage cost export supplies effective cost, credits,
  currency, adjustments, and invoice attribution. Do not infer a contract
  discount from the public Gemini model table.
- The official pages have a surface-sensitive conflict: the pricing page says
  Google AI Studio usage is free in available regions, while the billing FAQ
  says AI Studio usage linked to a paid API key is charged. Treat the project/key
  billing state as authoritative and never encode a universal AI Studio zero
  rate for Gateway traffic.

## Request, response, and freshness

- Interactions usage reports input, output, thinking, cached, and tool-use tokens
  with modality breakdowns, plus grounding tool counts for Search and Maps.
  GenerateContent usage metadata reports prompt, cached-content, candidate,
  thinking, and tool-use-prompt tokens with prompt/cache modality details and
  the effective service tier. Its response schema also publishes `responseId`,
  `modelVersion`, and `modelStatus`, which should be retained for request-level
  reconciliation but do not replace the catalog lifecycle table. Thinking
  tokens are billed with output tokens.
- Document tokens appear under the `DOCUMENT` modality but are billed at the
  image-token rate. A generic total-token count is therefore insufficient;
  preserve response modality breakdowns. Explicit cache cost additionally needs
  the cache metadata token count and configured TTL. Implicit cache hits are
  reported and are enabled by default on Gemini 2.5 and newer models.
- Flex is selected by the client and has no automatic Standard fallback. Priority
  can be downgraded, so the gateway must observe `x-gemini-service-tier` or the
  response tier. Search/Maps usage is outcome-dependent; Interactions provides
  the strongest per-request grounding count.
- Prepay deductions have an approximately ten-minute billing-pipeline lag, but
  that balance is account aggregate. Cloud Billing cost details are typically
  available within a day, can take more than 24 hours, and BigQuery export has no
  delivery guarantee. Account pricing export runs once daily. None of these is a
  hot-path cost oracle.
- AI Studio `Dashboard > Usage` is the first-party interactive usage view. Cloud
  Billing reports can be filtered to the Gemini API service and grouped by SKU;
  API keys have no independent billing settings, so attribution is project and
  billing-account based. A documented 400/500 request is not token-billed but
  still consumes quota, and long-running batch or agent work can overrun a spend
  cap before delayed accounting catches up.
- Cost-based routing should use a locally cached public or account-contract price
  book plus request parameters before dispatch, then update estimates from the
  response usage and actual tier. Reconcile later with Cloud Billing export and
  invoices; do not load-balance on delayed aggregate cost reports.

## Extraction and reconciliation

- Refresh is deterministic and non-LLM: bounded model-card/property tables own
  identity; recognized pricing table headers and cells own public rates, while
  unknown pricing shapes remain claim-local raw/unbound evidence; the public
  Discovery schema plus explicit Live/Interactions references own endpoints;
  fixed billing phrases fail closed when accounting semantics drift. Public
  pricing never creates an unlisted model. The authenticated inventory follows
  all documented pages and remains an overlay rather than an identity source.
- ccusage remains comparison-only because it obtains prices through LiteLLM.
  Its weekly auto-update workflow imports only OpenRouter and Vercel Gateway data;
  direct Gemini rows remain manually maintained. Detailed tier fields are useful
  leads, but Vertex-labeled entries and Vertex pricing cannot be merged into the
  Gemini Developer API surface.
- models.dev's hourly Google sync correctly follows the official Models API pagination, but sets
  `skipCreates` and only updates API-authoritative fields on pre-existing manual
  rows because that API omits pricing, modalities, lifecycle, release dates, and
  several capabilities. This is a useful independent confirmation of the same
  source boundary, not evidence for missing rows or rates.
- Portkey's workflow validates and publishes JSON after a push but does not fetch Google's catalog,
  so updates are manual and retain many historical IDs. It is useful as a drift
  lead only. Portkey, LiteLLM, and models.dev are never accepted as model or
  pricing evidence. A fixed Deep Research base rate from any comparator is less
  faithful than Google's first-party formula covering all underlying and
  intermediate inference plus tools.
