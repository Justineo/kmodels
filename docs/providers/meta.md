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

The price book binds caller-supplied billable quantities. It does not currently publish extraction
formulas for all Model API response protocols. In particular, callers must supply uncached and
cached input separately, floored audio seconds, and minimum-adjusted video frames. Country access
restrictions describe availability. A regional tariff requires separate commercial evidence.
