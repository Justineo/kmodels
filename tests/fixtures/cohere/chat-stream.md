# Chat with Streaming

POST https://api.cohere.com/v2/chat

```text
event: message-end
data: {
  "type": "message-end",
  "delta": {
    "finish_reason": "COMPLETE",
    "usage": {
      "billed_units": {
        "input_tokens": 5,
        "output_tokens": 26
      }
    }
  }
}
```
