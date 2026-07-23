# Meta Llama refinement

Status: reviewed against catalog snapshot `2026-07-22T17:04:19.221Z` and Kong AI Gateway 2.0

## Catalog assessment

The 48 rows are reasonable for Meta's exhaustive downloadable-artifact registry. They represent 38 generative artifacts, seven moderation models, and three classifiers, including quantized and variant-specific descriptors. All are active registry entries, all retain an exact Hugging Face repository alias, and all correctly use `not_applicable` hosted pricing.

This is a model-publisher catalog, not a hosted inference catalog. Ten artifacts lack an official release date and none has a separately published update date. The optional hosted Llama API inventory was skipped and cannot define global artifact presence.

## Kong AI Gateway 2.0

The Kong source of truth is `app/ai-gateway/ai-providers/llama.md` and the Llama2 entry in `app/_data/ai-gateway/v2/providers.yaml`.

Kong's Llama provider is user-defined: it supports generation, completions, and embeddings against an operator-configured upstream. A registry descriptor such as `Llama-3-70B-Instruct` does not prove the server's model name, request format, quantization, or deployment availability. The Kong documentation intentionally uses `User-defined` examples.

Kmodels has no Llama embedding artifact in this source, and moderation/classification artifacts are outside Kong's Llama capability matrix. No one-to-one Kong compatibility list can be derived from the 48 rows without a runtime deployment binding.

## Refinement decision

1. Keep the artifact registry as publisher metadata.
2. Do not label registry rows as directly Kong-callable.
3. Introduce a separate runtime/deployment relation if Kong Llama compatibility is needed, retaining configured model name, format, upstream, and artifact link.
4. Keep downloadable pricing `not_applicable`; do not attach hosted prices from another service.
