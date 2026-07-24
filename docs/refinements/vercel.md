# Vercel AI Gateway refinement

Status: refined against catalog snapshot `2026-07-23T10:48:43.293Z`, the current public Gateway API, and Kong AI Gateway 2.0

## Catalog assessment

The 308 rows are reasonable for Vercel's exhaustive global Gateway catalog. Every row uses the exact two-segment Gateway request ID and has a separately observed display name, modalities, and release date. The lifecycle snapshot contains 304 active and four deprecated rows; ten rows separately carry preview maturity. Seven rows expose multiple normalized operations.

The operation distribution covers 206 text-generation models plus embeddings, image generation, video generation, speech synthesis, transcription, reranking, moderation, and speech-to-speech. Fifty-six rows have direct published pricing, 240 contain exact derived normalized rates, and 12 explicitly have no published machine-readable price. The 1,211 normalized rates retain their source units and conditions. Route telemetry is intentionally excluded from catalog model rows.

Vercel currently repeats the same audio-input token price in both `pricing.input` and `pricing.audio_input_token_cost` for two OpenAI transcription models. The generic field is documented for language and embedding inputs, while the typed field supplies the transcription audio rate. Emitting both as `input_audio` creates a duplicate semantic rate, so transcription uses the typed field once; language, embedding, and speech-to-speech models keep their distinct generic and audio prices.

## Kong AI Gateway 2.0

The Kong source of truth is `app/ai-gateway/ai-providers/vercel.md` and the Vercel entry in `app/_data/ai-gateway/v2/providers.yaml`.

Kong supports only streaming generation through Vercel's `/v1/chat/completions`. The exact Kmodels Gateway ID is the right identity for this upstream. The Kong example `openai/gpt-5.5` is active and also advertises realtime capability, but Kong's Vercel adapter uses only its chat route.

Non-generation rows and operation-specific image, audio, video, embedding, reranking, or realtime surfaces are not supported by this Kong provider. A multi-operation row is compatible only through its independently observed generation route.

## Refinement decision

1. Keep the exhaustive Gateway catalog and route-independent pricing facts.
2. Project only active models with an acceptable release stage and explicit chat-generation evidence to Kong.
3. Do not infer support for other Vercel Gateway operations from their presence in Kmodels.
4. Continue keeping volatile endpoint telemetry out of `ProviderModel`.

## Implemented outcome

- The strict Gateway pricing boundary covers audio-token, realtime client-message, and realtime session-duration fields. Audio rates normalize to their directional token meters; repeated transcription input aliases collapse at the source-field boundary, while distinct text and audio rates remain separate. Directionless realtime charges retain dedicated meters and native request/second units.
- Kept unknown pricing keys fail-closed so a future unreviewed field still rejects Vercel atomically.
- Kept coverage warnings derived from the models actually being published, including the last validated Vercel catalog when a refresh falls back to stale data.
