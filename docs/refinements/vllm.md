# vLLM refinement

Status: reviewed against catalog snapshot `2026-07-22T17:48:46.016Z`, current vLLM documentation, and Kong AI Gateway 2.0 branch `80795a1`

## Catalog assessment

Zero rows, zero sources, and `not_configured` coverage are the only accurate global result. vLLM is a self-hosted runtime, not a hosted model provider with one public inventory. An operator can load a Hugging Face repository, a local path, a custom Transformers implementation, or a plugin model, then replace that identity with one or more arbitrary `--served-model-name` values.

The official [supported-models page](https://docs.vllm.ai/en/latest/models/supported_models/) is therefore an architecture compatibility matrix with non-exhaustive example artifacts. It is not a catalog of IDs accepted by an arbitrary deployment. Adding its examples to Kmodels would confuse “vLLM can load this architecture” with “this runtime currently serves this name.”

The documented [`GET /v1/models`](https://docs.vllm.ai/en/latest/api/vllm/entrypoints/openai/models/serving/) response is useful only after one runtime has been explicitly bound. It lists that runtime's served base names and loaded LoRA adapters. Its fields have narrow meanings:

- `id` is the exact runtime request name, including operator-defined names.
- `max_model_len` is the effective runtime limit and may reflect deployment configuration rather than the artifact's published context window.
- `parent` records a loaded adapter's base served name; it is not model lifecycle.
- `root` can contain a private repository or local filesystem path and must not be published or snapshotted.
- `created` is generated when the model card is returned, so it is neither a release date nor an update date.

The response publishes no display name, operation matrix, price, release/update date, or deprecation state. Presence means loaded in that runtime at observation time; absence means only “not loaded now.” Multiple served names backed by one loaded model must not be collapsed through `root`, because that field is sensitive and is not a public alias contract.

The current `ProviderModel` resource also lacks a durable runtime/deployment identity. Enabling `/v1/models` now would either create misleading global rows or produce scoped rows that cannot identify which runtime they belong to. A runtime binding resource is required first, keyed by a reviewed runtime identity and retaining the exact served name, origin reference, observation time, effective limit, and safe adapter parent relation.

## Kong AI Gateway 2.0

The reviewed Kong sources are [`app/ai-gateway/ai-providers/vllm.md`](https://github.com/Kong/developer.konghq.com/blob/release/ai-gateway-2.0/app/ai-gateway/ai-providers/vllm.md) and the vLLM entry in [`app/_data/ai-gateway/v2/providers.yaml`](https://github.com/Kong/developer.konghq.com/blob/release/ai-gateway-2.0/app/_data/ai-gateway/v2/providers.yaml).

Kong AI Gateway 2.0 supports only streaming `generate` traffic for vLLM, routed to `/v1/chat/completions`. Completions, embeddings, files, batches, agentic, audio, image, video, realtime, and rerank are explicitly unsupported by this provider definition even though the vLLM engine itself implements several of those APIs.

Every Kong target requires an operator-supplied `upstream_url`, and its target `name` must be an exact name accepted by that runtime. Kong's `vllm-llama-3-8b` capability example and `my-vllm-model` target example are placeholders, not catalog authorities. Their absence from Kmodels is expected.

`/v1/models` membership alone does not prove Kong compatibility. The loaded model must use a generative runner and have a usable chat template; vLLM documents that chat requests fail without one. Kmodels must not test this by issuing a chat-completions inference request. Positive compatibility therefore requires deployment configuration evidence for chat readiness in addition to the runtime ID and Kong target binding.

vLLM's `--api-key` is optional and, when enabled, requires a bearer header. Kong's `basic` outbound-auth shape can carry `Authorization: Bearer …`; the minimal vLLM provider example omits that header and is valid only for an unauthenticated runtime. An API key without a reviewed runtime URL is not actionable for Kmodels.

vLLM publishes no provider usage price. Kong can attach operator-defined target input/output costs, but those are deployment policy, not facts that Kmodels should infer from model artifacts or GPU prices.

## Refinement decision

1. Keep vLLM `not_configured` and publish no global model rows or source record.
2. Do not scrape the supported-models matrix as model presence and do not treat Kong examples as IDs.
3. Add a runtime/deployment binding resource before enabling vLLM collection; the existing global-row inventory mechanism is insufficient.
4. A future explicitly allowlisted runtime collector may retain exact `/v1/models` IDs, effective context, safe adapter lineage, and API provenance, but must discard `created`, never publish `root`, and never persist the raw response.
5. Derive Kong compatibility only for the bound target's exact served name with positive non-inference evidence for `/v1/chat/completions`; keep all other vLLM engine operations outside the Kong 2.0 intersection.
6. Keep release, update, lifecycle, pricing, and availability outside the bound runtime unknown unless a separate authoritative source publishes those facts for the exact deployment.
