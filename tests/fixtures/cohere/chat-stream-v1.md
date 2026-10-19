# Chat with Streaming (V1)

POST https://api.cohere.com/v1/chat

## Response

```json
{
  "event_type": "stream-end",
  "response": {
    "meta": {
      "billed_units": {
        "input_tokens": 3,
        "output_tokens": 9
      }
    }
  }
}
```
