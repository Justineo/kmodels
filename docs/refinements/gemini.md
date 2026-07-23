# Gemini API refinement

Status: reviewed against the live Gemini API catalog and current Kong AI Gateway provider documentation on 2026-07-23

## Catalog assessment

The 73 rows are plausible because the exhaustive official catalog includes model codes, agent codes, rolling aliases, previews, and lifecycle history across language, embeddings, Live, image, video, speech, translation, and music generation. The live result contains 12 active, 16 preview, 14 deprecated, and 31 retired rows. Twelve rows expose multiple operation types.

Forty rows have published prices and 33 remain unknown. Sixty-eight rows have release dates and 39 have explicit update dates. The exact current Interactions support table supplies `/v1beta/interactions` route evidence for 19 rows. Requests pin English because the official site localizes the table labels used as structural boundaries.

The authenticated inventory currently returns 56 models. Its live response omits `baseModelId` even though the reference marks that field required; Kmodels therefore treats it as optional, keeps the exact `name` authoritative, and adds no alias when it is absent. Only exact `supportedGenerationMethods` values reviewed against the official method table and WebSocket reference produce endpoint, operation, streaming, or batch facts. An absent list or unknown method remains non-evidence and keeps method-derived negative capability claims unknown rather than being classified by spelling.

## Kong AI Gateway 2.0

The Kong source of truth is `app/ai-gateway/ai-providers/gemini.md` and the Gemini entry in `app/_data/ai-gateway/v2/providers.yaml`.

Kong supports generation, embeddings, files, batches, image, realtime, video, and native Gemini APIs. Files and batches are service-level capabilities. Kmodels agentic, audio-speech, audio-translation, and music-generation rows are not automatically supported by this matrix.

Exact API method evidence matters: `generateContent`, `embedContent`/`batchEmbedContents`, `BidiGenerateContent`, and `predictLongRunning` are not interchangeable even when a model has several modalities. Kong's native-format table currently spells the batch embedding method `batchEmbedContent`, while the provider's current REST method is `batchEmbedContents`; this drift must not be normalized into false evidence.

All named Kong examples have drifted relative to the reviewed Gemini API catalog: `gemini-2.5-flash` is deprecated, `text-embedding-004` is retired, and the documented image, realtime, and `veo-3.1-generate-001` IDs are absent. Current official rows use newer IDs such as `gemini-embedding-2`, Gemini 3.x image/Live models, and `veo-3.1-*-generate-preview`. This is a high-priority documentation cross-check, not permission to alias the old IDs.

## Refinement decision

1. Keep the full current and historical catalog.
2. Preserve reviewed supported methods as exact endpoint evidence and derive Kong compatibility from the exact method.
3. Exclude unsupported operation families without deleting provider facts.
4. Flag every stale or missing Kong example until provider or Kong documentation supplies an exact relationship.
