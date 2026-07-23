# Mistral AI refinement

Status: reviewed against catalog snapshot `2026-07-22T17:04:19.221Z` and Kong AI Gateway 2.0

## Catalog assessment

The 58 rows are reasonable for Mistral's exhaustive structured documentation repository because it retains versioned current, Labs, deprecated, and retired API definitions. The snapshot contains 16 active, one preview, 20 deprecated, and 21 retired rows. Thirteen rows expose multiple operation types.

The catalog includes 47 generation, two embedding, four transcription, one speech, four OCR, two moderation, one realtime, and ten agentic observations, with overlap. Forty-six rows have published prices and 12 remain unknown. Exact release dates are complete; Mistral does not publish distinct update dates for most rows.

The authenticated model inventory was skipped, so account visibility and base-model validation remain unknown.

## Kong AI Gateway 2.0

The Kong source of truth is `app/ai-gateway/ai-providers/mistral.md` and the Mistral entry in `app/_data/ai-gateway/v2/providers.yaml`.

Kong supports chat generation and embeddings through standard or user-defined paths. The aliases `mistral-large-latest` and `mistral-embed` resolve to active exact rows in Kmodels, so both Kong examples remain valid.

Mistral transcription, speech, OCR, moderation, realtime, and agentic operations are outside this Kong matrix. Some rows normalized as `generate` may support only a specific endpoint such as FIM; the structured endpoint feature list must be retained to prove chat-completions compatibility.

## Refinement decision

1. Keep the structured API IDs, versions, aliases, and lifecycle rows.
2. Derive Kong candidates only from active/preview rows with exact chat or embedding endpoint support.
3. Exclude the other operation families from the Kong projection without narrowing the provider catalog.
4. Keep the skipped authenticated inventory and sparse update-date coverage visible.
