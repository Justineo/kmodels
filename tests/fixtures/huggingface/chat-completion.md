# Chat Completion

Requests can set `reasoning_effort`. Streaming can set `include_usage`.
When enabled, the additional terminal chunk reports usage for the entire request before `[DONE]`.

Responses contain `completion_tokens`, `prompt_tokens`, and `total_tokens`.
