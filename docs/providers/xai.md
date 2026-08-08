# xAI

Status: current

## Sources and identity

- Statically extract, but never execute, the reviewed public model payload. Parse only
  reviewed language, embedding, image, audio, and video categories with count bounds,
  and fail closed when a new model category appears. The catalog is non-exhaustive.
- Preserve the structured model `version` as identity. The public cluster map is also
  first-party model-region availability evidence; every model-bound public rate keeps
  its exact cluster region even though the current amounts agree across regions.
- The fixed `llms.txt` companion owns public pricing terms, releases, Speech to Speech
  models, lifecycle redirects, capability-wide statements, request examples, and the
  accounting contracts described below. Structured fixed-point prices must agree with
  the public tables, but hidden payload discount fields are not commercial evidence.
- Dated alias transitions in the public voice table are evaluated against the observation time and
  must agree with the structured service alias at that same point in time. Redirected exact IDs remain separate `legacy` rows because their slugs continue to
  resolve. Their effective pricing is derived from the single documented redirect
  target from the redirect date. Voice configuration names without documented request
  model parameters do not become IDs.
- Optional authenticated `/v1/models` and detailed model inventories are account-scoped,
  non-creating observations. Their integer prices are validated at the boundary but do
  not replace the global public price book. Detailed inventories preserve their version,
  while the general inventory may enrich a uniquely matching public identity. Enable
  them with `XAI_API_KEY`.

## Mapping

- Tasks are non-exclusive. Multi-agent behavior stays in Responses/capability evidence;
  realtime is delivery.
- Publish an endpoint only when an allowlisted fenced request example contains an exact
  request URL and resolvable model ID or alias. Model bindings come from the example,
  never a hardcoded model list or task inheritance.
- Parse Speech to Speech prices per documented request model ID and resolve every one
  against the structured realtime services. Each version keeps its own audio-minute and
  text-input rates; shared tool rates remain separate. Validate internal TTS, STT, and
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
- The `$0.05` pre-generation Responses usage-guideline violation fee is retained as a
  raw operation price because the shared meter vocabulary does not yet represent it.
  Public TTS and REST/streaming STT rates are reconciled as unbound service prices: the
  official request schemas do not expose the internal `grok-tts` and `grok-stt`
  configuration names as request model IDs, so the catalog does not invent identities.
- Dates require exact ID, alias, or display-name bindings. API `created` is not a model
  date.

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
  exact per-response Voice cost. Public character/audio/time rates remain usable, and
  a newly documented Voice cost field becomes an unsupported diagnostic for review.

## Extraction and reconciliation

- Refresh is deterministic and non-LLM. The static public payload owns model identity,
  fixed-point base prices, and region applicability. The public pricing section owns
  human-readable rates, Batch/Priority terms, tools, voice, storage, and the violation
  fee. Fixed official documentation sections own usage fields, exact response cost,
  billing history, timing, and account-tier semantics.
- The extractor cross-checks public text/token/image/video/voice amounts against the
  structured payload, binds price sets only to exact model identities, and emits an
  explicit disposition for model price sets and reviewed commercial terms. Storage and
  file-download prices are recognized provider-service charges but remain out of the
  model price book. Credits/limits and aggregate account cost are accounting evidence,
  not public rates.
- The earlier flow missed first-party information because it treated the embedded
  model payload and headline price tables as the complete commercial contract. It
  discarded public cluster applicability, did not review Cost Tracking or Management
  Billing, and silently left non-model voice/storage/violation terms outside coverage.
  The revised flow separates catalog, price book, request/response accounting contract,
  and account billing surfaces, then reconciles each class before output coverage is
  accepted.
- The live first-party bundle currently yields 20 identities, all with numeric public
  offers, and 908 regional/direct-or-derived normalized rate facts. Reconciliation has
  20 normalized model price sets, one raw operation price, two unbound non-model voice
  prices, and six excluded accounting/out-of-scope observations, with no ambiguous,
  unsupported, or unresolved item. The violation fee is attached to the two current
  Responses-capable identities as a raw fact.
- Third-party books remain audit-only. LiteLLM's xAI section includes older aliases and
  at least one stale redirected model rate; models.dev covers only a smaller text-led
  subset and omits current media costs and the wider service/account semantics. ccusage
  has no independent xAI billing source and consumes LiteLLM pricing data. None of these
  values is imported; a missing value is filled only by adding exact current xAI
  evidence to this pipeline.

## Kong AI Gateway

- Candidates require active lifecycle, acceptable maturity, and exact non-streaming
  Chat Completions, Responses, or Image Generations evidence.
- Function Calling also requires positive tool-call capability. Gateway request logs
  should retain resolved identity, region, requested and actual service tier, Batch
  mode, response usage details, successful tools, and `cost_in_usd_ticks` when present.
- Image Edits, Video Generations, and Realtime remain valid xAI facts outside Kong's
  current matrix.
- Absent or retired Kong examples never restore or alias provider IDs.
