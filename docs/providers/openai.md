# OpenAI

Status: current

## Sources and identity

- `/api/docs/models/all` is the exhaustive global catalog. Follow only 80–140 exact same-host model-card links.
- Accept IDs, aliases, snapshots, facts, endpoint cards, and card-local prices only from the
  matching card. Disabled cards add no evidence; an unknown endpoint label/path rejects the
  provider.
- The public Markdown price book is a non-exhaustive catalog supplement. Bind its exact IDs,
  current card aliases, and unique exact card display names to catalog models. A model-rate row
  whose identity matches none of those may create a minimal current row; this admits models such
  as `gpt-5-search-api` that OpenAI prices and documents outside `/models/all`. It fills cards that
  link out for pricing and adds explicit Batch, Flex, and Fast tiers. A card's numeric price block
  remains the Standard authority; price-book Standard rows only fill cards with no numeric facts.
- Account for every reviewed model-rate row in the price book. Rows used by the catalog are
  normalized; duplicate Standard rows and out-of-scope fine-tuning/tool prices are deliberately
  excluded; unmatched, ambiguous, or unsupported rows remain bounded reconciliation findings. An
  output model count is not a substitute for this input-row denominator.
- `/api/docs/models` is alias-only. `/api/docs/deprecations` is a non-exhaustive lifecycle
  supplement because `/models/all` can omit a model whose future shutdown table proves it remains
  callable. ISO dates and exact English month dates are accepted. A future-shutdown row may create
  a missing public identity; an already retired or fine-tuned identity may only update an existing
  exact catalog row. In a `snapshot | aliases` cell, retain one snapshot identity and attach the
  remaining codes as aliases. “Legacy” alone is not deprecation.
- The data-residency support matrix is a non-exhaustive catalog supplement for exact model/
  snapshot IDs, API endpoints, and `{region, regional_processing}` availability. Preserve the
  matrix's United Arab Emirates snapshot exceptions instead of widening the row-level region list.
  Service-only rows do not create models.
- Authenticated `GET /v1/models` is account-scoped validation. Private rows and absence never change the global catalog, and raw responses are not retained.
- Enable the optional inventory with `OPENAI_API_KEY`.

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
- The current refresh has five unknown-priced rows, each explained by exact source boundaries:
  deprecated `gpt-4-1106-preview` and `sora-2-2025-10-06` survive only through lifecycle evidence;
  `gpt-4o-2024-11-20` and `gpt-4o-tts` are present on support/API surfaces but have no exact current
  price row; and `gpt-5.4-cyber` is an exact current pricing-table identity whose input, cached-input,
  and output cells are all `-`. Family and successor prices are not inherited.
- Map exact Tools support to `computer_use` and code-execution capabilities, and explicit
  `reasoning.effort` value lists to effort control. Account-tier rate-limit tables do not fit
  model-global scalar limits. Tool/service rows and fine-tuning rows are reconciled but excluded
  from model base offers: tool storage/session charges require provider-service books and usage
  aggregation, while fine-tuned inference belongs to private derived IDs. The public 10% data-
  residency uplift also remains unmodeled until model release-cutoff eligibility and the configured
  project processing region can both be represented without deriving a release date from an ID.

## Gateway accounting boundary

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

## Kong AI Gateway

- Derive compatibility endpoint by endpoint; broad `text_generation` does not distinguish Chat Completions, Completions, Responses, or Assistants.
- Kong covers generation, completions, embeddings, files, batches, assistants/responses, speech, transcription, translation, image, realtime, and video. Moderation is outside its current OpenAI matrix.
- Files and batches are service-level operations. Agent behavior stays in endpoint and capability evidence.
- Treat Kong examples as configuration examples, not recommendations or lifecycle evidence.
