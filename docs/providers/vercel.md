# Vercel AI Gateway

Status: current

## Sources and identity

- Unauthenticated `GET https://ai-gateway.vercel.sh/v1/models` is the exhaustive global catalog and sole model source.
- Require the exact envelopes, 250–600 valid items, a two-segment `creator/model` ID whose creator matches `owned_by`, and only reviewed pricing fields. One malformed item rejects the provider.
- Do not collect per-model route telemetry into stable rows. A future route resource must remain separate from `ProviderModel`.

## Mapping

- Structured type is primary task evidence. Exact capability tags may add task semantics.
- Realtime and WebSocket are delivery evidence. Bidirectional audio is `speech_to_speech`; realtime transcription remains `transcription`.
- Zero limits are omitted. Non-generative input limits never become output limits.
- `released` is release date. `deprecated_at` changes lifecycle when effective. Catalog `created` is not an update date.
- Preserve every native price and condition. Scale token decimals exactly; keep non-token units.
- Preserve nested regional and fast prices as `region` and `service_tier` alternatives. Their unqualified companion is the reviewed default region or standard tier only when the explicit alternative differs.
- Convert source-exclusive tier maxima to the canonical inclusive upper bound. Long-context tiers therefore meet at one exact token boundary without overlap.
- Use dedicated meters for directionless realtime messages/sessions. Collapse the duplicated transcription audio-input alias at the source boundary while keeping distinct text and audio rates.
- Unknown pricing keys fail closed. Coverage warnings describe the rows actually published, including fallback data.

## Kong AI Gateway

- Kong supports only streaming generation through `/v1/chat/completions`.
- Project active, acceptable-maturity rows with explicit chat-generation evidence.
- Image, audio, video, embedding, reranking, realtime, and other Vercel operations do not become Kong support. Multi-task rows qualify only through independent chat evidence.
