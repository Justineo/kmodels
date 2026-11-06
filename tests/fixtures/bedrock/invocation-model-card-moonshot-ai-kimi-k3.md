# Kimi K3

<a name="model-card-moonshot-ai-kimi-k3"></a>

## Model Details

<a name="model-card-moonshot-ai-kimi-k3-details"></a>

Kimi K3 is Moonshot AI's most capable open-weight model, combining native vision with a 1-million-token context window for long-running coding and knowledge workflows that sustain context across large repositories, documents, and images. For more information about model development and performance, see the [model/service card](https://huggingface.co/moonshotai/Kimi-K3).

- **Model launch date:** 18th Sept 2026
- **EOL no sooner than:** Not Applicable, at least 45 day EOL Notice will be provided
- **Legacy period:** at least 45 days
- **Model lifecycle policy:** [Bedrock Model Lifecycle](model-lifecycle.md)
- **Model EOL date:** N/A
- **Model lifecycle:** Active
- **Context window:** 1M tokens
- **End User License Agreements and Terms of Use:** [View](https://huggingface.co/moonshotai/Kimi-K3/blob/main/LICENSE) _(Note- Access through Amazon Bedrock is considered access through "**Certified Inference Partners**")_

| **Input Modalities**                                                                                                                                             | **Output Modalities**                                                                                                                                               | **[APIs supported](apis.html)**                                                                                                             | **[Endpoints supported](endpoints.html)**                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ![Red circle with white X icon indicating error, cancel, or close action.](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) Audio  | ![Red circle with white X icon indicating error, cancel, or close action.](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) Embedding | ![Green circle with white checkmark icon.](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) Responses        | ![Green circle with white checkmark icon.](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) bedrock-runtime                               |
| ![Green circle with white checkmark icon.](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) Image                                 | ![Red circle with white X icon indicating error, cancel, or close action.](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) Image     | ![Green circle with white checkmark icon.](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) Chat Completions | ![Red circle with white X icon indicating error, cancel, or close action.](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) bedrock-mantle |
| ![Red circle with white X icon indicating error, cancel, or close action.](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) Speech | ![Red circle with white X icon indicating error, cancel, or close action.](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) Speech    | ![Green circle with white checkmark icon.](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) Converse         |                                                                                                                                                                          |
| ![Green circle with white checkmark icon.](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) Text                                  | ![Green circle with white checkmark icon.](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) Text                                     | ![Green circle with white checkmark icon.](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) Invoke           |                                                                                                                                                                          |
| ![Red circle with white X icon indicating error, cancel, or close action.](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) Video  | ![Red circle with white X icon indicating error, cancel, or close action.](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) Video     |                                                                                                                                             |                                                                                                                                                                          |

**Tip**  
Whenever possible, we recommend using the `bedrock-runtime` endpoint for new applications. For Kimi K3, we recommend using the Chat Completions API. See [Inference endpoints supported by Amazon Bedrock](endpoints.md) for details.

## Pricing

| **Inference option** | **Input** | **Output** | **Cache read** | **Cache write (30 min)** |
| -------------------- | --------- | ---------- | -------------- | ------------------------ |
| Global CRIS          | $3.00     | $15.00     | $0.30          | $3.75                    |
| US CRIS              | $3.30     | $16.50     | $0.33          | $4.125                   |
| IN CRIS              | $3.30     | $16.50     | $0.33          | $4.125                   |

_All prices are per 1 million tokens. Pricing shown is for the Standard tier._

**Priority and Flex tier support:** In addition to Standard, Kimi K3 supports the Priority and Flex service tiers. Priority is billed at **1.75x** the Standard per-token rate (a 75% premium) and Flex at **0.5x** the Standard rate (a 50% discount); apply these multipliers to whichever Standard base rate (Global or US CRIS) applies to your request. For details on each service tier, see [service tiers](service-tiers-inference.html).

## Service Tiers

Kimi K3 supports service tiers on the Responses, Chat Completions, Converse, and `InvokeModel` APIs.

## Programmatic Access

<a name="model-card-moonshot-ai-kimi-k3-programmatic-access"></a>

Use the following model ID and endpoint URL to access this model programmatically. Kimi K3 is available through US and India Geo, and Global cross-Region inference. For more information about the available APIs and endpoints, see [APIs supported](apis.html) and [Endpoints supported](endpoints.html).

| **Endpoint**    | **Model ID**       | **In-Region endpoint URL**                     | **Geo inference ID**                                                                            | **Global inference ID**   |
| --------------- | ------------------ | ---------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------- |
| bedrock-runtime | moonshotai.kimi-k3 | https://bedrock-runtime.{region}.amazonaws.com | us.moonshotai.kimi-k3 in the commercial AWS Regions, in.moonshotai.kimi-k3 in the India Regions | global.moonshotai.kimi-k3 |

_For example, if region is us-east-1 (N. Virginia), then the bedrock-runtime endpoint URL will be "https://bedrock-runtime.us-east-1.amazonaws.com"._

## Regional Availability

<a name="model-card-moonshot-ai-kimi-k3-regional-availability"></a>

_**Regional availability at a glance**_

Amazon Bedrock offers three inference options: **In-Region** keeps requests within a single Region for strict compliance, **Geo Cross-Region** routes across Regions within a geography (such as US, EU, and APAC) while respecting data residency, and **Global Cross-Region** routes anywhere worldwide when there are no residency constraints. Refer to the [Regional availability by models](models-region-compatibility.md) page for more details.

Kimi K3 is available through US Geo cross-Region inference (using the `us.moonshotai.kimi-k3` profile, which routes requests only among US-geography Regions to respect US data residency), India geographic cross-Region inference (using the `in.moonshotai.kimi-k3` profile, which routes requests only among India-geography Regions (Mumbai and Hyderabad) to respect India data residency), and Global cross-Region inference (using the `global.moonshotai.kimi-k3` profile, which routes to any supported commercial AWS Region worldwide). You choose the AWS Region you send requests to, and Amazon Bedrock routes each request accordingly.

**Availability using the `bedrock-runtime` endpoint**

| **Region**                   | **In-Region**                                                                                   | **Geo**                                                                                         | **Global**                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| us-east-1 (N. Virginia)      | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png)    | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| us-east-2 (Ohio)             | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png)    | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| us-west-1 (N. California)    | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png)    | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| us-west-2 (Oregon)           | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png)    | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| ca-central-1 (Canada)        | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png)    | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| ca-west-1 (Calgary)          | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png)    | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| eu-central-1 (Frankfurt)     | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| eu-central-2 (Zurich)        | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| eu-north-1 (Stockholm)       | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| eu-south-1 (Milan)           | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| eu-south-2 (Spain)           | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| eu-west-1 (Ireland)          | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| eu-west-2 (London)           | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| eu-west-3 (Paris)            | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| ap-east-2 (Taipei)           | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| ap-northeast-1 (Tokyo)       | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| ap-northeast-2 (Seoul)       | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| ap-northeast-3 (Osaka)       | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| ap-south-1 (Mumbai)          | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png)    | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| ap-south-2 (Hyderabad)       | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png)    | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| ap-southeast-1 (Singapore)   | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| ap-southeast-2 (Sydney)      | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| ap-southeast-3 (Jakarta)     | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| ap-southeast-4 (Melbourne)   | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| ap-southeast-5 (Malaysia)    | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| ap-southeast-6 (New Zealand) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| ap-southeast-7 (Thailand)    | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| il-central-1 (Tel Aviv)      | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| me-central-1 (UAE)           | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| me-south-1 (Bahrain)         | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| af-south-1 (Cape Town)       | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| sa-east-1 (São Paulo)        | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |

_**Geo inference details**_

The destination Regions available to a geographic inference profile depend on the source Region. To retrieve the current routing configuration, call [GetInferenceProfile](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_GetInferenceProfile.html) from the source Region.

**Geo: US**

Geo inference ID: `us.moonshotai.kimi-k3`

| **Source Region**         | **Destination Regions**                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| us-east-1 (N. Virginia)   | us-east-1 (N. Virginia), us-east-2 (Ohio), us-west-2 (Oregon)                            |
| us-east-2 (Ohio)          | us-east-1 (N. Virginia), us-east-2 (Ohio), us-west-2 (Oregon)                            |
| us-west-1 (N. California) | us-east-1 (N. Virginia), us-east-2 (Ohio), us-west-1 (N. California), us-west-2 (Oregon) |
| us-west-2 (Oregon)        | us-east-1 (N. Virginia), us-east-2 (Ohio), us-west-2 (Oregon)                            |
| ca-central-1 (Canada)     | ca-central-1 (Canada), us-east-1 (N. Virginia), us-east-2 (Ohio), us-west-2 (Oregon)     |
| ca-west-1 (Calgary)       | ca-west-1 (Calgary), us-east-1 (N. Virginia), us-east-2 (Ohio), us-west-2 (Oregon)       |

**Geo: India**

Geo inference ID: `in.moonshotai.kimi-k3`

| **Source Region**      | **Destination Regions**                     |
| ---------------------- | ------------------------------------------- |
| ap-south-1 (Mumbai)    | ap-south-1 (Mumbai), ap-south-2 (Hyderabad) |
| ap-south-2 (Hyderabad) | ap-south-1 (Mumbai), ap-south-2 (Hyderabad) |
