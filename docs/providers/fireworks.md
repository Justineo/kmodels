# Fireworks AI

Status: implemented

## Offer boundary

[Shared ownership rules](../commercial-topology.md#offers-and-dimensions) govern this provider.

Keep one public Serverless relationship per admitted exact model ID. Standard/Priority are service-tier conditions. Fast, Ultra-fast, US-only and Spot retain independently evidenced request identities; identity differences do not imply another customer contract. A Standard retry is another request. Unpriced routes stay unknown; dedicated and negotiated products remain outside this source scope.

The source authorities and evidence limits below remain authoritative. Adapter keys such as
`sync`, `batch`, `usage`, and operation/model-specific labels describe extraction contexts;
`source_contexts` binds them to the published relationship and its conditions. They are not
additional user-selectable agreements. Migration preserves monetary facts, conditional accounting,
source revisions and independently charged subjects.

The [public Model Library](https://fireworks.ai/models) provides Serverless admission. Read its
structured listing and crawl only the bounded same-host model cards with both Serverless flags.
Each card must publish its canonical link, exact model path and Serverless offering. The
publisher in a website slug can differ from the account in the API identifier. Read the
publisher from the structured listing and the description from the matching card. The
[media guide](https://docs.fireworks.ai/guides/video-audio-inputs) supplies video input for
its exact documented Serverless ID. The collection requires no account credential.

The anonymous [model console](https://app.fireworks.ai/models/fireworks/glm-5p3) is a
required price companion for every admitted library card. Its server-rendered price widget
publishes typed Serverless modes, exact invocation recipes and SKU amounts. Follow only the
card's literal API identity, with bounded profiles, bytes and concurrency. Read genuine React
Flight element properties, skip byte-counted text records, and validate each mode's owner.
`usageIdentifier` supplies the literal request ID; an empty value means the card's model ID.
`serviceTier` supplies the request flag. Do not infer router IDs from suffixes or admit
unrendered aliases. Preserve independently documented IDs and tariffs when a console mode
is omitted. A required profile failure rejects the fresh price partition.

The [List Models API schema](https://docs.fireworks.ai/api-reference/list-models) documents
that `ServerlessMode.skuInfos` is populated live from billing by `ListServerlessModels`,
rather than by ordinary List Models. The native
[Gateway OpenAPI](https://docs.fireworks.ai/gateway.openapi.yaml), linked by the documentation
index, owns `GET https://api.fireworks.ai/v1/accounts/{account_id}/serverlessModels`.
It returns base models with nested priced, Spot-gated configurations, accepts `pageSize`
up to 200, and paginates with `pageToken` and `nextPageToken`. The schema requires a bearer
API key. The collector-transport probe of the exact `fireworks` account route returns HTTP 401
without one, as do the ordinary management and inference inventories. This is an access
limit, not evidence that the API lacks prices or that the public catalog is empty.
The anonymous console exposes the consumed mode prices without credentials, so collection
uses that first-party structured fallback. A future authenticated inventory must preserve
account-specific mode gates rather than turning them into global exclusions. API field
definitions establish the invocation recipe; public library flags and exact cards establish
Serverless admission.

Normalize USD `1M tokens` SKU amounts from exact Money units and nanos, including Flight's
`$n` integer encoding. Input, cached input, output and retrieval-input labels own their
respective meters. Keep unknown units or SKU labels as scoped raw evidence; an empty price
list is not a free rate. Console prices can supply missing Priority rates and separately
invoked Spot or decision routers. Preserve conflicting positive quotes for shared conflict
resolution. System One decision routes never produce output tokens: their zero output SKU
is non-applicable. Copy the evidenced decision endpoint to its literal router identity.

A tariff row alone does not establish hosted availability. The price book currently lists
`accounts/fireworks/models/gpt-oss-120b` and
`accounts/fireworks/models/nemotron-3-ultra-nvfp4`, while the library explicitly disables
both Serverless flags and their console pages offer Dedicated only. Retain these as unbound
price reconciliation findings; do not create active Serverless records from those rows.

The [Serverless price book](https://docs.fireworks.ai/serverless/pricing) supplies exact
Standard and Priority rates. Priority is a service-tier selector for the same identifier.
Fast, Ultra-fast and US-only variants with a distinct ID require an exact match in the
[mode](https://docs.fireworks.ai/serverless/serverless-modes) or
[US-only](https://docs.fireworks.ai/serverless/us-only-serverless) route table and keep their
own model records even when pricing is absent. The route-table heading is matched
case-insensitively because the provider controls its casing and changed
`Ultra-fast (Preview)` to `Ultra-fast (preview)`; the published IDs and price labels stay
exact. A price row without a matching card or router is a
reconciliation finding. For other admitted cards, the labeled Serverless price panel
supplies rates when the meter and unit are explicit. A retrieval model publishes no output
tokens, so its card rate is the input rate whether the panel labels the unit
`Per 1M Tokens` or `Per 1M Tokens (input/cached input/output)`; a text-generation panel with an
unqualified per-token unit stays raw because input and output are indistinguishable there.
Other ambiguous units or meters stay raw. Exact API IDs bind these offers through the shared
inference-price lookup.

Every model with numeric price facts reports numeric pricing. A model record whose rate is not
published, such as a Fast, Ultra-fast or US-only route without its own price row, stays unknown
rather than borrowing the base model's rate.

The [Spot guide](https://docs.fireworks.ai/guides/spot-serverless) owns Spot identifiers and
their token rates. A Spot ID has a separate model record and rate. A retry using the Standard
ID is a separate request with its own rate.

The [embedding guide](https://docs.fireworks.ai/guides/querying-embeddings-models) publishes
callable legacy embeddings absent from the library. Admit the literal request IDs from the
legacy table and retain the published native dimensions. Join each parameter count to the
reviewed embedding band in the Serverless price book. The Qwen3 embedding and reranking
tables bind a documented short Serverless request ID when both links identify the same
admitted model. General parameter-bucket fallbacks, Batch, dedicated capacity and account
terms are outside this non-exhaustive contract.
