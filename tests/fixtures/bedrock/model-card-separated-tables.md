# Claude Haiku 4.5

## ![](claude.png) Anthropic — Claude Haiku 4.5

## Model Details

Claude Haiku 4.5 is a fast multimodal model.

- **Model launch date:** Oct 15, 2025
- **Model EOL date:** N/A
- **Model lifecycle:** Active
- **Context window:** 200K tokens
- **Max output tokens:** 64K
- **Reasoning:** Supported

| **Input Modalities**       | **Output Modalities**        |
| -------------------------- | ---------------------------- |
| ![Yes](icon-yes.png) Text  | ![Yes](icon-yes.png) Text    |
| ![Yes](icon-yes.png) Image | ![No](icon-no.png) Image     |
| ![No](icon-no.png) Audio   | ![No](icon-no.png) Embedding |

## Endpoints and APIs supported

**Endpoint support**

| **Endpoint**    | **Supported**              |
| --------------- | -------------------------- |
| bedrock-runtime | ![supported](icon-yes.png) |
| bedrock-mantle  | ![supported](icon-yes.png) |

**APIs supported on `bedrock-runtime` endpoint**

| **Messages**                  | **Responses**                 | **Chat Completions**          | **Converse**               | **Invoke**                 |
| ----------------------------- | ----------------------------- | ----------------------------- | -------------------------- | -------------------------- |
| ![not-supported](icon-no.png) | ![not-supported](icon-no.png) | ![not-supported](icon-no.png) | ![supported](icon-yes.png) | ![supported](icon-yes.png) |

**APIs supported on `bedrock-mantle` endpoint**

| **Messages**               | **Responses**                 | **Chat Completions**          | **Converse**                  | **Invoke**                    |
| -------------------------- | ----------------------------- | ----------------------------- | ----------------------------- | ----------------------------- |
| ![supported](icon-yes.png) | ![not-supported](icon-no.png) | ![not-supported](icon-no.png) | ![not-supported](icon-no.png) | ![not-supported](icon-no.png) |

## Capabilities and Features

**Prompt caching**

| **Prompt caching supported** | **Supported TTL** |
| ---------------------------- | ----------------- |
| Yes                          | 5 minutes         |

## Programmatic Access

| **Endpoint**      | **Model ID**                               | **In-Region endpoint URL**                                      | **Geo inference ID**                          | **Global inference ID**                           |
| ----------------- | ------------------------------------------ | --------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------- |
| `bedrock-runtime` | `anthropic.claude-haiku-4-5-20251001-v1:0` | `https://bedrock-runtime.{region}.amazonaws.com`                | `us.anthropic.claude-haiku-4-5-20251001-v1:0` | `global.anthropic.claude-haiku-4-5-20251001-v1:0` |
| `bedrock-mantle`  | `anthropic.claude-haiku-4-5`               | `https://bedrock-mantle.{region}.api.aws/anthropic/v1/messages` | N/A                                           | N/A                                               |

## Regional Availability

| **Region**                 | **In-Region**        | **Geo**              | **Global**           |
| -------------------------- | -------------------- | -------------------- | -------------------- |
| us-east-1 (N. Virginia)    | ![Yes](icon-yes.png) | ![Yes](icon-yes.png) | ![Yes](icon-yes.png) |
| ap-southeast-4 (Melbourne) | ![Yes](icon-yes.png) | ![Yes](icon-yes.png) | ![Yes](icon-yes.png) |
