## Create a Message

**post** `/v1/messages`

### Body Parameters

- `model: Model`

  - `"claude-fable-5" or "claude-opus-4-8" or 4 more`

    - `"claude-fable-5"`

    - `"claude-opus-4-8"`

    - `"claude-sonnet-5"`

    - `"claude-mythos-5"`

    - `"claude-mythos-preview"`

    - `"claude-opus-4-7"`

- `max_tokens: number`

- `stream: optional boolean`

  Whether to incrementally stream the response using server-sent events.

- `tools: optional array of ToolUnion`

  Definitions of tools that the model may use. If you include `tools` in your API request, the model may return `tool_use` content blocks.

### Returns

- `usage: Usage`
  - `cache_creation_input_tokens: number or null`
  - `cache_read_input_tokens: number or null`
  - `inference_geo: string or null`
  - `input_tokens: number`
  - `output_tokens: number`
  - `server_tool_use: ServerToolUsage or null`
  - `service_tier: "standard" or "priority" or "batch" or null`
  - `speed: "standard" or "fast" or null`
