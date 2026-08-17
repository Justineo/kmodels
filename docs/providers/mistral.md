# Mistral AI

Status: current

## Boundary

Mistral's partition is an AI Gateway rate book, not a model of every product Mistral sells. It
publishes direct model invocation rates and separately metered provider-hosted components whose
usage can be attributed to one request or result item.

The partition excludes classifier training and storage, Vibe plans, account billing, credits,
invoices, Enterprise API eligibility, regional uplifts without exact model availability, Data
Capture, Forge, Compute, private deployment, model weights, licenses, and partner settlement. These
are discarded as out of scope rather than preserved as raw or unknown pricing.

## Sources and identity

- The exhaustive public catalog statically parses the official
  `mistralai/platform-docs-public` model index, every imported model definition, the feature schema,
  and endpoint registry. Remote TypeScript is parsed, never executed.
- Every imported definition document must be present exactly once. A malformed definition is
  isolated and signaled without hiding recognized siblings. The first API name is canonical, later
  API names are aliases, and definitions without an API name do not create catalog rows.
- The official [API pricing page](https://mistral.ai/pricing/api/) is the preferred current amount
  source. The repository remains the fallback amount source and owns model identity, lifecycle,
  capabilities, and routes. For the exact overlapping claim, a price-page amount supersedes a
  conflicting repository amount; the losing observation remains local conflict evidence.
- Prompt-caching and Batch guides are claim-local catalog companions. The central price page and
  its optional OpenAPI and built-in-tool usage companions form a separate pricing overlay. This
  lets catalog identity advance when pricing acquisition fails; the last accepted pricing
  partition is retained and marked stale because the central page owns request-service amounts and
  current EUR prices.
- Optional authenticated `/v1/models` confirms only exact existing public base models or aliases.
  Private fine-tunes never create rows or enter durable data. Enable it with `MISTRAL_API_KEY`.

## Model pricing

- Lifecycle is read directly from the official definitions: `GA` is active/stable,
  `PublicPreview` is active/preview, and `Deprecated` and `Retired` retain their meanings. Retired
  models publish `not_applicable` and no current hosted rate, regardless of downloadable weights.
- USD and EUR are independent published list currencies. No exchange rate is inferred.
- Synchronous and Batch invocation are separate offers. Batch rates are derived at 50% only for
  models whose official feature definition supports batching. Their distinct offers already express
  selection; no synthetic `exclusive_with` relation is needed.
- Cache-read rates are derived at 10% of input only for supported Chat/FIM models without an
  explicit cached-input row. Exact `Cached input` rows in the repository model definition or the
  pricing page are direct cache rates, not additional ordinary input rates; an explicit page amount
  supersedes an older repository amount for the same claim.
- OCR/Document AI retain per-page rates, transcription and audio chat retain per-second input,
  speech synthesis retains submitted-character pricing, and text/embedding models retain token
  rates. Public-page labels must map to an exact model identity and operation; ambiguous rows are
  withheld without affecting siblings.

## Request services

The pricing page currently publishes five admitted request-attributable service books:

- code execution, per completed `code_interpreter` execution;
- web search, per completed `web_search` execution;
- premium news, per completed `web_search_premium` execution;
- image generation, per generated image; and
- Document Library retrieval, per completed `document_library` call.

Library OCR and indexing are ingestion/preprocessing charges and are not published. The Agent API
does not receive a separate book because Mistral states that its price is model usage plus tool
usage; it has no independent orchestration rate.

Exact current models with Agents or Conversations endpoints form the model projection of these
service books. The projection is compatibility metadata, not a commercial relation graph. Model
offers and service offers contain no enrollment or settlement topology.

## Usage binding and resilience

- Text input/output/cache rates bind to provider-reported token counters. With caching, uncached
  input is the input total minus the provider-reported cached partition.
- OCR binds to `usage_info.pages_processed`.
- Audio input binds to `usage.prompt_audio_seconds` rather than an invented request duration field.
- Speech synthesis binds to the submitted `input` character count.
- Built-in services bind to final connector usage or generated outputs, not tool declarations or
  streaming start events.

The OpenAPI and tool companions are parsed claim by claim. A missing or drifted usage contract
removes only that `charge_binding`; the numeric rate and all sibling facts remain. Unknown model
fields, unrelated OpenAPI operations, plan pages, weight metadata, and account billing changes are
outside the collector's reviewed input and cannot reject the provider.

Provider publication remains atomic only at the final validated partition boundary. Individual
malformed model definitions, pricing cards, labels, rows, currencies, feature values, endpoint
references, API fields, discount guides, or usage contracts produce local diagnostics and preserve
independently recognized facts. Count guards cover acquired source documents and systemic loss,
not a requirement that every row normalize successfully. A central pricing-source acquisition
failure retains the previous accepted partition and reports it stale.

## Presentation

Mistral model details show only invocation mechanism, applicable currency/operation conditions,
meter, rate, and usage-counting rule. Separately priced request services appear as related request
costs. Training, storage, plans, capacity, weights, enrollment, settlement, and account accounting
are neither collected nor projected into the UI.
