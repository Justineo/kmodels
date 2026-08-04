# Inference Providers

The router automatically selects the fastest available provider for the specified model.
Use `:cheapest` for the most cost-efficient provider (lowest price per output token), or
`:preferred` to follow your preference order. A provider can also be selected explicitly.

`provider="auto"` supports Automatic Failover.

GET `/v1/models` returns available models across all providers, including per-provider pricing,
context length, latency, and throughput when available.
