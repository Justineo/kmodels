# GPT-4.1

> For the complete documentation index, see [llms.txt](/llms.txt). Markdown versions of documentation pages are available by appending `.md` to the page URL.

> Smartest non-reasoning model

Model ID: `gpt-4.1`

Status: Deprecated

GPT-4.1 excels at instruction following and tool calling, with broad
knowledge across domains. It features a 1M token context window, and
low latency without a reasoning step.

Note that we recommend starting with [GPT-5](/api/docs/models/gpt-5) for complex tasks.

## Model details

- Default snapshot: `gpt-4.1-2025-04-14`
- Input modalities: text, image
- Output modalities: text
- 1,047,576 context window
- 32,768 max output tokens
- Jun 01, 2024 knowledge cutoff

## Pricing

Pricing is based on the number of tokens used, or other metrics based on the model type. For tool-specific models, like search and computer use, there’s a fee per tool call. See details in the [pricing page](/api/docs/pricing).

### Text tokens

| Metric       | Price | Unit      |
| ------------ | ----: | --------- |
| Input        |    $2 | 1M tokens |
| Cached input |  $0.5 | 1M tokens |
| Output       |    $8 | 1M tokens |

## Endpoints

| Endpoint               | Route                                | Support       |
| ---------------------- | ------------------------------------ | ------------- |
| Live                   | `v1/live/sessions`                   | Not supported |
| Chat Completions       | `v1/chat/completions`                | Supported     |
| Responses              | `v1/responses`                       | Supported     |
| Realtime               | `v1/realtime`                        | Not supported |
| Realtime translation   | `v1/realtime/translations`           | Not supported |
| Realtime transcription | `v1/realtime/transcription_sessions` | Not supported |
| Assistants             | `v1/assistants`                      | Supported     |
| Batch                  | `v1/batch`                           | Supported     |
| Fine-tuning            | `v1/fine-tuning`                     | Supported     |
| Embeddings             | `v1/embeddings`                      | Not supported |
| Image generation       | `v1/images/generations`              | Not supported |
| Videos                 | `v1/videos`                          | Not supported |
| Image edit             | `v1/images/edits`                    | Not supported |
| Speech generation      | `v1/audio/speech`                    | Not supported |
| Transcription          | `v1/audio/transcriptions`            | Not supported |
| Translation            | `v1/audio/translations`              | Not supported |
| Moderation             | `v1/moderations`                     | Not supported |
| Completions (legacy)   | `v1/completions`                     | Not supported |

## Supported features

- streaming
- structured_outputs
- predicted_outputs
- function_calling
- file_search
- file_uploads
- image_input
- web_search
- fine_tuning
- prompt_caching

## Supported tools

Tools supported by this model when using the Responses API.

- function_calling
- web_search
- file_search
- image_generation
- code_interpreter
- mcp

## Quick comparison

| Model   | Input | Cached input | Output |
| ------- | ----: | -----------: | -----: |
| GPT-4.1 |    $2 |         $0.5 |     $8 |
| GPT-4o  |  $2.5 |        $1.25 |    $10 |
| o3-mini |  $1.1 |        $0.55 |   $4.4 |

## Snapshots

Snapshots let you lock in a specific version of the model so that performance and behavior remain consistent. Below is a list of all available snapshots and aliases for GPT-4.1.

- `gpt-4.1-2025-04-14` — Deprecated

## Rate limits

Rate limits ensure fair and reliable access to the API by placing specific caps on requests, tokens, audio duration, or other usage within a given time period. Your usage tier determines how high these limits are set and automatically increases as you send more requests and spend more on the API.

### default

| Tier   |    RPM |        TPM | Batch queue limit |
| ------ | -----: | ---------: | ----------------: |
| Build  |  5,000 |    450,000 |         1,350,000 |
| Launch | 10,000 |  2,000,000 |       200,000,000 |
| Grow   | 10,000 | 30,000,000 |     5,000,000,000 |

### Long Context

> 128k input tokens

| Tier   |   RPM |        TPM | Batch queue limit |
| ------ | ----: | ---------: | ----------------: |
| Build  |   250 |    500,000 |        20,000,000 |
| Launch | 1,000 |  5,000,000 |       100,000,000 |
| Grow   | 4,000 | 10,000,000 |     1,000,000,000 |
