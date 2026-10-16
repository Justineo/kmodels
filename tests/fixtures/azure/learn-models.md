# Foundry Models sold by Azure

::: zone pivot="azure-openai"

## GPT-6.1

### Capabilities

| Model ID                   | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Context Window                          | Max Output Tokens | Training Data (up to) |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ----------------- | --------------------- |
| `gpt-6.1-sol` (2026-09-29) | - [Reasoning](../../openai/how-to/reasoning) - [Responses API](../../openai/how-to/responses). - [Multi-agent orchestration](../../openai/how-to/responses-multi-agent) (preview). - Chat Completions API. - Streaming. - Structured outputs. - Text and image input with text output. - Functions, tools, and parallel tool calling (Responses API only). - Reasoning effort and verbosity. - [Computer use](../../../foundry-classic/openai/how-to/computer-use) - [Full summary of capabilities](../../openai/how-to/reasoning). | 1,050,000 Input: 922,000Output: 128,000 | 128,000           | April 2026            |

::: zone-end

::: zone pivot="azure-direct-others"

## Cohere models sold by Azure

| Model                        | Type          | Capabilities                                                                                                                                                                                               |
| ---------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Cohere-parse-v5`**Preview** | image-to-text | - **Input:** images, tables, and forms - **Output:** Markdown - **Languages:**`en`, `fr`, `es`, `it`, `de`, `pt-br`, `ja`, `ko`, `zh-cn`, and `ar` - **Tool calling:** No - **Response formats:** Markdown |

::: zone-end
