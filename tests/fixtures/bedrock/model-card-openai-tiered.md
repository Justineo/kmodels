# GPT-5.5

## ![](openai.png) OpenAI — GPT-5.5

## Model Details

GPT-5.5 is a text model.

- **Model lifecycle:** Active
- **Context window:** 1M tokens

| **Input Modalities**      | **Output Modalities**     | **APIs supported**             | **Endpoints supported**             |
| ------------------------- | ------------------------- | ------------------------------ | ----------------------------------- |
| ![Yes](icon-yes.png) Text | ![Yes](icon-yes.png) Text | ![Yes](icon-yes.png) Responses | ![Yes](icon-yes.png) bedrock-mantle |

On `bedrock-mantle`, both APIs use the `/openai/v1` base path, not `/v1`.

## Pricing

All prices are in USD per 1 million tokens for the Standard tier.

Commercial In-Region prices include a 10% fee over OpenAI rates. You do not need to add this fee.

### Commercial Regions — short context (272K input tokens or fewer)

| **Inference option** | **Input** | **Input — 30m cache write** | **Input — cache read** | **Output** |
| -------------------- | --------- | --------------------------- | ---------------------- | ---------- |
| In-Region            | $5.50     | —                           | $0.55                  | $33.00     |

### Commercial Regions — long context (more than 272K input tokens)

| **Inference option** | **Input** | **Input — 30m cache write** | **Input — cache read** | **Output** |
| -------------------- | --------- | --------------------------- | ---------------------- | ---------- |
| In-Region            | $11.00    | —                           | $1.10                  | $49.50     |

## Programmatic Access

| **Endpoint**   | **Model ID**   | **In-Region endpoint URL**                        | **Geo inference ID** | **Global inference ID** |
| -------------- | -------------- | ------------------------------------------------- | -------------------- | ----------------------- |
| bedrock-mantle | openai.gpt-5.5 | https://bedrock-mantle.{region}.api.aws/openai/v1 | Not supported        | Not supported           |

## Regional Availability

| **Region**       | **In-Region**        | **Geo**            | **Global**         |
| ---------------- | -------------------- | ------------------ | ------------------ |
| us-east-2 (Ohio) | ![Yes](icon-yes.png) | ![No](icon-no.png) | ![No](icon-no.png) |
