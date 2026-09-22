# Kimi K3

## ![](kimi.png) Moonshot AI — Kimi K3

## Model Details

Kimi K3 is a multimodal reasoning model.

- **Model launch date:** 18th Sept 2026
- **Model lifecycle:** Active
- **Context window:** 1M tokens

| **Input Modalities**       | **Output Modalities**        | **APIs supported**                    | **Endpoints supported**              |
| -------------------------- | ---------------------------- | ------------------------------------- | ------------------------------------ |
| ![Yes](icon-yes.png) Text  | ![Yes](icon-yes.png) Text    | ![Yes](icon-yes.png) Responses        | ![Yes](icon-yes.png) bedrock-runtime |
| ![Yes](icon-yes.png) Image | ![No](icon-no.png) Image     | ![Yes](icon-yes.png) Chat Completions | ![No](icon-no.png) bedrock-mantle    |
| ![No](icon-no.png) Audio   | ![No](icon-no.png) Embedding | ![Yes](icon-yes.png) Converse         |                                      |

## Pricing

| **Inference option** | **Input** | **Output** | **Cache read** | **Cache write (30 min)** |
| -------------------- | --------- | ---------- | -------------- | ------------------------ |
| Global CRIS          | $3.00     | $15.00     | $0.30          | $3.75                    |
| US CRIS              | $3.30     | $16.50     | $0.33          | $4.125                   |

_All prices are per 1 million tokens. Pricing shown is for the Standard tier._

## Programmatic Access

| **Endpoint**    | **Model ID**       | **In-Region endpoint URL**                     | **Geo inference ID**  | **Global inference ID**   |
| --------------- | ------------------ | ---------------------------------------------- | --------------------- | ------------------------- |
| bedrock-runtime | moonshotai.kimi-k3 | https://bedrock-runtime.{region}.amazonaws.com | us.moonshotai.kimi-k3 | global.moonshotai.kimi-k3 |

## Regional Availability

| **Region**              | **In-Region**      | **Geo**              | **Global**           |
| ----------------------- | ------------------ | -------------------- | -------------------- |
| us-east-1 (N. Virginia) | ![No](icon-no.png) | ![Yes](icon-yes.png) | ![Yes](icon-yes.png) |
