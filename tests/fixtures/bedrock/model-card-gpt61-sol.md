# GPT-6.1 Sol

<a name="model-card-openai-gpt-6-1-sol"></a>

## ![OpenAI logo.](https://docs.aws.amazon.com/bedrock/latest/userguide/images/models/openai.png) OpenAI — GPT-6.1 Sol

<a name="model-card-openai-gpt-6-1-sol-header"></a>

## Model Details

<a name="model-card-openai-gpt-6-1-sol-details"></a>

OpenAI GPT-6.1 Sol brings advanced capabilities to workloads where both performance and cost matter. GPT-6.1 Sol helps agents investigate codebases and iterate on solutions. Agents can also use it to understand complex documents and complete business and computer use workflows across multiple steps.

- **Model launch date:** September 29, 2026
- **Model lifecycle policy:** [OpenAI model deprecation notice periods](https://developers.openai.com/api/docs/deprecations#model-deprecation-notice-periods). This model follows OpenAI first-party lifecycle terms, with at least 6 months of deprecation notice for generally available models, unless safety or compliance concerns require a faster timeline.
- **Model EOL date:** Not announced.
- **End User License Agreements and Terms of Use:** [OpenAI models on Amazon Bedrock terms](https://aws.amazon.com/legal/bedrock/third-party-models/#amsc13--xttmgl)
- **Model lifecycle:** Active
- **Context window:** 1M tokens
- **Max output tokens:** 131,072 tokens
- **Marketplace product ID:** `prod-qco655ut2vn54`

| **Input Modalities**                                                                                   | **Output Modalities**                                                                                     |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) Audio  | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) Embedding |
| ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) Image     | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) Image     |
| ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) Speech | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) Speech    |
| ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) Text      | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) Text         |
| ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) Video  | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) Video     |

## Endpoints and APIs supported

<a name="model-card-openai-gpt-6-1-sol-apis-endpoints"></a>

The following tables show which endpoints and APIs GPT-6.1 Sol supports. For more information, see [APIs supported by Amazon Bedrock](apis.md) and [Inference endpoints supported by Amazon Bedrock](endpoints.md).

**Endpoint support**

| **Endpoint**    | **Supported**                                                                                |
| --------------- | -------------------------------------------------------------------------------------------- |
| bedrock-runtime | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| bedrock-mantle  | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |

**APIs supported on `bedrock-runtime`**

| **Messages**                                                                                    | **Responses**                                                                                | **Chat Completions**                                                                         | **Converse**                                                                                 | **Invoke**                                                                                   |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |

**APIs supported on `bedrock-mantle`**

| **Messages**                                                                                    | **Responses**                                                                                | **Chat Completions**                                                                         | **Converse**                                                                                    | **Invoke**                                                                                      |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) |

**Note**  
On `bedrock-mantle`, both APIs use the `/openai/v1` base path, not `/v1`. Use either API with this model:  
For Responses, use `/openai/v1/responses`.
For Chat Completions, use `/openai/v1/chat/completions`.

## Capabilities and Features

### Prompt caching

<a name="model-card-openai-gpt-6-1-sol-prompt-caching"></a>

GPT-6.1 Sol supports both [Implicit Prompt Caching](prompt-caching.html#prompt-caching-implicit) and [Explicit Prompt Caching](prompt-caching.html#prompt-caching-explicit). API support differs by endpoint:

- Responses and Chat Completions support both caching types on the `bedrock-runtime` and `bedrock-mantle` endpoints.
- InvokeModel supports both caching types on the `bedrock-runtime` endpoint.
- Converse supports implicit caching on the `bedrock-runtime` endpoint. The native `cachePoint` field isn't supported for explicit caching with this model.

For explicit caching, set `prompt_cache_options.mode` to `explicit`. Set `prompt_cache_options.ttl` to `30m`, the only supported TTL and the default. In Responses requests, add `"prompt_cache_breakpoint": {"mode": "explicit"}` to an `input_text` content block. In Chat Completions and InvokeModel requests, add it to a `text` content part.

A cacheable prompt prefix must contain at least 1,024 tokens. You can include multiple explicit breakpoints, and each request can create up to four cache writes. Check the cache usage fields in the response to determine whether tokens were written to or read from the cache.

## Pricing

<a name="model-card-openai-gpt-6-1-sol-pricing"></a>

All prices are in USD per 1 million tokens. The following tables list Standard and Ultrafast prices. Global CRIS rates match [OpenAI first-party pricing](https://developers.openai.com/api/docs/pricing) for the same service tier.

The **Input — 30-minute cache write** column is the price per 1 million tokens written to the prompt cache. The 30-minute figure is how long a cached prompt prefix is retained, not a quantity of tokens. For more information, see [prompt caching](prompt-caching.md).

In-Region access on `bedrock-mantle` costs 10% more than Global CRIS. US geographic cross-Region inference (US CRIS) on `bedrock-runtime` has the same premium. This applies to both service tiers. The tables include this premium.

GPT-6.1 Sol supports both implicit and explicit prompt caching. Cache-write tokens are billed at 1.25× the uncached input-token rate, and cache-read tokens are billed at 0.05× the uncached input-token rate. For configuration and API support, see [Prompt caching](#model-card-openai-gpt-6-1-sol-prompt-caching).

Long-context rates apply to the full request when input exceeds 272,000 tokens.

_Priority and Flex tiers are not supported for this model._

### Standard — Commercial Regions, short context (272K input tokens or fewer)

<a name="model-card-openai-gpt-6-1-sol-pricing-short"></a>

| **Inference option**                               | **Input** | **Input — cache write** | **Input — cache read** | **Output** |
| -------------------------------------------------- | --------- | ----------------------- | ---------------------- | ---------- |
| Regional (bedrock-mantle in US East (N. Virginia)) | $2.20     | $2.75                   | $0.11                  | $11.00     |
| US CRIS (bedrock-runtime)                          | $2.20     | $2.75                   | $0.11                  | $11.00     |
| Global CRIS (bedrock-runtime)                      | $2.00     | $2.50                   | $0.10                  | $10.00     |

### Standard — Commercial Regions, long context (more than 272K input tokens)

<a name="model-card-openai-gpt-6-1-sol-pricing-long"></a>

| **Inference option**                               | **Input** | **Input — cache write** | **Input — cache read** | **Output** |
| -------------------------------------------------- | --------- | ----------------------- | ---------------------- | ---------- |
| Regional (bedrock-mantle in US East (N. Virginia)) | $4.40     | $5.50                   | $0.22                  | $16.50     |
| US CRIS (bedrock-runtime)                          | $4.40     | $5.50                   | $0.22                  | $16.50     |
| Global CRIS (bedrock-runtime)                      | $4.00     | $5.00                   | $0.20                  | $15.00     |

Ultrafast costs six times as much as Standard. Global CRIS rates match [OpenAI first-party Ultrafast pricing](https://developers.openai.com/api/docs/pricing?latest-pricing=ultrafast). On `bedrock-runtime`, use Ultrafast through US CRIS or Global CRIS. On `bedrock-mantle`, use Ultrafast in `us-east-1`. Short-context prices apply to requests with up to 272,000 input tokens. Above that limit, long-context prices apply to the full request.

### Ultrafast — Commercial Regions, short context (272K input tokens or fewer)

<a name="model-card-openai-gpt-6-1-sol-pricing-ultrafast-short"></a>

| **Inference option**                    | **Input** | **Input — 30-minute cache write** | **Input — cache read** | **Output** |
| --------------------------------------- | --------- | --------------------------------- | ---------------------- | ---------- |
| In-Region (bedrock-mantle in us-east-1) | $13.20    | $16.50                            | $0.66                  | $66.00     |
| US CRIS (bedrock-runtime)               | $13.20    | $16.50                            | $0.66                  | $66.00     |
| Global CRIS (bedrock-runtime)           | $12.00    | $15.00                            | $0.60                  | $60.00     |

### Ultrafast — Commercial Regions, long context (more than 272K input tokens)

<a name="model-card-openai-gpt-6-1-sol-pricing-ultrafast-long"></a>

| **Inference option**                    | **Input** | **Input — 30-minute cache write** | **Input — cache read** | **Output** |
| --------------------------------------- | --------- | --------------------------------- | ---------------------- | ---------- |
| In-Region (bedrock-mantle in us-east-1) | $26.40    | $33.00                            | $1.32                  | $99.00     |
| US CRIS (bedrock-runtime)               | $26.40    | $33.00                            | $1.32                  | $99.00     |
| Global CRIS (bedrock-runtime)           | $24.00    | $30.00                            | $1.20                  | $90.00     |

## Programmatic Access

<a name="model-card-openai-gpt-6-1-sol-programmatic-access"></a>

To call this model from code, use the following model IDs and endpoint URLs. For more information, see [APIs supported by Amazon Bedrock](apis.md) and [Inference endpoints supported by Amazon Bedrock](endpoints.md).

| **Endpoint**    | **Model ID**       | **In-Region endpoint URL**                         | **Geo inference ID**  | **Global inference ID**   |
| --------------- | ------------------ | -------------------------------------------------- | --------------------- | ------------------------- |
| bedrock-mantle  | openai.gpt-6.1-sol | https://bedrock-mantle.us-east-1.api.aws/openai/v1 | Not supported         | Not supported             |
| bedrock-runtime | openai.gpt-6.1-sol | Not supported                                      | us.openai.gpt-6.1-sol | global.openai.gpt-6.1-sol |

_For in-Region access, use `bedrock-mantle` in `us-east-1` (N. Virginia). On `bedrock-runtime`, the OpenAI-compatible base URL is `https://bedrock-runtime.{region}.amazonaws.com/openai/v1`. Use `us.openai.gpt-6.1-sol` for US geographic cross-Region inference or `global.openai.gpt-6.1-sol` for global cross-Region inference. Direct in-Region invocation is not supported on `bedrock-runtime`. Use a source Region enabled for the profile you choose; see [Route model inference requests across AWS Regions with cross-Region inference](cross-region-inference.md)._

## Service Tiers

<a name="model-card-openai-gpt-6-1-sol-tiers"></a>

Amazon Bedrock offers several service tiers for different workloads. **Standard** gives you pay-per-token access with no commitment. To use it, set `"service_tier": "default"` or omit the field. For more information, see [service tiers](service-tiers-inference.html).

**Ultrafast** is a premium speed tier for GPT-6.1 Sol. Use it for workloads where response speed matters most. To request it with the Responses API, set `"service_tier": "ultrafast"`.

| **Standard**                                                                                 | **Ultrafast**                                                                                | **Priority**                                                                                    | **Flex**                                                                                        | **Reserved**                                                                                    |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) |

Use one of these routes for Ultrafast:

- `bedrock-mantle` in `us-east-1`, with model ID `openai.gpt-6.1-sol`.
- `bedrock-runtime`, with `us.openai.gpt-6.1-sol` for US CRIS or `global.openai.gpt-6.1-sol` for Global CRIS.

## Regional Availability

<a name="model-card-openai-gpt-6-1-sol-regional-availability"></a>

_**Regional availability at a glance**_

Standard and Ultrafast are available on `bedrock-mantle` in `us-east-1` (N. Virginia). Both tiers support US geographic and global inference profiles on `bedrock-runtime`. For more information, see [Regional availability by models](models-region-compatibility.md).

**Availability using the `bedrock-mantle` endpoint**

| **Region**              | **In-Region**                                                                                | **Geo**                                                                                         | **Global**                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| us-east-1 (N. Virginia) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) |

**Availability using the `bedrock-runtime` endpoint**

| **Scope**                          | **In-Region**                                                                                   | **Geo**                                                                                      | **Global**                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| US geographic and global inference | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |

_**Geo inference details**_

The destination Regions available to a geographic inference profile depend on the source Region. To retrieve the current routing configuration, call [GetInferenceProfile](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_GetInferenceProfile.html) from the source Region.

**Geo: US**

Geo inference ID: `us.openai.gpt-6.1-sol`

| **Source Region**         | **Destination Regions**                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| us-east-1 (N. Virginia)   | us-east-1 (N. Virginia), us-east-2 (Ohio), us-west-2 (Oregon)                            |
| us-east-2 (Ohio)          | us-east-1 (N. Virginia), us-east-2 (Ohio), us-west-2 (Oregon)                            |
| us-west-1 (N. California) | us-east-1 (N. Virginia), us-east-2 (Ohio), us-west-1 (N. California), us-west-2 (Oregon) |
| us-west-2 (Oregon)        | us-east-1 (N. Virginia), us-east-2 (Ohio), us-west-2 (Oregon)                            |
| ca-central-1 (Canada)     | ca-central-1 (Canada), us-east-1 (N. Virginia), us-east-2 (Ohio), us-west-2 (Oregon)     |
| ca-west-1 (Calgary)       | ca-west-1 (Calgary), us-east-1 (N. Virginia), us-east-2 (Ohio), us-west-2 (Oregon)       |
