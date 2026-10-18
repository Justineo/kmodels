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
- The official [API pricing page](https://docs.mistral.ai/inference/pricing) is the preferred current amount
  source. The repository remains the fallback amount source and owns model identity, lifecycle,
  capabilities, and routes. For the exact overlapping claim, a price-page amount supersedes a
  conflicting repository amount; the losing observation remains local conflict evidence.
- The current pricing page renders four reviewed `Model`/`Input`/`Cached input`/`Output` HTML
  tables instead of the former model-card elements. Table links provide navigation only; each
  row still binds through its unique exact active catalog title. Dollar-prefixed cells establish
  USD; EUR requires the separately verified source-owned conversion described below. Explicit page units remain scoped to
  their row: tokens, OCR pages, audio minutes, or speech characters.
  The manifest uses the canonical documentation URL directly. Relative model-card links resolve
  on `docs.mistral.ai`; resolving them against the former `mistral.ai/pricing/api/` entry point
  silently lost every discovered companion after its cross-host redirect. The Markdown view has
  a different layout and is not the HTML parser's input.
  A promotional cell's single `ins` amount is current; its paired `del` amount is the superseded
  regular price. Screen-reader labels do not become part of either amount. Malformed, duplicate,
  or otherwise unreadable sale markup is isolated to the affected cell and signaled.
  Header semantics remain part of the meter: a cached-input page cell cannot overwrite ordinary
  OCR pages. Cached non-token columns currently have no reviewed meter/quantity contract and are
  signaled as unsupported, preserving ordinary page, minute, and character amounts.
  The page's model tables
  alone do not establish current request-service rates or prove those rates were withdrawn.
  A missing service section requires first-party successor evidence before a source repair;
  until then the topology guard retains the accepted partition.
- Prompt-caching and Batch guides are claim-local catalog companions. The central price page and
  its optional OpenAPI, built-in-tool, currency and Priority companions form a separate pricing overlay. This
  lets catalog identity advance when pricing acquisition fails; the last accepted pricing
  partition is retained and marked stale because the accepted partition also includes
  request-service amounts and EUR prices from the previously reviewed central page.
  Currency and Priority documents carry numeric price policy: they are optional for acquisition but
  are not claim-local. Failure to acquire either retains the accepted pricing partition; acquired
  content whose policy cannot be interpreted produces scoped raw fallback. Accounting-only
  companions remain claim-local, so their failure withholds only the affected mappings.
- Optional authenticated `/v1/models` confirms only exact existing public base models or aliases.
  Private fine-tunes never create rows or enter durable data. Enable it with `MISTRAL_API_KEY`.

## Model pricing

- Lifecycle is read directly from the official definitions: `GA` is active/stable,
  `PublicPreview` is active/preview, and `Deprecated` and `Retired` retain their meanings. Retired
  models publish `not_applicable` and no current hosted rate, regardless of downloadable weights.
- Legacy cards publish independent USD and EUR amounts. Current table EUR amounts are derived only
  from the official currency module's explicit conversion; no external exchange rate is inferred.
- Public cards may use paragraph titles without clipboard IDs. Bounded first-party model-card
  links can establish identity through one labeled API-ID copy button in the fetched model
  document. The button's visible text and copy payload must agree; the exact ID or alias must
  resolve to one non-retired repository model. Ambiguous or conflicting documents remain unbound.
  Without usable linked identity, the title must exactly equal one active repository model name.
  Documentation URL slugs never become API IDs, and linked pages never create new catalog models.
  Explicit card IDs and aliases retain their existing precedence.
- Synchronous and Batch invocation are separate offers. Batch rates are derived at 50% only for
  models whose official feature definition supports batching. Their distinct offers already express
  selection; no synthetic `exclusive_with` relation is needed.
- Cache-read rates are derived at 10% of input only for supported Chat/FIM models without an
  explicit cached-input row. Exact `Cached input` rows in the repository model definition or the
  pricing page are direct cache rates, not additional ordinary input rates; an explicit page amount
  supersedes an older repository amount for the same claim. An explicit cache amount survives
  whether it appears before or after the ordinary input row; only a derived cache fallback is
  recalculated when the base input amount changes.
- OCR/Document AI retain per-page rates, transcription and audio chat retain per-second input,
  speech synthesis retains submitted-character pricing, and text/embedding models retain token
  rates. Public-page labels must map to an exact model identity and operation; ambiguous rows are
  withheld without affecting siblings.

Repository pricing reconciliation counts only successfully mapped rates as normalized. Unsupported
custom row shapes and unsupported denominators receive separate diagnostics while recognized
sibling rates survive. An unreadable published rate is `unknown`, not a claim that no price was
published. Only a valid, explicitly empty current price definition establishes `not_published`.

The current
[pricing component](<https://github.com/mistralai/platform-docs-public/blob/main/src/app/%5Blocale%5D/(docs)/inference/pricing/_components/pricing-table.tsx>)
has Priority and regional controls. Its
[currency module](https://github.com/mistralai/platform-docs-public/blob/main/src/schema/models/pricing-currency.ts)
defines the EUR factor (`0.85`) and display precision. The adapter statically verifies the unique
constant, precision and conversion function without executing remote code. It derives exact EUR
rates for the current table, including Batch, and withholds a derived EUR amount that would require
display rounding. Direct EUR amounts on legacy cards take precedence over conversion for the same
rate, even when the current currency module is available. An uninterpretable currency contract or
unsupported display precision preserves affected EUR tariffs as scoped raw observations, including
conditional Priority scope; independently known USD rates survive.

The [Priority guide](https://docs.mistral.ai/inference/priority-tier) supplies a current multiplier
of `1.75` on standard input, output and cache-read token rates. The adapter applies it after the
cache discount, only to current priced models and the positively observed Chat Completions endpoint.
It does not extend the rule to OCR pages, audio seconds, characters, embeddings, Batch or tool
fees. Standard and Priority remain variants of synchronous inference, selected by
`served_service_tier`; Batch remains a separate mechanism. Conditional Priority prices do not
establish account entitlement, model enrollment or availability.

The response guide maps actual fulfillment to `/usage/service_tier`, with `standard` and `priority`
values. Requested `auto` cannot select the final billed tariff. The response mapping is independent
from the multiplier: field drift removes its locator while preserving the known rates, leaving the
served tier to the caller. No terminal-stream mapping is inferred from a synchronous example.
Priority variants require the exact Chat endpoint and retain only completion quantity methods.
The tier locator is attached only within that endpoint's scope. A model's additional Conversations
support cannot broaden a Chat field contract; endpoint-independent Standard variants leave tier
acquisition to the caller rather than advertising that field for every API.
Missing owned price policies and served-tier contracts produce repairable source diagnostics.
An uninterpretable Priority price rule preserves a raw tariff scoped to that tier and the Chat
endpoint, rather than implying that the price was withdrawn.

The [regional guide](https://docs.mistral.ai/inference/regional-inference) publishes a 10% token
uplift but requires separate model availability evidence. The broad UI toggle alone cannot
establish a model/region tuple. The adapter records this explicit exclusion and does not create a
regional resource book that could masquerade as the missing request-service topology.

Conflicting numeric rows within one price page have equal authority. Both survive parsing and
become local canonical conflict evidence; their order cannot select a winner. An explicit page
rate outranks repository evidence, including for cache prices, but never outranks another explicit
amount from the same page merely because it was encountered later. Valid sibling meters remain.

## Request services

The accepted partition contains five admitted request-attributable service books from the
previously reviewed pricing cards:

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

- The pricing overlay publishes 20 quantity-acquisition contracts and the independent served-tier
  selector when its guide is available, separately from the
  numeric rates. They cover synchronous and terminal-stream completion token counters, cache reads,
  embedding input tokens, Conversation tokens, OCR pages, transcription/audio-chat seconds, speech
  input characters, three connector counters, and completed image outputs. Every contract records
  its request/response/result channel, JSON Pointer or provider-owned derived field, availability,
  absence-as-zero semantics where documented, and source reference.
- Chat/FIM text input with caching uses an explicit `prompt_tokens - cached_tokens`, floored at zero.
  Cache absence is zero because Mistral documents that `cached_tokens` is zero or omitted. Output and
  cache-read terms consume their direct counters.
- Conversation input adds `usage.prompt_tokens` and `usage.connector_tokens`; examples show connector
  tokens are a separate part of total model usage. Conversation output consumes
  `usage.completion_tokens`. This prevents tool context from disappearing from model-token cost while
  keeping the per-call tool charge separate.
- OCR consumes `usage_info.pages_processed`. Transcription and audio chat consume
  `usage.prompt_audio_seconds`. Speech synthesis consumes a provider-owned accepted-character count
  derived from the required `SpeechRequest.input`; Kmodels does not guess whether Mistral counts
  Unicode code points, graphemes, or encoded units.
- Code execution, ordinary web search, and Document Library retrieval consume the corresponding
  final `usage.connectors.*` counters. Image generation consumes completed `tool_file` image outputs,
  not tool declarations, start events, or connector invocations.

The OpenAPI, prompt-caching, and tool companions are parsed field by field. A missing or drifted
field removes only that input locator. Independently known calculations and their surviving
locators remain; the caller must supply any unmapped required signal. The semantic
`charge_binding`, numeric rate, and sibling facts remain. The collector no longer creates raw
`accounting_binding_unavailable:*` or `charge_binding_unavailable` compatibility terms. Unknown
model fields, unrelated OpenAPI operations, plan pages, weight metadata, and account billing changes
are outside the collector's reviewed input and cannot reject the provider.

Accounting follows the actual owning request or response through direct properties, local schema
references and compositions. The common synchronous completion contract requires both Chat and FIM
response owners; streaming uses the completion chunk. An unrelated reference to the same usage type
cannot establish a field. Tokens, pages and connector calls require integer counters; elapsed seconds
accept numeric counters. Speech input requires a string. Connector maps require an explicit integer
value schema, rather than merely an object or unrestricted dictionary. Image counting requires the
returned output array and its documented completed-image contract; it does not depend on unrelated
usage counters. Native indented and indentless YAML lists are supported. Nullable types and additive
siblings retain established fields; duplicates, wrong types, unknown union alternatives and cycles
withhold dependent locators. Duplicate companion documents are likewise isolated to their dependents.

The pricing overlay returns service facts and accounting inputs independently of model observations.
Its model results contain actual model pricing facts; an unpriced lexical model is not an input or
service carrier. A service-only source can be captured and replayed with no model rows. Accounting
and source-owned service prices survive independently of central-page model coverage.

Two published rates intentionally remain semantic-only. Batch output is a downloaded JSONL file,
but the public Batch guide and OpenAPI do not define a stable per-result usage envelope, so Batch
bindings have no executable input source. Premium news is priced per call, but the first-party guide
does not publish a final `web_search_premium` usage-counter example; its binding likewise has no
`quantity_methods`. These are evidence gaps, not runtime-lifecycle work for Kmodels.

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
