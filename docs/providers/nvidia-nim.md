# NVIDIA NIM

Status: implemented

## Offer boundary

[Shared ownership rules](../commercial-topology.md#offers-and-dimensions) govern this provider.

This provider remains catalog-only. Hosted inventory and API credentials establish callable identities, not a public per-model rate or enrollment contract. Developer-program access and self-hosted enterprise licensing do not create priced offers for the admitted hosted inventory. No synthetic free, Batch or subscription offer is introduced.

The source authorities and evidence limits below remain authoritative. This catalog-only provider
has no admitted price partition or source offer contexts to migrate.

Kmodels covers the public model-ID inventory from NVIDIA's hosted
[`GET /v1/models`](https://integrate.api.nvidia.com/v1/models). This is the inventory of the
shared endpoint, which can be collected without a key. The
[NVIDIA API Catalog quickstart](https://docs.api.nvidia.com/nim/docs/api-quickstart)
describes the hosted service and its invocation credentials.

The inventory establishes exact model identifiers. An optional overlay reads the
[public NVIDIA Build model cards](https://build.nvidia.com/models) for those IDs. An exact
card identity supplies published names, descriptions, model-card update dates, context
length, modalities, capabilities and deprecation when present. Alternate page slugs are
accepted only when the card's hosted request schema names the original model ID.
That schema establishes supported request paths when the card does not report an
unavailable or deprecated endpoint. A missing or changed card leaves the inventory usable.

The optional [Retrieval API registry](https://docs.api.nvidia.com/nim/reference/retrieval-apis)
can admit models outside the shared inventory. A listed request must name the exact model
in the linked OpenAPI definition and use a reviewed NVIDIA hosted retrieval or embedding
route. Record the separate retrieval host explicitly. Published request schemas can supply
modalities, maximum input sizes and supported embedding dimension ranges. An ignored or
deprecated API compatibility parameter supplies no dimension limit. Local-only specs and
model page slugs alone do not establish a hosted request identifier.

The catalog scope is non-exhaustive because NVIDIA Build also covers other endpoint
families, partner endpoints and downloadable artifacts. Account access and release dates
remain unknown without corresponding model-specific evidence.

This is a catalog-only provider. NVIDIA's developer program and self-hosted enterprise
licensing do not establish a per-model rate for this inventory. The
[Triton repository index](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/protocol/extension_model_repository.html)
reports models configured on an individual Triton deployment, outside the hosted NIM scope.
