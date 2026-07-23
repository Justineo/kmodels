# Vertex AI refinement

Status: reviewed against catalog snapshot `2026-07-22T17:04:19.221Z` and Kong AI Gateway 2.0

## Catalog assessment

The 100 rows are plausible for the union of regional Google, partner, and managed open-model catalogs. The snapshot contains 46 active, 15 preview, 19 deprecated, and 20 retired rows. Fifteen rows expose multiple operation types; 56 rows have published prices and 44 remain unknown.

This is a non-exhaustive regional Vertex catalog. It intentionally includes Gemini, Imagen, Veo, Claude, Grok, Mistral, Llama, and other managed models. The optional Model Garden API inventory now authenticates successfully for the configured project. Its earlier transport failure was a request bug: Kmodels asked for 1,000 items while the live service accepts at most 300. The collector now uses that maximum, follows `nextPageToken`, and treats an omitted repeated model field as an empty page; publisher-resource lifecycle remains scoped validation rather than global presence.

The public catalogs now pin English, retain exact publisher families, and validate their family-specific inference guides before publishing positive endpoints. Google cards retain `generateContent`, `embedContent`, `predict`, or `predictLongRunning` only from the corresponding reviewed family relation. Claude retains `rawPredict` and `streamRawPredict`; Grok and Llama retain their exact OpenAI-compatible route and API version. A managed open model receives Chat Completions only from a sample that contains its exact publisher-qualified ID and route together. Mistral partner cards, unlisted managed open models, and Live/Realtime Google cards remain without endpoint evidence rather than inheriting one from `generate`.

## Kong AI Gateway 2.0

The Kong source of truth is `app/ai-gateway/ai-providers/vertex.md` and the Gemini Vertex entry in `app/_data/ai-gateway/v2/providers.yaml`.

Kong's provider is Gemini Vertex, not a generic adapter for every model sold through Vertex AI. It supports Gemini-style generation/completions, embeddings, files, batches, image, video, and native Gemini APIs including generation, embedding, long-running prediction, ranking configuration, and batch prediction paths.

Partner and open-model rows do not become compatible merely because they are `generate`. Compatibility requires the publisher/API family and the exact Vertex method used by that model. Region remains part of the relation.

The Kong examples `gemini-2.5-flash`, `text-embedding-004`, and `veo-3.1-generate-001` are active in the reviewed Vertex catalog. The current Google cards directly retain `generateContent` for `gemini-2.5-flash` and `predictLongRunning` for Veo. `text-embedding-004` is lifecycle-only in the current card set, so it does not inherit the newer embedding card's `embedContent` route. Kong's image example is absent, so that exact ID requires documentation follow-up rather than alias inference.

## Refinement decision

1. Keep all regional Google, partner, and open-model rows.
2. Retain publisher, API family, exact method, and region as compatibility evidence; absence remains unknown.
3. Project only the Gemini Vertex-compatible subset; do not label all 100 rows as Kong-supported.
4. Treat files, batches, and ranking configurations as service-level/native operations where no model row is selected.
