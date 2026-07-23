# Kimi refinement

Status: reviewed against catalog snapshot `2026-07-22T18:03:01.176Z`, current Kimi OpenAPI, and current Kong AI Gateway provider documentation

## Catalog assessment

Nineteen rows are reasonable as the union of current OpenAPI model discriminators, current and retired model tables, pricing tables, and exact changelog matches. The snapshot contains four active, seven deprecated, seven retired, and one unknown-state row. All are generation models. The twelve IDs in the OpenAPI discriminator receive the exact `/v1/chat/completions` route; rows observed only in historical or pricing sources do not inherit it.

Eleven rows have 36 published CNY rates and eight historical or unmatched rows remain unknown. The pricing model correctly keeps cached input, uncached input, output, and Batch tiers separate. The catalog is not declared exhaustive. The authenticated inventory currently returns 12 models from the documented international `api.moonshot.ai` origin; the same key receives `401` from the older `.cn` origin, so Kmodels no longer sends it there. Its support flags are sparse positive facts, so omitted image, video, or reasoning fields remain unknown rather than false.

## Kong AI Gateway 2.0

Kong's current official provider catalog has no Kimi entry, and its provider source directory has no `kimi.md`.

Kimi documents an OpenAI-compatible streaming route, but protocol compatibility is not evidence that Kong's OpenAI provider accepts Kimi identities or targets Kimi's upstream. Therefore no Kimi row is currently a Kong-native candidate.

## Refinement decision

1. Keep all independently observed source references and lifecycle history.
2. Attach the Chat Completions route only to exact current OpenAPI members.
3. Report no Kong-native intersection until Kong publishes one.
4. Leave account availability and non-exhaustive completeness explicit.
5. Preserve CNY and pricing conditions without conversion or cross-provider inheritance.
