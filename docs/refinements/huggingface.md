# Hugging Face catalog refinement

Status: implemented against the live Hugging Face APIs and Kong AI Gateway 2.0 on 2026-07-23

## Catalog assessment

The previous 19,326-model result was too broad. It did not crawl every Hub repository, but it allowed every third-party provider mapping to create rows; Featherless AI alone contributed 17,771 mostly community-published repositories. A provider registration is valid route metadata, but it is not a Hugging Face-curated global catalog boundary.

Kmodels now uses only two Hugging Face-operated listings for presence: the public OpenAI-compatible router catalog and concrete `live` mappings served by HF Inference itself. It does not fetch third-party partner mapping inventories. This retains models directly offered through Hugging Face-operated services without turning the catalog into a copy of every community repository accepted by a partner.

The latest 2026-07-23 synchronized responses contain 1,408 concrete HF Inference mappings and 126 router models, with no overlap: 1,534 rows in total. These are volatile service inventories rather than a fixed model registry, and neither depends on a Hugging Face token.

## Official source semantics

The Model Mapping API records a relationship between:

- an exact Hugging Face repository ID;
- a provider;
- the provider's own model ID;
- a task;
- a `live` or `staging` state.

Hugging Face describes `live` mappings as publicly available mappings registered by an inference provider. It separately exposes whether a model is currently warm, so `live` must not be interpreted as preloaded or latency-guaranteed. See the [Model Mapping API](https://huggingface.co/docs/inference-providers/en/register-as-a-provider) and [Hub API](https://huggingface.co/docs/inference-providers/en/hub-api).

The public `GET /v1/models` endpoint lists OpenAI-compatible chat models and routes whose documented state is `live` or `error`, with optional pricing, context, capability, latency, and throughput facts. Only a live route establishes current presence. An error route is still a valid response shape, so Kmodels ignores it instead of rejecting the whole refresh or publishing stale route facts. HF Inference's mapping supplies the complementary task-specific models served by Hugging Face's own serverless service.

## Kmodels representation

A Hugging Face `ProviderModel` exists when the exact repository ID appears in either the router catalog or the concrete HF Inference `live` mapping. Its canonical `model_id` is the exact `namespace/repository` value accepted by Hugging Face clients.

The list excludes:

- repositories that are merely downloadable from the Hub;
- staging, private, or account-scoped mappings and router models with no live route;
- parameterized `tag-filter` contracts without a concrete model ID;
- model IDs inferred from names, owners, tags, popularity, or repository metadata;
- provider-internal IDs promoted to canonical Hugging Face IDs;
- models present only in a third-party provider's bulk mapping.

A community repository may still appear when Hugging Face itself lists it in the router or HF Inference service. The boundary is the operated service, not publisher popularity or an inferred owner allowlist.

## Route evidence

`source_refs` proves which sources observed a model but cannot represent the mapping itself. Each mapping is therefore retained in `routes` instead of being reduced to a broad normalized type:

For example:

```json
{
  "model_id": "sentence-transformers/all-MiniLM-L6-v2",
  "routes": [
    {
      "source_ref": "huggingface-hf-inference",
      "provider": "hf-inference",
      "provider_model_id": "sentence-transformers/all-MiniLM-L6-v2",
      "task": "sentence-similarity",
      "status": "live"
    }
  ]
}
```

The router is an independent row-creating chat catalog. Every accepted row receives the router's documented `/v1/chat/completions` endpoint; only live backends contribute presence, route-conditioned pricing, the maximum advertised context, and conservative capability aggregates. A route cannot be both explicitly free and nonzero-priced. The router does not publish a provider model ID, so Kmodels does not invent one or reconstruct a join to the removed partner inventories. Volatile latency and throughput probes remain outside the stable catalog.

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

Exact router membership is the strongest deterministic evidence for Kong's OpenAI-compatible chat capability. Task-specific and native compatibility instead uses the retained HF Inference mapping route.

The provider must not be labeled Kong-compatible as a unit. `source_refs` alone is also insufficient: compatibility requires router membership or a retained HF Inference route with its provider model ID and raw task.

Any Kmodels compatibility projection must derive Kong support as a versioned capability relation, not a property of the Hugging Face provider or of the broad normalized model type. Unknown or mismatched task/endpoint combinations remain unclassified rather than guessed.

## Refinement decision

The catalog uses an operated-service boundary rather than popularity or publisher heuristics:

1. Let `/v1/models` create the OpenAI-compatible chat catalog.
2. Let only the `hf-inference` concrete `live` mapping create task-specific rows.
3. Validate documented `error` routes but publish facts only from live routes.
4. Validate dynamic tag filters as exact LoRA contracts without turning them into rows.
5. Do not fetch or publish third-party partners' bulk mapping inventories.
6. Preserve the exact HF Inference provider model ID and raw task.
7. Require Kong compatibility to match its version, capability, upstream endpoint, provider route, and raw task.
8. Do not infer support for an operation merely because another Kong provider supports that operation family.

The pricing representation is unchanged in this provider turn. Router backend rates remain separate, route-conditioned observations in the current flat schema; `docs/pricing.md` remains a repo-wide migration proposal until coherent offers are implemented across all providers.
