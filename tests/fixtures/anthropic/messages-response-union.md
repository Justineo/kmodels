<!-- Reviewed excerpt of https://platform.claude.com/docs/en/api/messages/create.md, observed 2026-10-20. Non-stream and stream response owners retained; unrelated fields omitted. The final example is an adversarial addition. -->

# Create a Message

**post** `/v1/messages`

## Body parameters

- `speed: optional "standard" or "fast" or null`

## Returns

- `Message object`

  - `type: "message"`

  - `usage: Usage`

    - `cache_creation_input_tokens: number or null`
    - `cache_read_input_tokens: number or null`
    - `inference_geo: string or null`
    - `input_tokens: number`
    - `output_tokens: number`
    - `server_tool_use: ServerToolUsage or null`
    - `service_tier: "standard" or "priority" or "batch" or null`
    - `speed: "standard" or "fast" or null`

- `RawMessageDeltaEvent object`

  - `type: "message_delta"`

  - `usage: MessageDeltaUsage`

    - `input_tokens: number or null`
    - `output_tokens: number`

## Example

```json
{ "usage": { "input_tokens": "unowned", "output_tokens": "unowned" } }
```
