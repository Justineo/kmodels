# Chat (V1)

POST https://api.cohere.com/v1/chat

`billed_units` contain `input_tokens` and `output_tokens`; `tokens` reports generic usage.

```json
{
  "meta": {
    "billed_units": {
      "input_tokens": 5,
      "output_tokens": 198
    },
    "tokens": {
      "input_tokens": 71,
      "output_tokens": 198
    }
  }
}
```
