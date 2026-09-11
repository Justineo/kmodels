# Gemini API

Status: current

## Boundary

The Gemini catalog covers first-party public model identities and direct invocation rates that an
AI gateway can select or observe for one request or asynchronous result. It does not model Google's
complete billing system.

Included:

- online and Batch model invocation;
- input, output, cache-read, embedding, image, audio, video, and other direct generation rates;
- request/outcome dimensions such as account eligibility, realized service tier, context band,
  modality, resolution, and operation;
- independently priced Google Search and Google Maps grounding executions;
- public grounding allowances with an exact reset, shared pool, and compatible target rate unit.

Excluded:

- explicit cache storage and File Search stores or indexing;
- tuning and training;
- provisioned capacity, subscriptions, commitments, credits, balance, tax, private discounts,
  invoices, and settlement;
- managed-agent environments and aggregate agent formulas that only restate underlying model and
  tool usage.

Retrieved File Search or URL content and Code Execution content are charged through ordinary model
input/output usage. They do not receive duplicate zero-price or formula-only offers. Agent IDs remain
catalog models when officially callable; without an independent public rate their pricing stays
unknown.

## Sources and refresh isolation

`gemini-models` starts at the official model index and follows official model cards. Fixed
first-party companions provide lifecycle, changelog, Gemma identity, and Interactions routes. This
source owns model identity and does not depend on the pricing page.

`gemini-pricing` independently reads the official pricing page. It is optional and non-exhaustive:
a failure retains the last verified Gemini pricebook without rejecting fresh model identity. Its
optional claim-local Discovery document verifies GenerateContent, embedding, and Batch result
fields used by charge bindings. The first-party Interactions API reference independently supplies
Interactions usage and grounding counters, the GenerateContent Batch and Embeddings API references
establish the response-file JSONL item types, and the video-generation guide supplies Veo request
duration, resolution, and audio selectors. A missing or incompatible field removes only that exact
input mapping; rates, sibling mappings, and model identity still refresh.

The authenticated `/v1beta/models` source is an optional account-scoped inventory overlay enabled
by `GEMINI_API_KEY`. It enriches existing public rows and never creates the global catalog.

All collection is deterministic and non-LLM. Exact model IDs or one unique documented alias bind
price rows. An unknown model, meter, unit, or table shape affects only that claim and is reported as
unbound/raw; it cannot create a model or reject recognized siblings. A missing price never removes a
valid model.

## Canonical pricing

Each model book has up to two offers:

- `sync` — online inference. Standard, Flex, and Priority are realized service-tier variants because
  the response reports the tier actually served.
- `batch` — asynchronous Batch inference. Successful result items carry their own model usage.

Sync and Batch are already alternative offers and therefore need no `exclusive_with` relations.
Search and Maps are shared provider-service books. Each exact compatible model has an offer with a
`compatible_with` relation to its online inference offer; the relation expresses composition, not
entitlement or settlement.

`Free Tier` and `Paid Tier` are account-eligibility dimensions. Only an exact official `Free of
charge` cell becomes a zero rate. Standard/Flex/Priority and Batch remain execution dimensions. An
adjacent per-image or per-minute amount is treated as a usage equivalence when the same cell already
publishes a primary token price; it is not a second charge. When a paid cell publishes successive
`through` and `starting` prices, those dates remain applicability boundaries; the adjacent undated
Free Tier cell remains continuous rather than inheriting the paid schedule.

Gemini 3 Search is priced per executed search query. The same monthly Search allowance cell also
establishes Robotics membership in that shared pool; a model-name prefix does not override the cell.
Older Search rows are priced per grounded prompt. Maps' independent grounding guide establishes
one billable request when at least one Maps result is returned, regardless of internal query count.
That exact companion claim resolves the Maps pricing table's mixed prompts/requests/search-query
wording. It is a billing-unit clarification, not an assumed prompt-to-query multiplier.
An explicitly shared Gemini 3 monthly free-search allowance is one quantity benefit targeting all
documented compatible rate terms in that service book. The Gemini 2.5 Flash/Flash-Lite daily shared
grounding allowance likewise has one pool, and an unshared daily RPD allowance targets its own
model's rate. Search and Maps have separate service pools. These allowances use the published
amount and daily/monthly reset; they do not create a fresh allowance for each model or each
request. Consumers supply the remaining shared quota and apply it once across the target terms.

Allowance normalization requires a compatible billing unit. The Maps monthly prompt/request
allowance targets the request-based Maps rate only while the independent guide establishes that
unit. If that companion is absent or its contract changes, the ambiguous Maps allowance stays raw.
Unknown sharing rules and disagreeing quantities within one stated pool also stay raw while the
known overage rate remains usable. An allowance's unavailable runtime counter does not invalidate
its published quantity, scope, reset, or rate.

## Charge bindings

Bindings reference independently collected first-party request, response, stream, and result fields
rather than invented normalized provider keys:

- uncached input by modality is prompt/input modality tokens minus the matching cached partition;
- document input and cache tokens are added to image tokens because Gemini prices document tokens
  at the image rate;
- cache read uses the matching cache modality partition;
- text output is candidate/output tokens plus thinking tokens, because the published output rate
  includes thinking; aggregate candidate tokens are a fallback only when the offer has no separate
  non-text output rate;
- non-text output uses the response modality partition;
- embedding input uses the matching `EmbeddingUsageMetadata.promptTokenDetails` modality; document
  embeddings are added to the image-rate quantity;
- generated-image rates count only image-MIME inline output parts;
- Veo per-second rates use explicit `GenerateVideosConfig.durationSeconds` once per successful
  generated-video result item; resolution and generated-audio applicability come from the same
  request configuration;
- online service tier uses `UsageMetadata.serviceTier`;
- Interactions Search/Maps use `usage.grounding_tool_count` filtered by tool type;
- GenerateContent Search query pricing counts unique non-empty
  `groundingMetadata.webSearchQueries`; older Search request pricing and Maps grounded-prompt pricing
  use their respective successful grounded-result marker.

Batch locators refer only to each successful inline/file result's contained GenerateContent or
embedding response, never Interactions usage or the job submission count. A rate whose denominator
has no exact documented request/result quantity remains unbound; publishing a rate does not require
fabricating observability. In particular, GenerateContent does not expose an exact Maps query count,
and a Veo request that omits `durationSeconds` has no exact duration input mapping. Known modality
subtraction, document/image sums, and output/thinking sums remain alongside surviving locators if
an accounting field drifts. The caller must supply unmapped required signals. Stream interruption
and usage retention policy remain downstream runtime concerns.

## Lifecycle and identity

Model cards own current callable IDs, aliases, modalities, limits, capabilities, and release stage.
Lifecycle rows may add historical or deprecated IDs with exact dates and replacements. Changelog
dates require an exact code in a dated release item. Interactions endpoints require an exact row in
the official supported-model table and the reviewed create route.

The model catalog, pricing page, Discovery schema, and authenticated inventory have independent
freshness. Drift in one surface must not erase independently verified facts from another.
