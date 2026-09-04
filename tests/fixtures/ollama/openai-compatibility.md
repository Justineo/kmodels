# OpenAI compatibility

Ollama supports `/v1/chat/completions`, `/v1/completions`, and `/v1/responses`.

Chat Completions and Completions support streaming. Set `stream_options.include_usage` to receive
the request usage in the terminal usage chunk. Responses also supports streaming.
