# Vercel AI Gateway

Status: current

## Sources and identity

- Unauthenticated `GET https://ai-gateway.vercel.sh/v1/models` is the exhaustive global catalog and sole model source.
- Require the exact envelopes, 250–600 valid items, a two-segment `creator/model` ID whose creator matches `owned_by`, and reviewed values for semantic tags, parameters, specifications, video operations, regions, and pricing fields. One malformed item rejects the provider so new source vocabulary cannot silently disappear.
- Do not collect per-model route telemetry into stable rows. A future route resource must remain separate from `ProviderModel`.

## Mapping

- Structured type is primary task evidence. Exact capability tags may add task semantics.
- A present `supported_parameters` list is explicit positive and negative evidence for reasoning and tool calling. Reasoning options additionally disclose effort control. Other capabilities remain unknown unless the model payload has direct evidence.
- Realtime and WebSocket tags are positive realtime-delivery evidence. Bidirectional audio is `speech_to_speech`; realtime transcription remains `transcription`.
- Top-level modalities remain authoritative except that video `input_limits` add explicit image, video, or audio inputs omitted by the summary modalities.
- Zero limits are omitted. `max_tokens` becomes an output-token limit only for language and realtime models; input limits on embedding, reranking, image, video, speech, and transcription rows never become output limits.
- `released` is release date. `deprecated_at` changes lifecycle when effective. Catalog `created` is not an update date.
- `regions` publishes regional-inference availability. It does not imply account access.
- Preserve every native price and condition. Scale token decimals exactly; keep non-token units.
- Preserve nested regional and fast prices as `region` and `service_tier` alternatives. When regional alternatives exist, label the unqualified companion `default`; retain identical regional amounts because the routing condition is still distinct.
- Convert source-exclusive tier maxima to the canonical inclusive upper bound. Long-context tiers therefore meet at one exact token boundary without overlap.
- Use dedicated meters for directionless realtime messages/sessions. Collapse the duplicated transcription audio-input alias at the source boundary while keeping distinct text and audio rates.
- Treat an empty pricing object as `not_published`, not free. Per-route endpoint payloads are routing telemetry and do not repair missing catalog prices reliably.
- Unknown pricing keys fail closed. Coverage warnings describe the rows actually published, including fallback data.
- Keep knowledge cutoffs, temperature flags, interleaving metadata, AI SDK specification versions, detailed video dimensions/durations/file limits, and provider-route attributes at the source boundary because the canonical model has no faithful field for them. Validate their reviewed shapes rather than forcing them into unrelated fields.

## Kong AI Gateway

- Kong supports only streaming generation through `/v1/chat/completions`.
- Project active, acceptable-maturity rows with explicit chat-generation evidence.
- Image, audio, video, embedding, reranking, realtime, and other Vercel operations do not become Kong support. Multi-task rows qualify only through independent chat evidence.
