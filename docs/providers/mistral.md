# Mistral AI

Status: current

## Sources and identity

- The exhaustive public bundle statically parses the official repository's model index, 55–90 imported definitions, feature schema, endpoint registry, and fixed cache/Batch references. Never execute remote code.
- Every import must resolve once. The first API name is canonical, later API names are aliases, and definitions without an API name do not create rows.
- A separately published version remains part of identity without changing `model_id`.
- Optional `/v1/models` is account-scoped. Ignore private fine-tunes; overlay only exact public base models or unambiguous aliases. It cannot create rows or retain raw data, and API `created` is not a release date.
- Enable the optional inventory with `MISTRAL_API_KEY`.

## Mapping

- Every used feature must exist and every endpoint key must resolve to a valid relative path. Unknown features, dangling references, invalid paths, or contradictory explicit-free prices reject the provider.
- Voice cloning is endpoint capability evidence for Audio Speech; it does not create a separate model task or price meter.
- Separate official definitions may share one exact API ID/version for different operations. Their model evidence and prices coalesce under that identity; minute rates retain `chat_completions` or `transcription` operation conditions so neither price overwrites the other.
- Batch is endpoint/delivery evidence, not a task. General text rows remain text generation even when retired definitions lose endpoints.
- Parse the repository's closed lifecycle vocabulary directly: `GA` is active/stable, `PublicPreview` is active/preview, and `Deprecated` and `Retired` retain their lifecycle meanings. Unknown values reject the provider.
- Preserve native token, character, duration, and page rates. Derive batch/cache rates only from published multipliers and explicit feature support with decimal-string arithmetic; publish the exact result while retaining the multiplier as evidence.

## Kong AI Gateway

- Candidates require active lifecycle, acceptable maturity, and exact Chat/Completions or Embeddings endpoint evidence.
- Function calling also requires positive tool-call capability.
- Transcription, speech synthesis, OCR, moderation, FIM, Batch, and agent endpoints remain outside the current Kong matrix.
- Do not restore absent aliases from Kong examples.
