# Inference Providers

Hugging Face Inference Providers expose serverless inference through a single Hugging Face token.

The router automatically selects the fastest available provider for the specified model.
Use `:cheapest` for the most cost-efficient provider (lowest price per output token), or
`:preferred` to follow your preference order. A provider can also be selected explicitly.
You can select the provider of your choice by appending the provider name to the model ID.

`provider="auto"` supports Automatic Failover.

GET `/v1/models` returns available models across all providers, including per-provider pricing,
context length, latency, and throughput when available.

| Partner                                      |
| -------------------------------------------- |
| [Baseten](./providers/baseten)               |
| [Cerebras](./providers/cerebras)             |
| [Cohere](./providers/cohere)                 |
| [DeepInfra](./providers/deepinfra)           |
| [fal](./providers/fal-ai)                    |
| [Featherless AI](./providers/featherless-ai) |
| [Fireworks AI](./providers/fireworks-ai)     |
| [Groq](./providers/groq)                     |
| [HF Inference](./providers/hf-inference)     |
| [Novita](./providers/novita)                 |
| [Nscale](./providers/nscale)                 |
| [OVHcloud](./providers/ovhcloud)             |
| [Public AI](./providers/publicai)            |
| [Replicate](./providers/replicate)           |
| [Scaleway](./providers/scaleway)             |
| [Together](./providers/together)             |
| [WaveSpeedAI](./providers/wavespeed)         |
| [Z.ai](./providers/zai-org)                  |
