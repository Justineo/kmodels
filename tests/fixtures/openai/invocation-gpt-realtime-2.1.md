# GPT-Realtime-2.1

> For the complete documentation index, see [llms.txt](/llms.txt). Markdown versions of documentation pages are available by appending `.md` to the page URL.

> Reasoning model with tool use

Model ID: `gpt-realtime-2.1`

GPT-Realtime-2.1 updates GPT-Realtime-2 with improved alphanumeric recognition, silence and noise handling, and interruption behavior. It supports speech-to-speech interactions with configurable reasoning effort, instruction following, and tool use for complex voice-agent workflows.

## Model details

- Default snapshot: `gpt-realtime-2.1`
- Input modalities: text, audio, image
- Output modalities: text, audio
- 128,000 context window
- 32,000 max output tokens
- Sep 30, 2024 knowledge cutoff
- Reasoning token support

## Pricing

Pricing is based on the number of tokens used, or other metrics based on the model type. For tool-specific models, like search and computer use, there’s a fee per tool call. See details in the [pricing page](/api/docs/pricing).

### Text tokens

| Metric       | Price | Unit      |
| ------------ | ----: | --------- |
| Input        |    $4 | 1M tokens |
| Cached input |  $0.4 | 1M tokens |
| Output       |   $24 | 1M tokens |

### Audio tokens

| Metric       | Price | Unit      |
| ------------ | ----: | --------- |
| Input        |   $32 | 1M tokens |
| Cached input |  $0.4 | 1M tokens |
| Output       |   $64 | 1M tokens |

### Image tokens

| Metric       | Price | Unit      |
| ------------ | ----: | --------- |
| Input        |    $5 | 1M tokens |
| Cached input |  $0.5 | 1M tokens |

- GPT-Realtime-2.1 supports configurable reasoning effort. Higher reasoning effort can increase latency and output token usage.

## Endpoints

| Endpoint               | Route                                | Support       |
| ---------------------- | ------------------------------------ | ------------- |
| Live                   | `v1/live/sessions`                   | Not supported |
| Chat Completions       | `v1/chat/completions`                | Not supported |
| Responses              | `v1/responses`                       | Not supported |
| Realtime               | `v1/realtime`                        | Supported     |
| Realtime translation   | `v1/realtime/translations`           | Not supported |
| Realtime transcription | `v1/realtime/transcription_sessions` | Not supported |
| Assistants             | `v1/assistants`                      | Not supported |
| Batch                  | `v1/batch`                           | Not supported |
| Fine-tuning            | `v1/fine-tuning`                     | Not supported |
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

- function_calling
- prompt_caching

## Quick comparison

| Model            | Input | Cached input | Output |
| ---------------- | ----: | -----------: | -----: |
| GPT-Realtime-2.1 |    $4 |         $0.4 |    $24 |
| GPT-Realtime-2   |    $4 |         $0.4 |    $24 |

## Snapshots

Snapshots let you lock in a specific version of the model so that performance and behavior remain consistent. Below is a list of all available snapshots and aliases for GPT-Realtime-2.1.

- `gpt-realtime-2.1`

## Rate limits

Rate limits ensure fair and reliable access to the API by placing specific caps on requests, tokens, audio duration, or other usage within a given time period. Your usage tier determines how high these limits are set and automatically increases as you send more requests and spend more on the API.

### default

| Tier   |    RPM |        TPM |
| ------ | -----: | ---------: |
| Build  |    400 |    200,000 |
| Launch | 10,000 |  4,000,000 |
| Grow   | 20,000 | 15,000,000 |
