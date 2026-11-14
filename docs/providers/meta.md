# Meta

Status: current

## Offer boundary

[Shared ownership rules](../commercial-topology.md#offers-and-dimensions) govern this provider.

Keep exact Standard and Contributor hosted model identities. Contributor data-use obligations are explicit facts of that separately identified subject, not an inferred tier alias. Each admitted subject retains its public usage relationship. Image/frame/audio quantities and streaming/file behavior qualify terms. Text web search remains independent of included image-model search. Muse Code subscriptions and partner deployments remain excluded.

The source authorities and evidence limits below remain authoritative. Adapter keys such as
`sync`, `batch`, `usage`, and operation/model-specific labels describe extraction contexts;
`source_contexts` binds them to the published relationship and its conditions. They are not
additional user-selectable agreements. Migration preserves monetary facts, conditional accounting,
source revisions and independently charged subjects.

## Boundary

The `meta` provider publishes models hosted on Meta Model API under the display name Meta.
The public Models page supplies exact callable IDs. Downloadable weights and Muse Code
subscription-only variants fall outside this catalog. Partner-operated Llama deployments
belong to the providers that operate them.

## Hosted pricing

The public [Models](https://dev.meta.ai/docs/models) overview establishes hosted media IDs.
The [Muse Wonder](https://dev.meta.ai/docs/muse-wonder#availability) and
[Muse Spark](https://dev.meta.ai/docs/muse-spark#availability) model pages own the exact hosted
reasoning IDs and modes. The [Pricing and rate limits](https://dev.meta.ai/docs/pricing-rate-limits)
page independently owns tariffs. The `meta-model-api` source reads these four public HTML
documents without authentication. Each document must expose exactly one main landmark; the parser
accepts the current `<main>` element and the historical `role="main"` region, and a missing or
duplicated landmark rejects the source for review.

- Muse Wonder and Muse Spark publish cached input, uncached input and output token prices.
  Standard and Contributor are distinct literal request IDs. The model availability row and the
  pricing declaration must agree on the mode; a `-contributor` suffix alone establishes nothing.
  Contributor mode permits Meta to use submitted content and responses to train future models.
  This distinction is described on the model, rather than exposed as a redundant price selector.
  The pricing tables may order the two mode columns either way; each rate is read from the column
  header that names its mode, never from a fixed position.
- Muse Ember publishes Standard-mode cached input, uncached input and output token prices in two
  input-token tiers. A request with up to 200,000 input tokens pays the first column; a request
  above that pays the long-context column in full. The tiers become `context_max_tokens` and
  `context_min_tokens` conditions rather than separate model rows, so the caller's context-token
  selector chooses the rate. The Models overview table and the pricing declaration must agree on
  the exact ID and its Standard-only scope.
- Muse Image is priced per successfully generated and returned image. Failed or safety-filtered
  images do not count. Built-in search is included; response token counts do not add token charges.
- Muse Voice Transcribe is priced per hour of processed audio, rounded down to whole seconds.
  Streaming and file transcription have the same price. Zero data retention has no premium.
- SAM 3.1 has separate per-image and per-video-frame rates. Video quantities are already-billed
  frames, including the 50-frame request minimum, rather than the raw clip's frame count.
  The model description exposes this minimum in the website; the unit price alone is insufficient.
- Text-model web search is an independent service rate per 1,000 queries. It is not attached to
  an arbitrary model row and is not part of Muse Image's separately included search.

The parser emits exact-ID associations to the existing canonical model usage offers. All numbers
come from the current tables; no rate is inferred from a related family, partner, prefix or amount.
The website and portable lookup share these associations. An absent price declaration withdraws
that ID's association while preserving the independent catalog identity. An unknown pricing mode,
unit, duplicate media meter, new unreviewed hosted line or changed accounting rule rejects the
source for review. Association evidence links to the owning availability or overview section
and the Model pricing heading. The rate observations link to their individual pricing sections.

## Discovery and model metadata

The complete first-party `llms.txt` index supplies the model, API, billing and feature references.
The documented Models API exposes only ID, owner, registry creation time and optional client-specific
metadata. It has no tariff, modality, capability or model-limit fields. `MODEL_API_KEY` is its native
credential name; without a configured key, its authentication failure cannot establish account
availability. Registry creation time is not a model release date. The public hosted inventory and
owned model pages remain the global authority, and open-weight Muse Spark Open and Muse Glimmer
do not become Model API rows.

Model metadata is read from the overview's exact-ID tables and the owned Wonder, Spark and Ember
`At a glance` sections. It includes tasks, modalities, context and output limits, declared endpoints
and positive use-case capabilities. Optional Ember acquisition and malformed individual fields do
not reject unrelated identity or tariffs. Version-qualified effort ranges stay with the named ID;
the Spark 1.3 range does not establish effort support for older or Contributor IDs. Spark's own
versions section warns of degraded audio understanding on 1.3; listing an accepted audio input
does not claim equal quality across versions. Unstated capabilities and release dates stay unknown.

## Usage contracts

Optional first-party endpoint Markdown and typed schemas own accounting fields independently of
prices. Response ownership follows the HTTP 200 JSON type or the SSE wire union, then the terminal
event and usage object. An unrelated schema or code example cannot establish a response counter.
Missing, duplicate or malformed companions withhold only their dependent mappings.

- Responses and Chat Completions expose total input, cached input and output counts for synchronous
  responses and complete terminal events. The caching guide explicitly defines cached tokens as a
  subset of total input. Uncached input therefore subtracts cached input, floored at zero. A
  missing locator does not erase the known calculation or surviving locators; the caller supplies
  an unmapped signal. Optional or absent fields do not imply zero. Messages usage is not assigned
  either protocol's partition without its own semantic evidence.
- SAM's typed Responses usage owns `images_processed` and `video_frames_processed`, including the
  latter's already-billed 50-frame minimum. Synchronous and terminal SSE mappings use these counters
  directly; raw video frame count does not substitute for the billed quantity.
- The Images endpoints return an `ImagesResponse.data` array of generated images. Its length
  supplies the successful returned-image quantity. Partial image events and token-usage fields do
  not add image or token charges. Conversational Responses image counting remains caller-owned
  because its output array mixes item types.
- Voice transcription retains caller-supplied whole audio seconds. The native duration fields
  report milliseconds, including cumulative streaming progress; dividing by 1,000 alone would
  violate the published round-down rule. No such locator is advertised as billable seconds.
- Text web search remains per billed query. A tool invocation or the number of search results
  cannot substitute for a complete billable-query count.

Ember's 200K condition remains caller-owned. Responses `input_tokens` can exclude reconstructed
stored history or accumulate adjusted usage over hosted-tool iterations, so it cannot establish
the model context used for the pricing tier. The preflight token-count API measures rendered
context, not billed usage; no unused endpoint dependency is added. Country access restrictions
describe availability, and a regional tariff requires separate commercial evidence.
