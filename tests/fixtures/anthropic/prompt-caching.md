# Prompt caching

## Supported models

Prompt caching (both automatic and explicit) is supported on all [active Claude models](/docs/en/about-claude/models/overview).

## 1-hour cache duration

The response includes detailed cache information:

```json
{
  "usage": {
    "cache_creation_input_tokens": 248,
    "cache_creation": {
      "ephemeral_5m_input_tokens": 148,
      "ephemeral_1h_input_tokens": 100
    },
    "iterations": [
      {
        "cache_creation_input_tokens": 248,
        "cache_creation": {
          "ephemeral_5m_input_tokens": 148,
          "ephemeral_1h_input_tokens": 100
        },
        "type": "message"
      }
    ]
  }
}
```

The current `cache_creation_input_tokens` field equals the sum of the values in the `cache_creation` object.
