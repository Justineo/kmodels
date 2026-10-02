# Grok 4.7

## Model Details

Grok 4.7 supports text and image input.

- **Model launch date:** September 28, 2026
- **Model lifecycle:** Active
- **Context window:** 500K tokens

| Input Modalities           | Output Modalities            | APIs supported                        | Endpoints supported                  |
| -------------------------- | ---------------------------- | ------------------------------------- | ------------------------------------ |
| ![Yes](icon-yes.png) Text  | ![Yes](icon-yes.png) Text    | ![Yes](icon-yes.png) Responses        | ![Yes](icon-yes.png) bedrock-runtime |
| ![Yes](icon-yes.png) Image | ![No](icon-no.png) Image     | ![Yes](icon-yes.png) Chat Completions | ![No](icon-no.png) bedrock-mantle    |
| ![No](icon-no.png) Audio   | ![No](icon-no.png) Embedding | ![Yes](icon-yes.png) Converse         |                                      |

## Pricing

| Inference option | Input | Output | Cache read |
| ---------------- | ----- | ------ | ---------- |
| Geo CRIS         | $2.20 | $6.60  | $0.55      |
| Global CRIS      | $2.00 | $6.00  | $0.50      |

All prices are per 1 million tokens. Pricing shown is for the Standard tier.
Priority is billed at **1.75 times** the Standard per-token rate (a 75% premium) and Flex at **0.5 times** the Standard rate (a 50% discount). Apply these multipliers to the Standard rates shown above.

## Programmatic Access

| Endpoint        | Model ID     | In-Region endpoint URL | Geo inference ID | Global inference ID |
| --------------- | ------------ | ---------------------- | ---------------- | ------------------- |
| bedrock-runtime | xai.grok-4.7 | Not supported          | us.xai.grok-4.7  | global.xai.grok-4.7 |

## Regional Availability

| Region                  | In-Region          | Geo                  | Global               |
| ----------------------- | ------------------ | -------------------- | -------------------- |
| us-east-1 (N. Virginia) | ![No](icon-no.png) | ![Yes](icon-yes.png) | ![Yes](icon-yes.png) |
