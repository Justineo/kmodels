# OpenAI refinement

Status: revalidated against the live public catalog, authenticated inventory, and Kong AI Gateway 2.0 on 2026-07-23

## Catalog assessment

The 93 rows are plausible for an exhaustive model catalog that retains active, deprecated, and retired request IDs, snapshots, and aliases across text, agentic, embeddings, audio, image, realtime, video, and moderation. The snapshot contains 43 active, 40 deprecated, and ten retired rows; 19 rows expose multiple operation types.

Eighty-seven rows have published prices, five open-weight or free-service rows use `not_applicable`, and one row remains unknown. Twenty-one rows lack context limits. The authenticated account inventory now succeeds and returns 131 IDs; exact IDs or aliases match 77 public rows. It remains scoped validation: account-only IDs do not create global rows, and absence does not imply deprecation.

The provider-page endpoint cards are strong operation evidence. Their exact endpoint identity should be retained, not only the normalized `types` union.

## Kong AI Gateway 2.0

The Kong source of truth is `app/ai-gateway/ai-providers/openai.md` and the OpenAI entry in `app/_data/ai-gateway/v2/providers.yaml`.

Kong supports generation, legacy completions, embeddings, files, batches, assistants/responses, speech, transcription, translation, image, realtime, and video. Moderation is present in Kmodels but absent from the Kong provider matrix. Files and batches are service-level operations rather than model categories.

Several Kong examples have lifecycle drift in the reviewed OpenAI catalog: `gpt-4o`, `gpt-image-1.5`, `gpt-4o-realtime-preview`, and `sora-2` are deprecated. `gpt-4o-mini`, `text-embedding-3-small`, `tts-1`, and `whisper-1` remain active. The examples still demonstrate configuration shape but must not serve as a current recommendation list.

The broad `generate` type cannot distinguish chat completions, legacy completions, or Responses. `agentic` captures some Responses/Assistants evidence but does not replace the exact endpoint matrix.

## Refinement decision

1. Keep the full lifecycle catalog and all exact pricing meters.
2. Retain per-model endpoint support and derive Kong matches endpoint by endpoint.
3. Exclude moderation from the Kong 2.0 intersection.
4. Flag deprecated examples and keep account inventory evidence scoped and non-creating.

Implementation outcome: enabled model endpoint cards now publish their exact official labels and API paths in `api_endpoints`. Unknown label/path pairs fail the OpenAI refresh, disabled cards remain excluded, and Batch or Fine-tuning route evidence does not widen provider-neutral model `types`. The website exposes the retained routes in model details, providing the missing evidence needed for a future Kong endpoint-level intersection without publishing a premature compatibility boolean.
