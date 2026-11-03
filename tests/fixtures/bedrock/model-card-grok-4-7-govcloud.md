# Grok 4.7

<a name="model-card-xai-grok-4-7"></a>

## ![xAI logo.](https://docs.aws.amazon.com/bedrock/latest/userguide/images/models/xai.png) xAI — Grok 4.7

<a name="model-card-xai-grok-4-7-header"></a>

## Model Details

<a name="model-card-xai-grok-4-7-details"></a>

Grok 4.7 is xAI's frontier model, built for coding, agentic tasks, and knowledge work, with support for text and image input. It builds on previous generations of Grok with a focus on long-running agents and more ambitious interactive work. It offers a 524,288-token context window shared between input and output, and configurable reasoning efforts (low, medium, high, xhigh).

- **Model launch date:** September 28, 2026
- **EOL no sooner than:** September 28, 2027
- **Legacy period:** at least 6 months
- **Model lifecycle policy:** [Model lifecycle](model-lifecycle.md)
- **Model EOL date:** N/A
- **End User License Agreements and Terms of Use:** [View](https://aws.amazon.com/legal/bedrock/third-party-models/)
- **Model lifecycle:** Active
- **Context window:** 524,288 tokens, shared between input and output
- **Max output tokens:** 524,288 minus input tokens
- **Reasoning:** Supported (configurable: low, medium, high, xhigh)

| **Input Modalities**                                                                                   | **Output Modalities**                                                                                     | **[APIs supported](apis.html)**                                                                               | **[Endpoints supported](endpoints.html)**                                                                      |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) Audio  | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) Embedding | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) Responses        | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) bedrock-runtime   |
| ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) Image     | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) Image     | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) Chat Completions | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) bedrock-mantle |
| ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) Speech | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) Speech    | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) Converse         |                                                                                                                |
| ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) Text      | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) Text         | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) Invoke           |                                                                                                                |
| ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) Video  | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) Video     |                                                                                                               |                                                                                                                |

## Capabilities and Features

<a name="model-card-xai-grok-4-7-capabilities"></a>

_**Bedrock Features**_

**Features supported using `bedrock-runtime` endpoint**

| **Supported**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **Not Supported**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| + ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) [Projects (default project only)](projects.html)<br />+ ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) [Invocation logs](model-invocation-logging.html)<br />+ ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) [Response streaming](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InvokeModelWithResponseStream.html)<br />+ ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) [Application inference profiles](cost-mgmt-application-inference-profiles.html) (`Invoke` and [Converse](conversation-inference.html) APIs only; not supported with Responses or Chat Completions APIs)<br />+ ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) [Implicit Prompt Caching](prompt-caching.html#prompt-caching-implicit)<br />+ ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) [Reasoning](reasoning.html)<br />+ ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) [Structured outputs](structured-output.html)<br />+ ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) [Guardrails](guardrails.html)<br />+ ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) [Client-side tool calling](tool-use.html)<br />+ ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) [Flows](flows.html)<br />+ ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) [Prompt management](prompt-management.html)<br />+ ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) [Prompt optimization](prompt-management-optimize.html) (base model ID `xai.grok-4.7` only)<br />+ ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) [Model evaluation](evaluation.html) (base model ID `xai.grok-4.7` only; inference parameters are not supported) | + ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) [Server-side tool use](tool-use.html)<br />+ ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) [Intelligent prompt routing](prompt-routing.html)<br />+ ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) [Count tokens](count-tokens.html)<br />+ ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) [Explicit Prompt Caching](prompt-caching.html#prompt-caching-explicit)<br />+ ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) [Watermarking](watermarking.html) |

## Pricing

<a name="model-card-xai-grok-4-7-pricing"></a>

The following table shows on-demand pricing for Grok 4.7 by inference option.

| **Inference option** | **Input** | **Output** | **Cache read** |
| -------------------- | --------- | ---------- | -------------- |
| Geo CRIS             | $2.20     | $6.60      | $0.55          |
| Global CRIS          | $2.00     | $6.00      | $0.50          |

**AWS GovCloud (US)**

| **Inference option** | **Input** | **Output** | **Cache read** |
| -------------------- | --------- | ---------- | -------------- |
| Geo CRIS             | $2.64     | $7.92      | $0.66          |

_All prices are per 1 million tokens. Pricing shown is for the Standard tier._

**Priority and Flex tier support:** In addition to Standard, Grok 4.7 supports the Priority and Flex service tiers on the `Responses`, `Chat Completions`, and `Invoke` APIs. The [Converse](conversation-inference.html) API supports the Standard tier only for this model; requesting `priority` or `flex` through Converse returns a validation error. Priority is billed at **1.75 times** the Standard per-token rate (a 75% premium) and Flex at **0.5 times** the Standard rate (a 50% discount). Apply these multipliers to the Standard rates shown above. For details on each service tier, see [service tiers](service-tiers-inference.html).

## Programmatic Access

<a name="model-card-xai-grok-4-7-programmatic-access"></a>

Use the following model IDs and endpoint URLs to access this model programmatically. For more information about the available APIs and endpoints, see [APIs supported](apis.html) and [Endpoints supported](endpoints.html).

| **Endpoint**    | **Model ID** | **In-Region endpoint URL** | **Geo inference ID** | **Global inference ID** |
| --------------- | ------------ | -------------------------- | -------------------- | ----------------------- |
| bedrock-runtime | xai.grok-4.7 | Not supported              | us.xai.grok-4.7      | global.xai.grok-4.7     |

_On `bedrock-runtime`, the base URL is "https://bedrock-runtime.{region}.amazonaws.com/openai/v1" and requests must name the geographic cross-Region inference ID `us.xai.grok-4.7` or the Global cross-Region inference ID `global.xai.grok-4.7` as the model._

## Service Tiers

<a name="model-card-xai-grok-4-7-tiers"></a>

Amazon Bedrock offers multiple service tiers to match your workload requirements. **Standard** provides pay-per-token access with no commitment (set `"service_tier": "default"` or omit the field). **Priority** delivers faster, prioritized processing for a price premium (set `"service_tier": "priority"`). **Flex** provides lower-cost access for flexible, non-time-sensitive workloads (set `"service_tier": "flex"`). For this model, Priority and Flex are available on the `Responses`, `Chat Completions`, and `Invoke` APIs only — the [Converse](conversation-inference.html) API supports Standard only. For more information, see [service tiers](service-tiers-inference.html).

| **Standard**                                                                                 | **Priority**                                                                                 | **Flex**                                                                                     | **Reserved**                                                                                    |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) |

## Regional Availability

<a name="model-card-xai-grok-4-7-regional-availability"></a>

_**Regional availability at a glance**_

Amazon Bedrock offers three inference options: **In-Region** keeps requests within a single Region for strict compliance, **Geo Cross-Region** routes across Regions within a geography (such as US, EU, and APAC) while respecting data residency, and **Global Cross-Region** routes anywhere worldwide when there are no residency constraints. Refer to the [Regional availability by models](models-region-compatibility.md) page for more details.

Grok 4.7 is available on the `bedrock-runtime` endpoint using Geo (US) and Global cross-Region inference. The following table shows availability by Region.

| **Region**                             | **In-Region**                                                                                   | **Geo**                                                                                      | **Global**                                                                                      |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| us-east-1 (N. Virginia)                | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png)    |
| us-gov-east-1 (AWS GovCloud (US-East)) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) |
| us-gov-west-1 (AWS GovCloud (US-West)) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) |

_**Geo inference details**_

The destination Regions available to a geographic inference profile depend on the source Region. To retrieve the current routing configuration, call [GetInferenceProfile](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_GetInferenceProfile.html) from the source Region.

**Geo: US**

Geo inference ID: `us.xai.grok-4.7`

| **Source Region**       | **Destination Regions**                                       |
| ----------------------- | ------------------------------------------------------------- |
| us-east-1 (N. Virginia) | us-east-1 (N. Virginia), us-east-2 (Ohio), us-west-2 (Oregon) |

## Quotas and Limits

<a name="model-card-xai-grok-4-7-quotas"></a>

Your AWS account has default quotas to maintain the performance of the service and to ensure appropriate usage of Amazon Bedrock. The default quotas assigned to an account might be updated depending on regional factors, payment history, fraudulent usage, and/or approval of a quota [increase request](quotas-increase.html). For more information, see [Quotas for Amazon Bedrock](quotas.md) documentation and see the [limits](/general/latest/gr/bedrock.html#limits_bedrock) for the model.
