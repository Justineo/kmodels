# Hugging Face catalog refinement

Status: reviewed against catalog snapshot `2026-07-22T17:04:19.221Z` and Kong AI Gateway 2.0

## Catalog assessment

The current Hugging Face provider contains 19,326 models. That count is not itself evidence of a collection bug: 17,771 rows come from Featherless AI, whose official Hugging Face integration intentionally exposes thousands of open-weight models. The remaining large source is HF Inference with 1,408 rows.

The important distinction is what a row means. “Present on the Hugging Face Hub”, “registered with an Inference Provider”, “available through the OpenAI-compatible router”, and “supported by Kong AI Gateway” are different facts. Kmodels treats this provider as a gateway catalog: a row requires at least one concrete public `live` mapping, while each mapping remains separate route evidence.

## Official source semantics

The Model Mapping API records a relationship between:

- an exact Hugging Face repository ID;
- a provider;
- the provider's own model ID;
- a task;
- a `live` or `staging` state.

Hugging Face describes `live` mappings as publicly available mappings registered by an inference provider. It separately exposes whether a model is currently warm, so `live` must not be interpreted as preloaded or latency-guaranteed. See the [Model Mapping API](https://huggingface.co/docs/inference-providers/en/register-as-a-provider) and [Hub API](https://huggingface.co/docs/inference-providers/en/hub-api).

The public `GET /v1/models` endpoint is narrower. It lists OpenAI-compatible chat models and their live routes, with optional pricing, context, capability, latency, and throughput facts. It is an overlay for chat routing, not a replacement for task-specific mappings.

## Kmodels representation

A Hugging Face `ProviderModel` exists when at least one official source contains a concrete `live` mapping for an exact Hugging Face repository ID. Its canonical `model_id` is the exact `namespace/repository` value accepted by Hugging Face clients and automatic routing.

The list excludes:

- repositories that are merely downloadable from the Hub;
- staging, private, or account-scoped mappings;
- parameterized `tag-filter` contracts without a concrete model ID;
- model IDs inferred from names, owners, tags, popularity, or repository metadata;
- provider-internal IDs promoted to canonical Hugging Face IDs.

Community fine-tunes must not be filtered merely for being obscure. If an official provider mapping marks one `live`, its presence is an observed fact. Every source that matches the model must remain in `source_refs`.

## Route evidence

`source_refs` proves which sources observed a model but cannot represent the mapping itself. Each mapping is therefore retained in `routes` instead of being reduced to a broad normalized type:

For example:

```json
{
  "model_id": "google/gemma-3-27b-it",
  "routes": [
    {
      "source_ref": "huggingface-featherless-ai",
      "provider": "featherless-ai",
      "provider_model_id": "google/gemma-3-27b-it",
      "task": "conversational",
      "status": "live"
    },
    {
      "source_ref": "huggingface-scaleway",
      "provider": "scaleway",
      "provider_model_id": "google/gemma-3-27b-it-fast",
      "task": "conversational",
      "status": "live"
    }
  ]
}
```

The router remains an overlay and cannot create a model without a concrete mapping. It contributes model-level OpenAI-compatible chat presence, route-conditioned pricing, the maximum advertised context, and conservative capability aggregates. The router does not publish a provider model ID, so Kmodels does not overwrite the exact mapping identity or invent a provider-specific join. Volatile latency and throughput probes remain outside the stable catalog.

## Kong AI Gateway compatibility

The source of truth for this analysis is the Kong developer documentation repository, in particular:

- `app/ai-gateway/ai-providers/huggingface.md`;
- `app/_data/ai-gateway/v2/providers.yaml`;
- `app/ai-gateway/v1/ai-providers/huggingface.md`;
- `app/_data/plugins/ai-proxy.yaml`.

Kong does not maintain a fixed Hugging Face model allowlist. The documentation declares provider-level API capabilities and points to Hugging Face model searches; it does not assert that every Hub repository or every inference-provider mapping works with every Kong route. Model compatibility is therefore the intersection of the deployed Kong version, a Kong capability, an exact Hugging Face API surface, and a callable model route.

### AI Gateway 2.0

The current AI Gateway 2.0 provider definition declares these Hugging Face capabilities:

| Kong capability            | Hugging Face upstream                                           | Required model evidence                                                                                    |
| -------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `generate`                 | `/v1/chat/completions`                                          | Presence in the OpenAI-compatible router with a live chat route; a generic `generate` type is insufficient |
| `embeddings`               | `/hf-inference/models/{model_name}/pipeline/feature-extraction` | A concrete `hf-inference` mapping for `feature-extraction`                                                 |
| `audio_transcription`      | `/v1/audio/transcriptions`                                      | A concrete callable route for `automatic-speech-recognition`                                               |
| `image`                    | `/v1/images/generations`                                        | A concrete callable image-generation route, retaining its exact Hugging Face task                          |
| `video`                    | `/v1/videos`                                                    | A concrete callable video-generation route, retaining its exact Hugging Face task                          |
| Native Hugging Face format | `/generate`, `/generate_stream`                                 | A concrete text-generation route compatible with the native endpoint                                       |

The same definition explicitly marks completions, files, batches, agentic operations, speech synthesis, audio translation, realtime, and reranking as unsupported. Those model tasks must not be labeled Kong-compatible for AI Gateway 2.0 merely because Hugging Face exposes them.

### AI Gateway 1.x

The versioned 1.x documentation has a narrower matrix:

| Kong route type               | Minimum Gateway version | Required model evidence                                                            |
| ----------------------------- | ----------------------: | ---------------------------------------------------------------------------------- |
| `llm/v1/chat`                 |                     3.9 | OpenAI-compatible router presence with a live chat route                           |
| `llm/v1/embeddings`           |                    3.11 | A concrete `hf-inference` mapping for `feature-extraction`                         |
| `video/v1/videos/generations` |                    3.13 | A concrete callable video-generation route                                         |
| Native Hugging Face format    |                     3.9 | A concrete text-generation route compatible with `/generate` or `/generate_stream` |

Image generation and audio transcription appear in the 2.0 provider definition but not in the 1.x Hugging Face matrix. A single unversioned `supported_by_kong` boolean would therefore be incorrect.

### Consequence for Kmodels

In the reviewed catalog snapshot, 127 models are observed by `huggingface-router`; exact router membership is the strongest deterministic evidence for Kong's OpenAI-compatible chat capability. Task-specific and native compatibility instead uses the retained mapping route.

The full 19,326-model set must not be labeled Kong-compatible as a unit. `source_refs` alone is also insufficient: compatibility requires the retained route's provider, provider model ID, raw task, and source. For example, a `feature-extraction` mapping from a provider other than `hf-inference` does not prove that Kong's documented `hf-inference` upstream path accepts the model.

Any Kmodels compatibility projection must derive Kong support as a versioned capability relation, not a property of the Hugging Face provider or of the broad normalized model type. Unknown or mismatched task/endpoint combinations remain unclassified rather than guessed.

## Refinement decision

The large count is plausible and is not reduced with popularity or publisher heuristics:

1. Keep every concrete official `live` model mapping.
2. Preserve the exact provider route, provider model ID, and raw task.
3. Treat `/v1/models` as a chat-route overlay.
4. Require Kong compatibility to match its version, capability, upstream endpoint, provider route, and raw task.
5. Do not infer support for an operation merely because another Kong provider supports that operation family.
6. Present Hugging Face as a gateway catalog, not as one host offering 19,326 equivalent deployments.
