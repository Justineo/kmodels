# Anthropic refinement

Status: reviewed against catalog snapshot `2026-07-22T17:04:19.221Z` and Kong AI Gateway 2.0

## Catalog assessment

Thirty rows are reasonable because the exhaustive official catalog deliberately retains retired dated models alongside current IDs and aliases. The snapshot contains ten active, one deprecated, and 19 retired rows; all are text-generation models. Fourteen rows have published prices and 16 historical rows do not. Release-date coverage is sparse: only two exact callable rows have an independently observed official date.

The website bundle is the correct global authority for IDs, lifecycle, replacements, limits, and price tiers. The optional authenticated `/v1/models` inventory was skipped, which affects only account-scoped validation. It must not remove public or historical rows.

The three current API references each publish the same 16 accepted request identifiers. Exact canonical/alias resolution collapses those identifiers onto 12 catalog rows. This direct evidence takes precedence over assuming that the legacy Completions endpoint accepts only old model generations; the remaining historical rows have no current positive endpoint evidence.

## Kong AI Gateway 2.0

The Kong source of truth is `app/ai-gateway/ai-providers/anthropic.md` and the Anthropic entry in `app/_data/ai-gateway/v2/providers.yaml`.

Kong supports Messages generation, legacy Completions, native message batches, and the native Anthropic format. It does not support Anthropic embeddings or media operations. Kmodels currently normalizes both Messages and legacy completion models to `generate`, so that type alone cannot select the correct Kong upstream.

The Kong example `claude-sonnet-4-20250514` is present but retired in the reviewed provider catalog. That is documentation-example drift, not a reason to keep treating the example as currently deployable.

## Refinement decision

1. Preserve all 30 rows as current plus historical provider facts.
2. Retain exact endpoint support for `/v1/messages`, `/v1/complete`, and message batches instead of deriving it from `generate`.
3. Derive current Kong candidates only from active or preview rows with positive endpoint evidence.
4. Keep authenticated API absence and sparse dates as visible coverage gaps.
