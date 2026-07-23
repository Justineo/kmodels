# Kimi refinement

Status: reviewed against catalog snapshot `2026-07-22T17:04:19.221Z` and Kong AI Gateway 2.0

## Catalog assessment

Nineteen rows are reasonable as the union of current OpenAPI model discriminators, current and retired model tables, pricing tables, and exact changelog matches. The snapshot contains four active, seven deprecated, seven retired, and one unknown-state row. All are generation models.

Eleven rows have published CNY pricing and eight historical or unmatched rows remain unknown. The pricing model correctly keeps cached input, uncached input, output, and Batch tiers separate. The catalog is not declared exhaustive, and the authenticated account inventory was skipped.

## Kong AI Gateway 2.0

The Kong source of truth is `app/ai-gateway/ai-providers/kimi.md` and the Kimi entry in `app/_data/ai-gateway/v2/providers.yaml`.

Kong supports streaming generation through `/v1/chat/completions`. This aligns directly with Kmodels' operation family and OpenAPI identity source. The Kong example `kimi-k2.6` is active in the reviewed catalog.

Historical and unknown-state IDs remain useful lifecycle facts but are not current Kong candidates. A model appearing only on a pricing or retired-model page must not be treated as currently callable.

## Refinement decision

1. Keep all independently observed source references and lifecycle history.
2. Use current OpenAPI chat-completions membership plus active/preview state as the strongest Kong evidence.
3. Leave account availability and non-exhaustive completeness explicit.
4. Preserve CNY and pricing conditions without conversion or cross-provider inheritance.
