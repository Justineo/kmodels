# Anthropic refinement

Status: reviewed against catalog snapshot `2026-07-23T10:34:12.053Z` and Kong AI Gateway 2.0

## Catalog assessment

The 30-row public catalog is the right boundary: ten models are active, one is deprecated but not yet retired, and 19 are retained historical IDs. Fourteen rows have published prices and context limits. The successful account-scoped Models API matched ten public canonical IDs and added structured limits, capabilities, and release times, raising exact release-date coverage to 11 rows. Its absence or account-specific membership must never remove a public row.

The three API operation pages repeat the same generated 16-value `Model` type. That type is not operation-specific evidence: the Text Completions page repeats current model IDs while explicitly warning that future models and features are incompatible with the legacy API. Treating the shared enum as a compatibility matrix previously overclaimed `/v1/complete` and attached batch support to a retired model.

The most direct current contracts are simpler. The model overview identifies current Claude API models, the Messages reference fixes `POST /v1/messages`, and the batch guide explicitly states that every active model supports Message Batches. The resulting catalog has Messages on the ten active rows plus the one callable deprecated row, batches on the ten active rows, and no current endpoint on retired rows. There is no model-level `/v1/complete` claim without a current official compatibility list.

## Kong AI Gateway 2.0

The Kong source of truth is `app/ai-gateway/ai-providers/anthropic.md` and the Anthropic entry in `app/_data/ai-gateway/v2/providers.yaml`.

Kong supports Messages generation, legacy Completions, native message batches, and the native Anthropic format. Service-level support for the legacy route does not prove that a current Anthropic model accepts it. Kong candidate selection should therefore use active or preview rows with positive Messages or batch endpoint evidence, not the generic `generate` type and not `/v1/complete`.

The Kong example `claude-sonnet-4-20250514` remains a retired provider model. That is documentation-example drift, not current deployability evidence.

## Refinement decision

1. Preserve all 30 current and historical official IDs.
2. Use lifecycle state plus explicit public API contracts for endpoint support; ignore the shared generated SDK enum as an operation matrix.
3. Publish Messages for active, preview, and callable deprecated rows; publish batches only for active or preview rows; publish no legacy completion binding.
4. Keep the authenticated Models API optional, account-scoped, non-creating, and non-persisted.
5. Load an ignored local `.env` in the standard collection command so configured validation inventories actually run, while process and CI environment variables retain precedence.
