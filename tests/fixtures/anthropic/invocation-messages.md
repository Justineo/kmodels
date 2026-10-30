---
title: Create a Message
url: https://platform.claude.com/docs/en/api/messages/create
---

# Create a Message

**POST** `/v1/messages`

Send a structured list of input messages with text and/or image content, and the model will generate the next message in the conversation.

The Messages API can be used for either single queries or stateless multi-turn conversations.

Learn more about the Messages API in our [user guide](https://platform.claude.com/docs/en/get-started?sdk_languages=http)

## Headers

- `"anthropic-version": optional string`

  The version of the Claude API you want to use.

  Read more about versioning and our version history [here](https://platform.claude.com/docs/en/api/versioning?sdk_languages=http).

- `"anthropic-user-profile-id": optional string`

  The user profile ID to attribute this request to. Use when acting on behalf of a party other than your organization.

- `"anthropic-workspace-id": optional string`

  Optional header to select the Workspace for this request. The value is a Workspace ID (for example, `wrkspc_011CZkZaBF1tNoB5wlCeusgy`).

  Only needed for credentials that can act on more than one Workspace. A credential that belongs to a specific Workspace may omit it; if sent, it must match that Workspace.

## Body parameters

- `model: Model`

  The model that will complete your prompt.

- `inference_geo: optional string or null`

  Specifies the geographic region for inference processing. If not specified, the workspace's `default_inference_geo` is used.

- `speed: optional "standard" or "fast" or null`

  The inference speed mode for this request. `"fast"` enables high output-tokens-per-second inference.

- `stream: optional boolean`

  Whether to incrementally stream the response using server-sent events. When `true`, SDKs return a raw event stream.

- `tools: optional array of ToolUnion`

  Definitions of tools that the model may use.

## Returns

- `Message object`

  - `type: "message"`

  - `usage: Usage`

    Billing and rate-limit usage.

    Anthropic's API bills and rate-limits by token counts, as tokens represent the underlying cost to our systems.

    Under the hood, the API transforms requests into a format suitable for the model. The model's output then goes through a parsing stage before becoming an API response. As a result, the token counts in `usage` will not match one-to-one with the exact visible content of an API request or response.

    For example, `output_tokens` will be non-zero, even for an empty string response from Claude.

    Total input tokens in a request is the summation of `input_tokens`, `cache_creation_input_tokens`, and `cache_read_input_tokens`.

    - `cache_creation: CacheCreation or null`

      Breakdown of cached tokens by TTL

      - `ephemeral_1h_input_tokens: number`

        The number of input tokens used to create the 1 hour cache entry.

        default: 0, minimum: 0

      - `ephemeral_5m_input_tokens: number`

        The number of input tokens used to create the 5 minute cache entry.

        default: 0, minimum: 0

    - `cache_creation_input_tokens: number or null`

      The number of input tokens used to create the cache entry.

      minimum: 0

    - `cache_read_input_tokens: number or null`

      The number of input tokens read from the cache.

      minimum: 0

    - `inference_geo: string or null`

      The geographic region where inference was performed for this request.

    - `input_tokens: number`

      The number of input tokens which were used.

      minimum: 0

    - `output_tokens: number`

      The number of output tokens which were used.

      minimum: 0

    - `output_tokens_details: OutputTokensDetails or null`

      Breakdown of output tokens by category.

      `output_tokens` remains the inclusive, authoritative total used for billing.
      This object provides a read-only decomposition for observability — for example,
      how many of the billed output tokens were spent on internal reasoning that may
      have been summarized before being returned to you.

      - `thinking_tokens: number`

        Number of output tokens the model generated as internal reasoning, including
        the thinking-block delimiter tokens.

        Reflects the raw reasoning the model produced, not the (possibly shorter)
        summarized thinking text returned in the response body. Computed by
        re-tokenizing the raw reasoning text, so it may differ from the model's exact
        generation count by a small number of tokens. Always ≤ `output_tokens`;
        `output_tokens - thinking_tokens` approximates the non-reasoning output.

        default: 0, minimum: 0

    - `server_tool_use: ServerToolUsage or null`

      The number of server tool requests.

      - `web_fetch_requests: number`

        The number of web fetch tool requests.

        default: 0, minimum: 0

      - `web_search_requests: number`

        The number of web search tool requests.

        default: 0, minimum: 0

    - `service_tier: "standard" or "priority" or "batch" or null`

      If the request used the priority, standard, or batch tier.

      - `"standard"`

      - `"priority"`

      - `"batch"`

    - `speed: "standard" or "fast" or null`

      The inference speed mode used for this request.

      - `"standard"`

      - `"fast"`
