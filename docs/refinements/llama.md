# Meta Llama refinement

Status: implemented and revalidated against live official sources on 2026-07-23

## Catalog assessment

The current official CLI registry still yields 48 exact downloadable artifacts: 38 generative weights, seven Llama Guard moderation models, and three Prompt Guard classifiers. Variant-specific descriptors remain separate rows, every row retains its exact Hugging Face repository alias, and downloadable pricing remains `not_applicable`.

Thirty-eight artifacts have an official release date; ten safety artifacts do not. No configured source publishes a separate artifact update date. The optional hosted Llama API inventory was skipped, so account availability remains unknown and cannot define global artifact presence.

The public `llama-api-python` examples currently name one exact hosted ID, `Llama-4-Maverick-17B-128E-Instruct-FP8`. It resolves uniquely to the FP8 Maverick registry artifact. The fixed client and resource code prove `/v1/chat/completions`; the examples prove streaming, structured output, and tool calling only for that exact hosted alias. The other 47 artifacts receive no inferred hosted endpoint.

## Kong AI Gateway 2.0

The Kong source of truth is `app/ai-gateway/ai-providers/llama.md` and the Llama2 entry in `app/_data/ai-gateway/v2/providers.yaml`.

Kong's Llama provider is user-defined: it supports chat generation, completions, and embeddings against an operator-configured upstream. A registry descriptor such as `Llama-3-70B-Instruct` does not prove the server's served name, request format, quantization, or deployment availability. Kong intentionally documents `User-defined` model examples and requires an `upstream_url`.

Kmodels has no Llama embedding artifact in this source, and moderation/classification artifacts are outside Kong's Llama capability matrix. Meta's hosted `/v1/chat/completions` route is also not evidence for an operator's Kong upstream. No one-to-one Kong compatibility list can be derived without a runtime deployment binding.

## Refinement decision

1. Keep the exhaustive CLI registry as publisher metadata and fail closed on unknown family-key shapes instead of inheriting broad prefix rules.
2. Resolve every fixed hosted example ID exactly and reject unresolved or ambiguous identities; never silently discard a new example model.
3. Publish the exact Meta-hosted Chat Completions endpoint and capabilities only on the uniquely matching artifact.
4. Do not label registry rows as directly Kong-callable. A future runtime/deployment relation must retain configured model name, format, upstream, operation, availability, and artifact link.
5. Keep downloadable pricing `not_applicable`; do not invent or import a hosted price that the configured official sources do not publish.
