# Explicit cache (Qwen4)

The example uses `qwen4-max`.

## View cache usage

For streaming output with the OpenAI compatible Chat Completions API, set `stream_options` to `{"include_usage": true}` and read the usage from the last chunk that contains `usage`.

<Tabs>
  <Tab title="OpenAI compatible Chat Completions">
    ```json
    {
      "usage": {
        "prompt_tokens": 2304,
        "prompt_tokens_details": {
          "cached_tokens": 0,
          "cache_write_tokens": 2048,
          "cache_creation_input_tokens": 2048,
          "cache_creation": {
            "ephemeral_5m_input_tokens": 2048,
            "ephemeral_1h_input_tokens": 0
          }
        }
      }
    }
    ```

    The sum of `ephemeral_5m_input_tokens` and `ephemeral_1h_input_tokens` equals the number of tokens written to the cache. All cache fields are raw token counts and do not include billing multipliers.

  </Tab>
  <Tab title="OpenAI compatible Responses">
    For streaming requests, read `response.usage` from the `response.completed` event; do not use the Chat Completions option `stream_options.include_usage`.

    ```json
    {
      "usage": {
        "input_tokens": 4498,
        "input_tokens_details": {
          "cached_tokens": 0,
          "cache_write_tokens": 4488,
          "cache_write_tokens_details": {
            "ttl_5m_tokens": 4488,
            "ttl_1h_tokens": 0
          }
        }
      }
    }
    ```

    The two TTL values sum to `cache_write_tokens`. Do not mix Responses `input_tokens_details` fields with Chat Completions `prompt_tokens_details` or Anthropic `cache_creation` fields.

  </Tab>
  <Tab title="Anthropic compatible">
    ```json
    {
      "usage": {
        "input_tokens": 8,
        "cache_read_input_tokens": 0,
        "cache_creation_input_tokens": 2048,
        "cache_creation": {
          "ephemeral_5m_input_tokens": 0,
          "ephemeral_1h_input_tokens": 2048
        }
      }
    }
    ```

    `cache_creation` reports the number of tokens written to the cache by TTL.

  </Tab>
</Tabs>

## Billing

| Input token type    | Billing                                     |
| ------------------- | ------------------------------------------- |
| Cache write, TTL 5m | Approximately 125% of the input token price |
| Cache write, TTL 1h | Approximately 200% of the input token price |
| Cache read          | Qwen4-Max price book                        |
