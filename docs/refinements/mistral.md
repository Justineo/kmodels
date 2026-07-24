# Mistral AI refinement

Status: implemented and revalidated against live official sources on 2026-07-23

## Catalog assessment

The official index currently imports 62 model definitions and yields 59 callable observations. Two definitions intentionally describe different operation surfaces of the same `voxtral-mini-2507@25.07` tuple, so the normal source merge produces 58 provider rows: 18 active, 19 deprecated, and 21 retired. Definitions without an API name remain documentation entries rather than invented callable IDs.

The live replay contains 47 text-generation, two embedding, four transcription, one speech-synthesis, four OCR, two moderation, and one classification observations, with overlap. Agent, realtime, FIM, and Batch remain endpoint or capability semantics instead of normalized operations. Forty-six rows publish 136 exact endpoint facts across ten endpoint kinds; 12 historical rows publish no positive endpoint evidence. Release dates remain source fields, while the repository still publishes no separate model update date.

The authenticated model inventory now succeeds. The latest response contains 60 base-model cards and matches 24 public rows by exact ID or unambiguous alias; account-only rows remain private scoped evidence and do not create global catalog rows.

## Kong AI Gateway 2.0

The Kong source of truth is `app/ai-gateway/ai-providers/mistral.md` and the Mistral entry in `app/_data/ai-gateway/v2/providers.yaml`.

Kong supports chat generation and embeddings through standard or user-defined paths. The aliases `mistral-large-latest` and `mistral-embed` resolve to active exact rows, so the capability-table examples remain valid. The configuration example still uses `mistral-tiny`, which the current Mistral catalog no longer publishes as an ID or alias; Kmodels does not retain it from Kong documentation.

Mistral transcription, speech synthesis, OCR, moderation, FIM, Batch, and agent endpoints are outside this Kong matrix. Broad `text_generation` does not prove chat compatibility; only the exact `Chat / Completions` endpoint does. Function calling additionally requires the model's positive tool-call capability.

## Refinement decision

1. Keep the structured API IDs, versions, aliases, lifecycle rows, native prices, and non-Kong operations.
2. Fetch the official feature schema and endpoint registry in the same atomic bundle. Resolve every used model feature through that graph and publish the exact provider label/path in `api_endpoints`.
3. Reject an undeclared used feature, dangling endpoint reference, invalid relative path, or contradictory explicit-free price instead of silently degrading the catalog.
4. Derive Kong candidates only from active rows with an acceptable release stage and exact `/v1/chat/completions` or `/v1/embeddings` evidence; do not use normalized operation alone.
5. Keep authenticated inventory evidence scoped and non-creating, and leave missing update-date coverage visible.
