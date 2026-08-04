# Chat Completions

## OpenAPI

```yaml POST /v1/chat/completions
paths:
  /v1/chat/completions:
    post:
      operationId: createChatCompletion
```

Streaming response:

```yaml
object: chat.completion.chunk
service_tier_used: default
usage:
  prompt_tokens: 82
  completion_tokens: 26
  total_tokens: 108
  image_tokens: 0
  prompt_tokens_details:
    cached_tokens: 64
  completion_tokens_details:
    reasoning_tokens: 10
    rejected_prediction_tokens: 2
```
