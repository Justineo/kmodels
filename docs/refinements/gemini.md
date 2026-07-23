# Gemini API refinement

Status: reviewed against catalog snapshot `2026-07-22T17:04:19.221Z` and Kong AI Gateway 2.0

## Catalog assessment

The 73 rows are plausible because the exhaustive official catalog includes model codes, agent codes, rolling aliases, previews, and lifecycle history across language, embeddings, Live, image, video, speech, translation, and music generation. The snapshot contains 12 active, 16 preview, 14 deprecated, and 31 retired rows. Twelve rows expose multiple operation types.

Forty rows have published prices and 33 remain unknown. Sixty-eight rows have release dates and 39 have explicit update dates. The optional authenticated model inventory was skipped; this removes scoped structured validation but does not weaken the global catalog.

## Kong AI Gateway 2.0

The Kong source of truth is `app/ai-gateway/ai-providers/gemini.md` and the Gemini entry in `app/_data/ai-gateway/v2/providers.yaml`.

Kong supports generation, embeddings, files, batches, image, realtime, video, and native Gemini APIs. Files and batches are service-level capabilities. Kmodels agentic, audio-speech, audio-translation, and music-generation rows are not automatically supported by this matrix.

Exact API method evidence matters: `generateContent`, `embedContent`/`batchEmbedContent`, `BidiGenerateContent`, and `predictLongRunning` are not interchangeable even when a model has several modalities.

All named Kong examples have drifted relative to the reviewed Gemini API catalog: `gemini-2.5-flash` is deprecated, `text-embedding-004` is retired, and the documented image, realtime, and `veo-3.1-generate-001` IDs are absent. Current official rows use newer IDs such as `gemini-embedding-2`, Gemini 3.x image/Live models, and `veo-3.1-*-generate-preview`. This is a high-priority documentation cross-check, not permission to alias the old IDs.

## Refinement decision

1. Keep the full current and historical catalog.
2. Preserve supported generation methods per model and derive Kong compatibility from the exact method.
3. Exclude unsupported operation families without deleting provider facts.
4. Flag every stale or missing Kong example until provider or Kong documentation supplies an exact relationship.
