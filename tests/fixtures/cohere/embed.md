# Embed API (v2)

POST https://api.cohere.com/v2/embed

The number of billed images.
The number of billed input tokens.
The number of billed image tokens.

```json
{
  "meta": {
    "billed_units": {
      "input_tokens": 2,
      "image_tokens": 512
    }
  }
}
```
