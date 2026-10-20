<!-- Reviewed excerpt of https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-xai-grok-4-3.md, observed 2026-10-20. Unrelated features and additional region rows omitted; endpoint and pricing table ownership retained. -->

# Grok 4.3

## Model Details

- **Model launch date:** June 15, 2026
- **Model lifecycle:** Active
- **Context window:** 1M tokens

| **Input Modalities**                    | **Output Modalities**                     | **[APIs supported](apis.html)**                    | **[Endpoints supported](endpoints.html)**        |
| --------------------------------------- | ----------------------------------------- | -------------------------------------------------- | ------------------------------------------------ |
| ![No](images/icons/icon-no.png) Audio   | ![No](images/icons/icon-no.png) Embedding | ![Yes](images/icons/icon-yes.png) Chat Completions | ![No](images/icons/icon-no.png) bedrock-runtime  |
| ![Yes](images/icons/icon-yes.png) Image | ![No](images/icons/icon-no.png) Image     | ![Yes](images/icons/icon-yes.png) Responses        | ![Yes](images/icons/icon-yes.png) bedrock-mantle |
| ![Yes](images/icons/icon-yes.png) Text  | ![Yes](images/icons/icon-yes.png) Text    | ![No](images/icons/icon-no.png) Converse           |                                                  |

_On `bedrock-mantle`, this model is served at `/openai/v1/responses`, not the default `/v1/responses`._

## Pricing

| **Inference option** | **Input** | **Output** | **Cache read** |
| -------------------- | --------- | ---------- | -------------- |
| In-Region            | $1.25     | $2.50      | $0.20          |

**AWS GovCloud (US-West)**

| **Inference option** | **Input** | **Output** | **Cache read** |
| -------------------- | --------- | ---------- | -------------- |
| In-Region            | $1.50     | $3.00      | $0.24          |

_All prices are per 1 million tokens. Pricing shown is for the Standard tier. Grok 4.3 supports In-Region inference only._

## Programmatic Access

| **Endpoint**   | **Model ID** | **In-Region endpoint URL**                        | **Geo inference ID** | **Global inference ID** |
| -------------- | ------------ | ------------------------------------------------- | -------------------- | ----------------------- |
| bedrock-mantle | xai.grok-4.3 | https://bedrock-mantle.{region}.api.aws/openai/v1 | Not supported        | Not supported           |

## Regional Availability

| **Region**         | **In-Region**                     | **Geo**                         | **Global**                      |
| ------------------ | --------------------------------- | ------------------------------- | ------------------------------- |
| us-west-2 (Oregon) | ![Yes](images/icons/icon-yes.png) | ![No](images/icons/icon-no.png) | ![No](images/icons/icon-no.png) |
