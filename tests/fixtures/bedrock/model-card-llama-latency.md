# Llama 3.1 70B Instruct

## ![](meta.png) Meta — Llama 3.1 70B Instruct

## Model Details

Llama 3.1 70B Instruct is Meta's 70-billion parameter model with an extended 128K context window and support for tool use and code generation.

| **Input Modalities**      | **Output Modalities**     | **APIs supported**            | **Endpoints supported**              |
| ------------------------- | ------------------------- | ----------------------------- | ------------------------------------ |
| ![Yes](icon-yes.png) Text | ![Yes](icon-yes.png) Text | ![Yes](icon-yes.png) Invoke   | ![Yes](icon-yes.png) bedrock-runtime |
| ![No](icon-no.png) Image  | ![No](icon-no.png) Image  | ![Yes](icon-yes.png) Converse | ![No](icon-no.png) bedrock-mantle    |

## Pricing

For pricing information, see the [Amazon Bedrock Pricing page](https://aws.amazon.com/bedrock/pricing/).

## Programmatic Access

| **Endpoint**      | **Model ID**                      | **In-Region endpoint URL**                       | **Geo inference ID**                 | **Global inference ID** |
| ----------------- | --------------------------------- | ------------------------------------------------ | ------------------------------------ | ----------------------- |
| `bedrock-runtime` | `meta.llama3-1-70b-instruct-v1:0` | `https://bedrock-runtime.{region}.amazonaws.com` | `us.meta.llama3-1-70b-instruct-v1:0` | Not supported           |

## Regional Availability

| **Region**         | **In-Region**        | **Geo**              | **Global**         |
| ------------------ | -------------------- | -------------------- | ------------------ |
| us-west-2 (Oregon) | ![Yes](icon-yes.png) | ![Yes](icon-yes.png) | ![No](icon-no.png) |
