# Batch

This feature is in Private Preview. The available endpoint is currently `/v1/chat/completions`.
Successful result objects include `prompt_tokens` and `completion_tokens`. You're only charged for
requests that completed.

```json
{
  "custom_id": "eval-001",
  "status": "succeeded",
  "response": { "usage": { "prompt_tokens": 15, "completion_tokens": 85, "total_tokens": 100 } }
}
```
