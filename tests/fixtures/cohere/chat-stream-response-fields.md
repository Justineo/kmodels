POST https://api.cohere.com/v2/chat

## Response

### 200

- Streaming response of `v2_chat_Response_stream_streaming`.
- `type`: `content-delta` (content-delta)
  - `delta` (ChatContentDeltaEventDelta, optional)
- `type`: `message-end` (message-end)
  - `delta` (ChatMessageEndEventDelta, optional)

## Types

### ChatContentDeltaEventDelta

- `message` (object, optional)

### ChatMessageEndEventDelta

- `finish_reason` (enum, optional)
- `usage` (Usage, optional)

### Usage

- `billed_units` (UsageBilledUnits, optional)
- `tokens` (UsageTokens, optional)

### UsageBilledUnits

- `input_tokens` (double, optional) — The number of billed input tokens.
- `output_tokens` (double, optional) — The number of billed output tokens.

### UsageTokens

- `input_tokens` (double, optional) — The number of tokens used as input to the model.
- `output_tokens` (double, optional) — The number of tokens produced by the model.
