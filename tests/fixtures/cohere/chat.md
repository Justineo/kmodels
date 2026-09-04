# Chat

POST https://api.cohere.com/v2/chat

The number of billed input tokens.
The number of billed output tokens.
cached_tokens
The number of prompt tokens that hit the inference cache.

```json
{
  "usage": {
    "billed_units": {
      "input_tokens": 5,
      "output_tokens": 418
    },
    "tokens": {
      "input_tokens": 71,
      "output_tokens": 418
    }
  }
}
```
