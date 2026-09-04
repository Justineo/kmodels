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
- independently priced Google Search and Google Maps grounding executions.

Excluded:

- explicit cache storage and File Search stores or indexing;
- tuning and training;
- provisioned capacity, subscriptions, commitments, credits, allowances, balance, tax, discounts,
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

Gemini 3 Search and Maps are priced per executed query. Gemini 2.5 and older rows are priced per
grounded prompt. The source unit is retained exactly; no cross-generation conversion is inferred.
Account-period free-query allowances are outside the gateway pricebook.

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
and a Veo request that omits `durationSeconds` has no exact duration input mapping. Stream interruption
and usage retention policy remain downstream runtime concerns.

## Lifecycle and identity

Model cards own current callable IDs, aliases, modalities, limits, capabilities, and release stage.
Lifecycle rows may add historical or deprecated IDs with exact dates and replacements. Changelog
dates require an exact code in a dated release item. Interactions endpoints require an exact row in
the official supported-model table and the reviewed create route.

The model catalog, pricing page, Discovery schema, and authenticated inventory have independent
freshness. Drift in one surface must not erase independently verified facts from another.
