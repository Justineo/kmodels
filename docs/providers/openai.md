# OpenAI

Status: current

## Sources and identity

- `/api/docs/models/all.md` is the exhaustive global catalog. Follow only 80–140 exact same-host
  Markdown model-card links. The Markdown cards are the primary semantic source for IDs, display
  names, descriptions, documented routed aliases, snapshots, modalities, limits, endpoints,
  capabilities, and lifecycle badges. Require the card's `Model ID` to agree with its URL and the
  index to agree exactly with the fetched card set.
- Endpoint tables are complete matrices, not positive-only lists. Accept only the reviewed exact
  endpoint label/route pairs and exact `Supported`/`Not supported` states. A new route, a renamed
  route, or an omitted reviewed row rejects the provider. Supported-feature and supported-tool
  lists are positive lists; unknown additions are retained as reviewable source changes without
  breaking unrelated extraction.
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
  out for pricing and adds explicit Batch, Flex, and Fast tiers. A card's numeric price block remains
  the Standard authority; price-book Standard rows only fill cards with no numeric facts.
- Account for every reviewed model-rate row in the price book. Rows used by the catalog are
  normalized; duplicate Standard rows and out-of-scope fine-tuning/tool prices are deliberately
  excluded; unmatched, ambiguous, or unsupported rows remain bounded reconciliation findings. An
  output model count is not a substitute for this input-row denominator.
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
  A newly indexed commercial page rejects the source until its relevance and mapping are reviewed.
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
