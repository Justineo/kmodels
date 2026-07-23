# Vercel AI Gateway refinement

Status: refined against catalog snapshot `2026-07-22T17:04:19.221Z`, the current public Gateway API, and Kong AI Gateway 2.0

## Catalog assessment

The 306 rows are reasonable for Vercel's exhaustive global Gateway catalog. Every row uses the exact two-segment Gateway request ID and has a separately observed display name, modalities, and release date. The snapshot contains 296 active, six preview, and four deprecated rows; 19 expose multiple operation types.

The operation distribution covers 204 generation models plus embeddings, image, video, speech, transcription, rerank, moderation, and realtime. Fifty-five rows have direct published pricing, 238 contain exact derived normalized rates, and 13 explicitly have no published machine-readable price. Route telemetry is intentionally excluded from stable model rows.

## Kong AI Gateway 2.0

The Kong source of truth is `app/ai-gateway/ai-providers/vercel.md` and the Vercel entry in `app/_data/ai-gateway/v2/providers.yaml`.

Kong supports only streaming generation through Vercel's `/v1/chat/completions`. The exact Kmodels Gateway ID is the right identity for this upstream. The Kong example `openai/gpt-5.5` is active and also advertises realtime capability, but Kong's Vercel adapter uses only its chat route.

Non-generation rows and operation-specific image, audio, video, embedding, rerank, or realtime surfaces are not supported by this Kong provider. A multi-type row is compatible only through its independently observed generation route.

## Refinement decision

1. Keep the exhaustive Gateway catalog and route-independent pricing facts.
2. Project only active or preview models with explicit chat-generation evidence to Kong.
3. Do not infer support for other Vercel Gateway operations from their presence in Kmodels.
4. Continue keeping volatile endpoint telemetry out of `ProviderModel`.

## Implemented outcome

- Extended the strict Gateway pricing boundary for the observed audio-token, realtime client-message, and realtime session-duration fields. Audio rates normalize to their directional token meters; directionless realtime charges retain dedicated meters and native request/second units.
- Kept unknown pricing keys fail-closed so a future unreviewed field still rejects Vercel atomically.
- Kept coverage warnings derived from the models actually being published, including the last validated Vercel catalog when a refresh falls back to stale data.
