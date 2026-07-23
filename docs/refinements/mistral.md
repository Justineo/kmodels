# Mistral AI refinement

Status: implemented and revalidated against live official sources on 2026-07-23

## Catalog assessment

The official index currently imports 62 model definitions and yields 59 callable observations. Two definitions intentionally describe different operation surfaces of the same `voxtral-mini-2507@25.07` tuple, so the normal source merge produces 58 provider rows: 16 active, one preview, 20 deprecated, and 21 retired. Definitions without an API name remain documentation entries rather than invented callable IDs.

The live replay contains 47 generation, two embedding, four transcription, one speech, four OCR, two moderation, one realtime, and ten agentic rows, with overlap. Forty-six rows publish 136 exact endpoint facts across ten endpoint kinds; 12 historical rows publish no positive endpoint evidence. Release dates remain source fields, while the repository still publishes no separate model update date.

The authenticated model inventory was skipped, so account visibility and base-model validation remain unknown.

## Kong AI Gateway 2.0

The Kong source of truth is `app/ai-gateway/ai-providers/mistral.md` and the Mistral entry in `app/_data/ai-gateway/v2/providers.yaml`.

Kong supports chat generation and embeddings through standard or user-defined paths. The aliases `mistral-large-latest` and `mistral-embed` resolve to active exact rows, so the capability-table examples remain valid. The configuration example still uses `mistral-tiny`, which the current Mistral catalog no longer publishes as an ID or alias; Kmodels does not retain it from Kong documentation.

Mistral transcription, speech, OCR, moderation, realtime, FIM, Batch, and agentic operations are outside this Kong matrix. A broad `generate` type does not prove chat compatibility; only the exact `Chat / Completions` endpoint does. Function calling additionally requires the model's positive tool-call capability.

## Refinement decision

1. Keep the structured API IDs, versions, aliases, lifecycle rows, native prices, and non-Kong operations.
2. Fetch the official feature schema and endpoint registry in the same atomic bundle. Resolve every used model feature through that graph and publish the exact provider label/path in `api_endpoints`.
3. Reject an undeclared used feature, dangling endpoint reference, invalid relative path, or contradictory explicit-free price instead of silently degrading the catalog.
4. Derive Kong candidates only from active/preview rows with exact `/v1/chat/completions` or `/v1/embeddings` evidence; do not use normalized type alone.
5. Keep the skipped authenticated inventory and missing update-date coverage visible.
