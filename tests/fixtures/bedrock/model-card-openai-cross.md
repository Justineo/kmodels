# GPT-6 Astra

## ![](openai.png) OpenAI — GPT-6 Astra

## Model Details

GPT-6 Astra is a multimodal model.

| Input Modalities           | Output Modalities         | APIs supported                        | Endpoints supported                  |
| -------------------------- | ------------------------- | ------------------------------------- | ------------------------------------ |
| ![Yes](icon-yes.png) Text  | ![Yes](icon-yes.png) Text | ![Yes](icon-yes.png) Responses        | ![Yes](icon-yes.png) bedrock-mantle  |
| ![Yes](icon-yes.png) Image | ![No](icon-no.png) Image  | ![Yes](icon-yes.png) Chat Completions | ![Yes](icon-yes.png) bedrock-runtime |

On `bedrock-mantle`, both APIs use the `/openai/v1` base path, not `/v1`.
On `bedrock-runtime`, the base URL is "https://bedrock-runtime.{region}.amazonaws.com/openai/v1".

## Pricing

All prices are in USD per 1 million tokens for the Standard tier.

Commercial In-Region prices include a 10% fee over OpenAI rates. You do not need to add this fee.

### Commercial Regions — short context (272K input tokens or fewer)

| Inference option | Input  | Input — 30m cache write | Input — cache read | Output |
| ---------------- | ------ | ----------------------- | ------------------ | ------ |
| In-Region        | $11.00 | $13.75                  | $1.10              | $55.00 |
| Geo CRIS         | $11.00 | $13.75                  | $1.10              | $55.00 |
| Global CRIS      | $10.00 | $12.50                  | $1.00              | $50.00 |

## Programmatic Access

| Endpoint        | Model ID           | Geo inference ID      | Global inference ID       |
| --------------- | ------------------ | --------------------- | ------------------------- |
| bedrock-mantle  | openai.gpt-6-astra | Not supported         | Not supported             |
| bedrock-runtime | openai.gpt-6-astra | us.openai.gpt-6-astra | global.openai.gpt-6-astra |

## Regional Availability

**Availability using the `bedrock-runtime` endpoint**

| Region                  | In-Region          | Geo                  | Global               |
| ----------------------- | ------------------ | -------------------- | -------------------- |
| us-east-1 (N. Virginia) | ![No](icon-no.png) | ![Yes](icon-yes.png) | ![Yes](icon-yes.png) |

**Availability using the `bedrock-mantle` endpoint**

| Region                  | In-Region            | Geo                | Global             |
| ----------------------- | -------------------- | ------------------ | ------------------ |
| us-east-1 (N. Virginia) | ![Yes](icon-yes.png) | ![No](icon-no.png) | ![No](icon-no.png) |
