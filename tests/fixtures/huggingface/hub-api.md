# Hub API

## List OpenAI-compatible models

Use `https://router.huggingface.co/v1/models` to list the current chat-completion catalog.
To retrieve a single model, provide its model ID. A router backend is `live` or `error`.
Each Hub mapping has a status (`staging` or `live`).

Use `inference_provider=all` and expand `inferenceProviderMapping` for model routing mappings.
The model router exposes per-provider pricing, context length, latency, and throughput when
available.
Output throughput in tokens per second comes from the latest validation probe.

`pricing` contains `input` and `output` prices in USD per million tokens, when available.
`is_free` denotes a temporary promo.
