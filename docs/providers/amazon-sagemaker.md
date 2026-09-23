# Amazon SageMaker AI

Status: implemented; source research and access verification 2026-09-23

## Catalog boundary

`amazon-sagemaker` is a separate cloud-platform provider from Amazon Bedrock. Its public
identities are JumpStart model IDs, not endpoint names, Marketplace listing IDs, model-package
ARNs, or upstream Hugging Face repository names.

Admission starts with the **Open-weight models** and **Proprietary models** sections of
AWS's [foundation-model catalog](https://docs.aws.amazon.com/sagemaker/latest/dg/jumpstart-foundation-models-latest.html).
Built-in pretrained models and classic ML algorithms are excluded before metadata or pricing
joins. The source is global and non-exhaustive: its tables are a dated publication rather than
a guarantee of every currently deployable model. At research time the two admitted sections
contained 436 and 121 entries; these counts are observations, not permanent assertions.
The parser checks each live section's own advertised row count, required headers, and identity
uniqueness. Section/header drift and partial tables fail the source.

The required `sagemaker-sdk` supplement joins the current
[open-model manifest](https://jumpstart-cache-prod-us-west-2.s3.us-west-2.amazonaws.com/models_manifest.json)
and proprietary SDK manifest by exact JumpStart ID. It keeps the table's admitted IDs and also
admits current non-deprecated open specs explicitly tagged `Foundation Models`. New proprietary
IDs require the same foundation marker or the explicit `Text` + `Generation` category pair in
their latest manifest record. `Open Weights` alone is not admission evidence: the Hub also uses
that classification for classic ML. Version selection uses the SDK's PEP 440/lexical resolver,
before applying admission, so an older eligible version cannot bypass a latest-version exclusion.
Paths and fetched model/version identities are checked before projection. A public manifest is
global product evidence; the optional regional API still cannot introduce global catalog IDs.

The catalog supplies exact IDs, display names, tasks, and explicit fine-tuning flags. Tasks use
reviewed source labels, not name-based guesses. Forecasting, scientific modelling and ambiguous
task labels retain their source type without inventing a canonical task. Public table rows are
unversioned; package revisions are not upstream model releases. No default context window,
streaming, token accounting, GA status, release date, or account access is inferred.

Six exact task conflicts are reviewed against publisher product descriptions: the three Bria
2.2HD/2.3/2.3Fast IDs carry erroneous `ReRank` labels, and Cohere Rerank v3.5/v4.0 Fast/v4.0 Pro
carry erroneous `Text Embedding` labels. Correct only those exact ID/label pairs to image
generation and reranking respectively, preserving the original label under a reviewed evidence
namespace. Evidence: [Bria 2.2HD](https://aws.amazon.com/marketplace/pp/prodview-2pbgsqtuvobbq),
[Bria 2.3](https://aws.amazon.com/marketplace/pp/prodview-man54dmpkarki),
[Bria 2.3Fast](https://aws.amazon.com/marketplace/pp/prodview-qwwlgkbtm2bsq),
[Cohere model catalog](https://docs.cohere.com/docs/models), and
[Cohere SageMaker setup](https://docs.cohere.com/v1/docs/amazon-sagemaker-setup-guide).
No prefix or model-name guessing applies to other IDs.

## Model information and deployment configurations

Public specs supply modalities (including `Embeddings` → `embedding`), explicit fine-tuning,
publisher, license, model-size and context-window labels, languages, upstream Hugging Face ID,
access and framework. Package deployment data retains default and named components, supported
instances, serving framework versions and configuration/component associations. A context-setting
allowlist retains only numeric context controls and their profile/instance selectors; model paths,
tokens, arbitrary environment values, image URIs and resource ARNs are discarded. Empty/null
defaults and absent variant maps mean no published fact. Defaults and overrides are not collapsed.
An SDK version can itself be a resource ARN. It may participate in the in-memory exact spec join,
but is omitted from the public package-version label; it is never published in model details or
refresh diagnostics. Its dependency key remains a hash.
Benchmarks and config rankings are not capability guarantees and are not currently normalized.

The source bucket is `us-west-2`, which labels the published configuration, not global or account
availability. Package revisions do not populate model `version` or release dates. Ranges such as
`<4K` remain labels instead of becoming exact `limits.context_tokens`. Metadata and deployment
profiles appear in the inspector's deferred, byte-bounded detail chunks, not the homepage core.

The 2026-09-23 accepted snapshot contains 624 models, including 617 with nonempty supported
instance lists in their published deployment profiles. It contains 452 modality records, 502
publisher labels, 382 licenses, 318 size labels, 175 context ranges, 347 language lists, 414
upstream IDs, and 2,379 deployment profiles. These are dated observations, not exhaustiveness
claims or test thresholds. The accepted Hub enrichment completed 604 detail reads; absence from
this Region's Hub does not retire globally admitted IDs. All four SageMaker sources succeeded.

## Optional regional API

The collector reuses the AWS credentials already configured for Bedrock. Its optional-source
gate requires `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`; temporary credentials can also
provide `AWS_SESSION_TOKEN`. The transport uses the AWS SDK credential chain and SigV4 signing;
a profile alone does not satisfy the collector's current environment gate. No separate API key
is needed. `ListHubContents` paginates `SageMakerPublicHub` / `Model`; `DescribeHubContent`
reads the exact returned version, only for models already admitted by the public tables or SDK
manifest rules.
The configured enrichment Region is `us-west-2`. A read-only access probe succeeded for
`ListHubContents`, `DescribeHubContent`, and `ListHubContentVersions` in both `us-west-2` and
`us-east-1` after the user's IAM update. Historical-version permission is available but is not
needed by routine collection.

The API fills display names, descriptions, missing model-card facts, modalities and explicit
fine-tuning support. A positive
`(region, jumpstart-endpoint)` pair requires `Available`, `Supported`, and a nonempty supported
inference-instance list in the same model response. This is regional route evidence, not a
guarantee of account entitlement, subscription, quota, or capacity. Restricted/deprecated hub
content does not create positive availability or overwrite the global model lifecycle.
Absence from one Region does not delete a global model.

Only a bounded metadata projection leaves the API transport. Account/resource ARNs, package
locations, dependencies, training data, container paths, payload samples, and raw authenticated
documents are discarded. Requests have deadlines, bounded concurrency, page limits, repeated-token
checks and adaptive SDK retries. Calls start at least one second apart, use at most two concurrent
detail requests, and allow 90 seconds for each request including SDK retry waits. A full successful
source requires every selected detail; a throttled/aborted source is never published as complete.
Public S3 spec reads reuse native HTTP connections with the same host, redirect, response-size and
retry boundaries as other sources. API failure does not prevent independent public catalog/pricing collection.

Official API references:
[ListHubContents](https://docs.aws.amazon.com/sagemaker/latest/APIReference/API_ListHubContents.html),
[DescribeHubContent](https://docs.aws.amazon.com/sagemaker/latest/APIReference/API_DescribeHubContent.html),
[ListHubContentVersions](https://docs.aws.amazon.com/sagemaker/latest/APIReference/API_ListHubContentVersions.html),
and [IAM actions](https://docs.aws.amazon.com/service-authorization/latest/reference/list_sagemaker.html).
No create, deploy, invoke, pass-role or Marketplace subscription permission is required.

## Public pricing discovery

The Pricebook combines two public, independently auditable sources:

- The [AmazonSageMaker bulk price list](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonSageMaker/current/index.json)
  supplies current regional service rates. Its approximately 71 MB research response is bounded
  separately from the assembled bundle. Collection reads all published Regions, not just the
  authenticated enrichment Region.
- The official [proprietary SDK manifest](https://jumpstart-cache-prod-us-west-2.s3.us-west-2.amazonaws.com/proprietary-sdk-manifest.json)
  and exact model specs provide Marketplace listing IDs for admitted proprietary models.
  Current public Marketplace SSR pricing queries supply structured usage rate cards. Marketing
  text, throughput examples and token-price estimates are not rate cards.

AWS publishes its bucket configuration in the
[SDK region configuration](https://github.com/aws/sagemaker-python-sdk/blob/800d3423f3869c0770ff292ef9cb98cc0ee4b8b1/sagemaker-core/src/sagemaker/core/jumpstart/region_config.json).
Spec discovery mirrors the SDK's
[`get_latest_version` resolver](https://github.com/aws/sagemaker-python-sdk/blob/800d3423f3869c0770ff292ef9cb98cc0ee4b8b1/sagemaker-core/src/sagemaker/core/jumpstart/utils.py):
PEP 440 comparison when every version is valid, otherwise lexical maximum. Package versions are
not uniformly SemVer. This selection discovers the current package metadata and listing link;
it does not publish a globally preferred model release version. Deployment facts remain package-scoped.
Duplicate exact manifest records are deduplicated, paths must match their exact model/version,
and fetched specs must repeat both identities. URL components are encoded; provenance uses a
version hash rather than copying arbitrary package labels into dependency keys.

Marketplace extraction verifies the route/listing identity and selects only the exact `Pricing`
query. Unrelated page session/agreement fields are discarded. A page with no public pricing query
is an explicit unresolved coverage item, never a free/no-offer claim. Malformed known pricing
queries, ambiguous joins, truncated rate-card arrays, or incomplete dependency bundles fail the
pricing source. Known sibling rates survive unfamiliar supported-family price cells as bounded
raw facts. The shared collector retains an accepted provider pricing snapshot on source failure.

The 2026-09-23 accepted price snapshot has 404 books: 298 real-time hosting instance books, 101
Marketplace hourly software books, two service books, and three model books for Marketplace
per-inference software. It recognized 4,003 AWS hosting SKUs, 324 infrastructure invocation SKUs,
652 Marketplace hourly cards, and three per-inference cards; 20 listing pages had no public
pricing. These are dated coverage observations, not tests against volatile upstream counts or
proof that every model has a complete inference bill.
Exact SDK instance lists link hosting capacity to 617 models. Five Nova package records have
empty supported-instance lists and no public per-inference rate, so the website shows only
separate service charges for them instead of guessing a hosting SKU.

## Inference and hosting charges

| Charge                                                                  | Pricebook treatment                                                                     |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Hosting input/output data processing                                    | Separate `input_data` and `output_data` meters, with exact Region and SKU evidence.     |
| Serverless execution                                                    | Per-second rate by Region, memory size, and execution tier; reserved capacity excluded. |
| Marketplace real-time per-inference software                            | Model offer joined by exact listing ID; software only.                                  |
| Real-time hosting instance hours                                        | Capacity book per instance type, with Region-qualified AWS infrastructure rates.        |
| Marketplace real-time instance-hour software                            | Separate capacity book joined by exact listing ID and instance selector.                |
| Other capacity, training, notebook, storage, and ML services            | Excluded; no amortization into token/request prices.                                    |
| Subscriptions, upfront contracts, free trials, and negotiated discounts | Excluded.                                                                               |

Endpoint data processing is a shared service book linked to admitted models. It is a separate
service charge, not an optional discount or a complete endpoint bill. Serverless execution
is a standalone service book with no blanket model references: AWS excludes GPU and Marketplace
model-package deployments from Serverless. Its presence must not assert support for all JumpStart
models. Marketplace software belongs to each exactly linked model's book, with a real-time
inference offer. It appears under model rates, while request-level infrastructure remains in
service books. A listing shared by multiple model IDs produces a separate book for each model;
unsupported inference rates retain their raw facts in that same model book. The shared
provider snapshot → book → offer → term → variant hierarchy is unchanged.
The pricing bundle uses the same open/proprietary manifest admission rules as the model supplement,
so new SDK-only models also join the shared service book and their exact Marketplace listing.
The assembly layer resolves this ownership from normalized source facts, so `vp run compile:pricing`
can rebuild it offline without refetching AWS or advancing the source verification time.

Rates have exact rational prices and semantic usage bindings. Hosting and Marketplace software
capacity rates use an instance-hour denominator, selected by published instance type and Region
where the source supplies one. AWS hosting and Marketplace software have separate resource-level
billed-instance-time signals, so their billing granularity is not silently equated. Marketplace
software usage is [prorated to the minute](https://docs.aws.amazon.com/marketplace/latest/userguide/machine-learning-pricing.html);
the AWS bulk hosting rate alone does not establish its billing minimum. Neither charge is assigned
to an inference request. The caller supplies **AWS-billed
GB**, **AWS-billed execution seconds**, or **publisher-metered billable inferences**. The catalog
does not equate those quantities with payload length, client wall-clock time or HTTP request
count. AWS's price feed labels data processing `GB` without specifying the byte conversion in
the rate record; it remains a provider unit rather than assuming decimal GB or binary GiB.
Serverless memory size selects a rate and is not itself a metered data quantity.

A zero Marketplace software rate is only a zero software component. Missing model token rates
remain unknown. Service books do not claim a complete total deployment bill, and no capacity
price is marked `not_applicable` as a substitute for missing inference coverage.

AWS's [JumpStart pricing FAQ](https://aws.amazon.com/sagemaker/ai/faqs/) distinguishes publicly
available models, billed for the deployed infrastructure, from proprietary models, which may
also incur publisher software charges. Marketplace software can be priced per running instance
hour or per inference. Instance-hour prices are separate capacity offers and are never converted
into token/request prices. The website presents capacity, per-inference software, and endpoint data
processing as distinct charges. Public regional instance prices do not establish deployment or
account availability.
Consequently a missing model rate does not by itself establish a collection failure or an
unpublished official price. Public listing pages without a usable pricing query remain unresolved
coverage gaps, separately from rates deliberately excluded by this boundary.

Pricing references: [SageMaker AI pricing](https://aws.amazon.com/sagemaker/ai/pricing/),
[Marketplace ML pricing](https://docs.aws.amazon.com/marketplace/latest/userguide/machine-learning-pricing.html),
[Serverless limitations](https://docs.aws.amazon.com/sagemaker/latest/dg/serverless-endpoints.html).

## Invocation and publication

Runtime calls use SigV4 and an account-created endpoint name. The serving container owns the
request/response schema. `InvokeEndpointWithResponseStream` is not evidence that every listed
model supports streaming. A JumpStart ID cannot automatically become a usable Kong target;
downstream configuration still needs an endpoint, Region and any routing selectors.
See [InvokeEndpoint](https://docs.aws.amazon.com/sagemaker/latest/APIReference/API_runtime_InvokeEndpoint.html)
and the [Kong provider reference](https://developer.konghq.com/ai-gateway/ai-providers/sagemaker/).

Registration, fixture validation and read-only live probes do not refresh the accepted `data/`
snapshot. The normal authorized collection publishes the provider and its static projections
atomically. Fixtures cover admission exclusions, source drift, exact joins, pricing gaps,
capacity/training exclusion, billable quantities, pagination and authenticated-data projection.
