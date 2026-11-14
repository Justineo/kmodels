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
