# Amazon SageMaker AI

Status: implemented; source research and access verification 2026-09-21

## Catalog boundary

`amazon-sagemaker` is a separate cloud-platform provider from Amazon Bedrock. Its public
identities are JumpStart model IDs, not endpoint names, Marketplace listing IDs, model-package
ARNs, or upstream Hugging Face repository names.

Admission comes only from the **Open-weight models** and **Proprietary models** sections of
AWS's [foundation-model catalog](https://docs.aws.amazon.com/sagemaker/latest/dg/jumpstart-foundation-models-latest.html).
Built-in pretrained models and classic ML algorithms are excluded before metadata or pricing
joins. The source is global and non-exhaustive: its tables are a dated publication rather than
a guarantee of every currently deployable model. At research time the two admitted sections
contained 436 and 121 entries; these counts are observations, not permanent assertions.
The parser checks each live section's own advertised row count, required headers, and identity
uniqueness. Section/header drift and partial tables fail the source.

The catalog supplies exact IDs, display names, tasks, and explicit fine-tuning flags. Tasks use
reviewed source labels, not name-based guesses. Forecasting, scientific modelling and ambiguous
task labels retain their source type without inventing a canonical task. Public table rows are
unversioned; package revisions are not upstream model releases. No default context window,
streaming, token accounting, GA status, release date, or account access is inferred.

## Optional regional API

The collector reuses the AWS credentials already configured for Bedrock. Its optional-source
gate requires `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`; temporary credentials can also
provide `AWS_SESSION_TOKEN`. The transport uses the AWS SDK credential chain and SigV4 signing;
a profile alone does not satisfy the collector's current environment gate. No separate API key
is needed. `ListHubContents` paginates `SageMakerPublicHub` / `Model`; `DescribeHubContent`
reads the exact returned version, only for models already admitted by the public catalog.
The configured enrichment Region is `us-west-2`. A read-only access probe succeeded for
`ListHubContents`, `DescribeHubContent`, and `ListHubContentVersions` in both `us-west-2` and
`us-east-1` after the user's IAM update. Historical-version permission is available but is not
needed by routine collection.

The API enriches modalities and explicit fine-tuning support. A positive
`(region, jumpstart-endpoint)` pair requires `Available`, `Supported`, and a nonempty supported
inference-instance list in the same model response. This is regional route evidence, not a
guarantee of account entitlement, subscription, quota, or capacity. Restricted/deprecated hub
content does not create positive availability or overwrite the global model lifecycle.
Absence from one Region does not delete a global model.

Only a bounded metadata projection leaves the API transport. Account/resource ARNs, package
locations, dependencies, training data, container paths, payload samples, and raw authenticated
documents are discarded. Requests have deadlines, bounded concurrency, page limits, repeated-token
checks and SDK retries. API failure does not prevent independent public catalog/pricing collection.

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
not uniformly SemVer. This selection discovers a listing link only; it does not publish a
globally preferred model version or copy package capabilities into the unversioned model.
Duplicate exact manifest records are deduplicated, paths must match their exact model/version,
and fetched specs must repeat both identities. URL components are encoded; provenance uses a
version hash rather than copying arbitrary package labels into dependency keys.

Marketplace extraction verifies the route/listing identity and selects only the exact `Pricing`
query. Unrelated page session/agreement fields are discarded. A page with no public pricing query
is an explicit unresolved coverage item, never a free/no-offer claim. Malformed known pricing
queries, ambiguous joins, truncated rate-card arrays, or incomplete dependency bundles fail the
pricing source. Known sibling rates survive unfamiliar supported-family price cells as bounded
raw facts. The shared collector retains an accepted provider pricing snapshot on source failure.

The 2026-09-21 public-data probe fetched 245 dependencies and validated a 557-model partition
with five service books: endpoint data processing, Serverless execution, and three Marketplace
per-inference listings. It recognized 324 infrastructure invocation SKUs and three per-inference
cards; 20 listing pages had no public pricing. These are dated coverage observations, not tests
against volatile upstream counts or proof that every model has a complete inference bill.

## Request-cost boundary

| Charge                                                                                                 | Pricebook treatment                                                                                                                                |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hosting input/output data processing                                                                   | Separate `input_data` and `output_data` meters; exact Region and AWS SKU evidence. They are request data processing, not general network transfer. |
| Serverless on-demand execution                                                                         | Per-second rate, selected by Region and 1–6 GB memory configuration.                                                                               |
| Provisioned-concurrency execution duration                                                             | Separate execution tier; does not include reserved concurrency capacity.                                                                           |
| Marketplace real-time per-inference software                                                           | Exact model-to-listing association and public request-denominated rate; software charge remains separate from AWS hosting/data processing.         |
| Instance hosting, GPU/HyperPod capacity, reserved concurrency capacity, Batch Transform instance hours | Excluded; no amortization into token/request prices.                                                                                               |
| Training, fine-tuning, evaluation, notebook, storage and other ML services                             | Excluded, including misleadingly token-denominated evaluation/training SKUs.                                                                       |
| Subscription, upfront contracts, free trials and negotiated discounts                                  | Outside the request-cost catalog.                                                                                                                  |

Endpoint data processing is a shared service book linked to admitted models. Serverless execution
is a standalone service book with no blanket model references: AWS excludes GPU and Marketplace
model-package deployments from Serverless. Its presence must not assert support for all JumpStart
models. Marketplace books link only the exact model IDs whose specs identify that listing.

Rates have exact rational prices and semantic usage bindings. The caller supplies **AWS-billed
GB**, **AWS-billed execution seconds**, or **publisher-metered billable inferences**. The catalog
does not equate those quantities with payload length, client wall-clock time or HTTP request
count. AWS's price feed labels data processing `GB` without specifying the byte conversion in
the rate record; it remains a provider unit rather than assuming decimal GB or binary GiB.
Serverless memory size selects a rate and is not itself a metered data quantity.

A zero Marketplace software rate is only a zero software component. Missing model token rates
remain unknown. Service books do not claim a complete total deployment bill, and no capacity
price is marked `not_applicable` as a substitute for missing inference coverage.

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
