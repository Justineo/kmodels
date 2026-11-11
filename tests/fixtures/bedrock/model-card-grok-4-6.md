<!-- Reviewed excerpt of https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-xai-grok-4-6.md, observed 2026-11-11. Capability, example, and additional region rows omitted; pricing, tier, endpoint and regional ownership retained verbatim. -->

# Grok 4.6

## Model Details

- **Model launch date:** August 18, 2026
- **Model lifecycle:** Active
- **Context window:** 500K tokens

| **Input Modalities**                                                                                   | **Output Modalities**                                                                                     | **[APIs supported](apis.html)**                                                                               | **[Endpoints supported](endpoints.html)**                                                                    |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) Audio  | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) Embedding | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) Responses        | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) bedrock-runtime |
| ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) Image     | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) Image     | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) Chat Completions | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) bedrock-mantle  |
| ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) Speech | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) Speech    | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) Converse         |                                                                                                              |
| ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) Text      | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) Text         | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) Invoke           |                                                                                                              |
| ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) Video  | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) Video     |                                                                                                               |                                                                                                              |

## Pricing

| **Inference option** | **Input** | **Output** | **Cache read** |
| -------------------- | --------- | ---------- | -------------- |
| In-Region            | $2.20     | $6.60      | $0.55          |
| Geo CRIS             | $2.20     | $6.60      | $0.55          |
| Global CRIS          | $2.00     | $6.00      | $0.50          |

_All prices are per 1 million tokens. Pricing shown is for the Standard tier._

**Priority and Flex tier support:** In addition to Standard, Grok 4.6 supports the Priority and Flex service tiers. Priority is billed at **1.75x** the Standard per-token rate (a 75% premium) and Flex at **0.5x** the Standard rate (a 50% discount); apply these multipliers to the Standard rates shown above. For details on each service tier, see [service tiers](service-tiers-inference.html).

## Programmatic Access

| **Endpoint**    | **Model ID** | **In-Region endpoint URL**                        | **Geo inference ID** | **Global inference ID** |
| --------------- | ------------ | ------------------------------------------------- | -------------------- | ----------------------- |
| bedrock-mantle  | xai.grok-4.6 | https://bedrock-mantle.{region}.api.aws/openai/v1 | Not supported        | Not supported           |
| bedrock-runtime | xai.grok-4.6 | Not supported                                     | us.xai.grok-4.6      | global.xai.grok-4.6     |

## Service Tiers

Amazon Bedrock offers multiple service tiers to match your workload requirements. **Standard** provides pay-per-token access with no commitment (set `"service_tier": "default"` or omit the field). **Priority** delivers faster, prioritized processing for a price premium (set `"service_tier": "priority"`). **Flex** provides lower-cost access for flexible, non-time-sensitive workloads (set `"service_tier": "flex"`). For more information, see [service tiers](service-tiers-inference.html).

| **Standard**                                                                                 | **Priority**                                                                                 | **Flex**                                                                                     | **Reserved**                                                                                    |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) |

## Regional Availability

**Availability using the `bedrock-runtime` endpoint**

| **Region**                    | **In-Region**                                                                                   | **Geo**                                                                                         | **Global**                                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| us-east-1 (N. Virginia)       | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png)    | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png)    |
| us-west-2 (Oregon)            | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png)    | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png)    |
| us-gov-west-1 (GovCloud West) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png)    | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) |
| eu-central-1 (Frankfurt)      | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png)    |
