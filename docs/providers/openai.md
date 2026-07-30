# OpenAI

Status: current

## Sources and identity

- `/api/docs/models/all` is the exhaustive global catalog. Follow only 80–140 exact same-host model-card links.
- Accept IDs, aliases, snapshots, facts, endpoint cards, and prices only from the matching card. Disabled cards add no evidence; an unknown endpoint label/path rejects the provider.
- `/api/docs/models` is alias-only. `/api/docs/deprecations` is lifecycle-only; “legacy” alone is not deprecation.
- Authenticated `GET /v1/models` is account-scoped validation. Private rows and absence never change the global catalog, and raw responses are not retained.
- Enable the optional inventory with `OPENAI_API_KEY`.

## Mapping

- Chat, Responses, Completions, and Assistants are `text_generation`; their exact routes remain distinct. Realtime maps to its result semantics, not a task named realtime.
- Keep enabled endpoint labels and relative paths in `api_endpoints`. Batch and Fine-tuning endpoints do not widen model tasks.
- Keep direct text, audio, image, embedding, per-image, per-second, and per-minute prices in native units. Explicit transcription-duration pricing is audio input. Realtime audio-duration pricing is input audio for transcription and translation, and output audio for speech synthesis or Speech to Speech. Batch is a tier condition.
- Derive long-context and cache-write prices only from published multipliers with decimal-string arithmetic.
- Explicit open-weight and free moderation models use `not_applicable`; absent or unparseable hosted prices remain `unknown`.

## Kong AI Gateway

- Derive compatibility endpoint by endpoint; broad `text_generation` does not distinguish Chat Completions, Completions, Responses, or Assistants.
- Kong covers generation, completions, embeddings, files, batches, assistants/responses, speech, transcription, translation, image, realtime, and video. Moderation is outside its current OpenAI matrix.
- Files and batches are service-level operations. Agent behavior stays in endpoint and capability evidence.
- Treat Kong examples as configuration examples, not recommendations or lifecycle evidence.
