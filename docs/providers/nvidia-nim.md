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

The inventory establishes exact shared-endpoint identifiers. An optional supplement prefers
the public JSON APIs used by [NVIDIA Build](https://build.nvidia.com/models):

- `https://api.ngc.nvidia.com/v2/search/catalog/resources/ENDPOINT` discovers the full
  bounded endpoint catalog through zero-based pages. The query scopes NVIDIA's public
  `qc69jvmznzxy` namespace in `query`; putting `orgName` in `filters` does not enforce that
  scope. Check the namespace again in every returned resource. Follow the `ENDPOINT` group,
  rather than double-counting its duplicate `_scored` group. Validate page sizes, totals,
  unique resources and the final page.
- `https://api.ngc.nvidia.com/v2/endpoints/qc69jvmznzxy/{name}` owns typed endpoint
  identity, public visibility, publisher, labels and metadata. Its `/spec` companion owns
  JSON-encoded attributes, OpenAPI and NVIDIA's public function addressing. These endpoints
  work anonymously; no customer function inventory or credential is collected.

Fetch exact shared-inventory candidates plus current catalog entries labeled `nim_type_preview`.
Partner-only and download-only entries do not establish NVIDIA-hosted service. A profile
requires the matching publisher/name and specification owner. For shared operations, the
schema's literal model default, example or unique enum establishes the request ID, including
when it differs from the endpoint's page slug. For independently addressed REST products,
retain the typed endpoint identity and its exact owned inference path. Exclude management
operations. Known inventory IDs can join fixed routes only through an exact path boundary.

Public preview entries can also establish hosted NVCF access through the matching
`nvcfFunctionId` and inference path. The [NVCF invocation reference](https://docs.api.nvidia.com/cloud-functions/reference/invokefunctionstreaming_2)
owns the HTTP function route. Explicit gRPC usage must name `grpc.nvcf.nvidia.com:443`
and the function-ID template; a `/grpc` path alone never becomes an HTTP invocation claim.
The hosted CLI's explicit video/audio/image input flags can establish input modalities;
unknown payloads and output types remain unknown. These records use typed endpoint catalog IDs, which are not generic `model` values for
`integrate.api.nvidia.com`. The current endpoint projection does not publish a separate
gRPC function-header recipe. No global alias is inferred from a function UUID.

The supplement reads names, descriptions, publisher, model-card update dates, context,
modalities, capabilities and deprecation from those exact profiles. Specs can be several
megabytes, so allow up to 4 MiB per specification or HTML fallback, with a 48 MiB aggregate
bound, at most 180 endpoint profiles and eight concurrent profile fetches. An unavailable
JSON profile falls back to its bounded [public model card](https://build.nvidia.com/models).
HTML fallback enriches exact shared-inventory IDs; it does not create identities from a
page slug. A missing companion is claim-scoped and leaves the shared inventory usable.

Unknown or absent SDK fields do not become model facts. In particular, an empty NVCF
function ID does not invalidate an independently evidenced shared request, and an unused
compatibility parameter supplies no dimension limit. Local-only specifications require
independent public NVCF evidence before establishing a hosted product. Unavailable or
deprecated profiles do not create new hosted records. New modalities and tasks remain
unknown when the owning profile does not publish them; do not infer them from a model name.

The optional [Retrieval API registry](https://docs.api.nvidia.com/nim/reference/retrieval-apis)
can admit models outside the shared inventory. A listed request must name the exact model
in the linked OpenAPI definition and use a reviewed NVIDIA hosted retrieval or embedding
route. Record the separate retrieval host explicitly. Published request schemas can supply
modalities, maximum input sizes and supported embedding dimension ranges. An ignored or
deprecated API compatibility parameter supplies no dimension limit. Local-only specs and
model page slugs alone do not establish a hosted request identifier.

The catalog scope remains non-exhaustive for partner services, downloadable artifacts and
profiles whose identity or invocation cannot be qualified. Review the LLM, retrieval,
visual, multimodal, healthcare, route-optimization and climate registries as adjacent
discovery surfaces; old operation pages alone do not override a current unavailable or
deprecated product. Account access and release dates remain unknown without corresponding
model-specific evidence.

This is a catalog-only provider. The API's `Free Endpoint` label is a prototype-access
label, not an unconditional zero unit price. The [current FAQ](https://docs.api.nvidia.com/nim/docs/product)
distinguishes developer access from production licensing. Self-hosted GPU licensing rates
do not establish a rate for these hosted models. The
[Triton repository index](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/protocol/extension_model_repository.html)
reports models configured on an individual Triton deployment, outside the hosted NIM scope.
