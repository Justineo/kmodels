# Mistral AI

Status: current

## Sources and identity

- The exhaustive public bundle statically parses the official
  `mistralai/platform-docs-public` model index, 55–90 imported definitions, feature
  schema, and endpoint registry. Never execute remote TypeScript.
- Every import must resolve once. The first API name is canonical, later API names are
  aliases, and definitions without an API name do not create rows. A separately
  published version remains part of identity without changing `model_id`.
- The official [API pricing page](https://mistral.ai/pricing/api/) is a required
  first-party companion, not a replacement catalog. Its structured model cards add
  USD/EUR list prices and may fill an exact ID or alias whose repository definition
  has no rate. Repository and page values must agree when both publish the same USD
  meter; conflicts are diagnosed and neither source silently overrides the other.
- Fixed first-party companions cover prompt caching, Batch, regional inference, the
  OpenAPI response schemas, [Admin usage metrics](https://docs.mistral.ai/admin/admin-api/usage-metrics),
  the [Admin Billing API](https://docs.mistral.ai/api/endpoint/beta/admin/billing),
  account billing, and subscriptions. They are accounting drift guards and do not
  create model identities.
- The OpenAPI companion is parsed as indentation-bounded YAML contracts rather than
  searched as one unbounded string. The collector guards `GET /v1/models`, its
  `ModelList`, base/fine-tuned cards and capability vocabulary, plus the exact usage
  schemas used by chat/FIM/embeddings, OCR, transcription, speech streams, and
  Conversations. A marker copied into an unrelated schema cannot satisfy a missing
  field in the reviewed block.
- Callable identity count and numeric/free current-pricing coverage must stay within
  reviewed bounds. Coverage is measured after coalescing repeated model/version
  identities and applying exact public price-card supplements.
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
  features, endpoints, and its embedded USD rates. Structured web components on the
  pricing page own exact USD/EUR card rows. Fixed documentation phrases and OpenAPI
  fields fail closed when accounting semantics drift.
- Price-card binding uses exact canonical IDs first, then published aliases. A card
  that matches no model, matches multiple candidates, uses an unknown label/unit, or
  conflicts with the repository remains an explicit reconciliation diagnostic.
  Duplicate responsive cards are excluded after requiring identical structured
  content; they are not counted as additional evidence.
- Every reviewed repository rate, discount policy, page row, free/not-published
  state, retired price, and recognized provider-service charge gets a disposition.
  Numeric/free model coverage is a separate output guard and cannot hide skipped
  input rows.
- Sources are classified as catalog, price-book supplement, accounting contract, or account
  inventory, and their observations are reconciled before output coverage is accepted.
- The public repository is itself a published artifact: its checked-in release
  workflow creates a PR to `platform-docs-public` from tagged documentation releases.
  The collector follows the raw `main` index and every exact import on each refresh,
  so additions and retirements require no hand-maintained model allowlist or LLM
  interpretation. Schema, count, bundle-size, pricing-coverage, and reconciliation
  guards stop publication when that upstream mechanism changes shape.
- Live ambiguities are retained as upstream disagreements, not treated as missing parser mappings.
  The repository publishes Voxtral Small output at `$0.30/M` while the pricing page
  publishes `$0.40/M`; the pricing page advertises retired Leanstral as temporarily
  free; and it still prices both input/output for retired Mixtral 8x7B and 8x22B.
  These facts remain visible diagnostics and do not revive retired offers or choose a
  conflicting current rate.
- Canonical compilation retains USD and EUR facts as applicability-qualified
  alternatives. It produces no commercial raw conflict and no current unknown-priced
  model; source-level disagreements listed above remain reconciliation diagnostics
  rather than being mistaken for cross-currency conflicts.

## Comparator audit

- Third-party books remain audit-only. A value absent from this catalog is imported
  only after an exact current first-party model/offer source is added to this
  deterministic pipeline. Historical aliases or unsupported values in ccusage,
  LiteLLM, or models.dev do not establish a current Mistral-hosted price.
- models.dev's Mistral TOML and LiteLLM's monolithic cost map are manually maintained comparison
  surfaces. They flatten lifecycle, multi-currency, non-token, Batch, and cache conditions and do not
  establish a current Mistral-hosted offer.
