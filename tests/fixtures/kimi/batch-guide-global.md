# Using Batch API

Batch inference offers a saving 40% compared with real-time calls. Batch API supports both the `kimi-k2.6` and `kimi-k2.5` models; `kimi-k3` is not supported.

Output usage contains prompt_tokens, completion_tokens, and total_tokens.

```json
{
  "response": {
    "body": { "usage": { "prompt_tokens": 128, "completion_tokens": 32, "total_tokens": 160 } }
  }
}
```
