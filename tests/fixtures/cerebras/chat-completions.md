# Chat Completions

## OpenAPI

```yaml POST /v1/chat/completions
openapi: 3.1.0
paths:
  /v1/chat/completions:
    post:
      operationId: createChatCompletion
      responses:
        "200":
          description: Successful response
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ChatCompletionResponse"
              examples:
                Streaming:
                  value:
                    object: chat.completion.chunk
                    usage:
                      prompt_tokens: 82
                      completion_tokens: 26
components:
  schemas:
    ChatCompletionResponse:
      type: object
      properties:
        usage:
          type: object
          properties:
            prompt_tokens:
              type: integer
            completion_tokens:
              type: integer
            total_tokens:
              type: integer
            prompt_tokens_details:
              type: object
              properties:
                cached_tokens:
                  type: integer
```
