# DeepSeek refinement

Status: reviewed against the live public catalog, authenticated inventory, and Kong AI Gateway provider reference on 2026-07-23

## Catalog assessment

Four active rows are reasonable because the official exhaustive Models & Pricing table publishes a deliberately small set of current and explicitly bound legacy request IDs. All four are generation models with context limits, structured capability facts, and direct cached-input, input, and output pricing. The snapshot contains 12 price rates and no unknown pricing.

The exact catalog IDs are authoritative. The catalog is collected atomically with the fixed official Chat Completions reference. Its exact POST `/chat/completions` operation, request-model enum, `stream`, `thinking`, and `reasoning_effort` fields add one positive endpoint plus streaming and effort-control facts to each current V4 row. The table's own thinking-mode row supplies reasoning support instead of a model-name assumption. The two legacy rows receive the route only through the pricing footnote's explicit mapping to Flash; their fixed reasoning modes are preserved, but they do not inherit effort control that the mapping does not state.

The dated update log adds dates only where it names an exact callable ID, leaving two rows without a model update date. The authenticated `/models` request succeeds and returns the two current V4 IDs. Its documented `owned_by` field is opaque non-empty metadata rather than a hard-coded provider sentinel; as a scoped overlay, it still cannot create or remove public rows.

## Kong AI Gateway 2.0

The Kong source of truth is `app/ai-gateway/ai-providers/deepseek.md` and the DeepSeek entry in `app/_data/ai-gateway/v2/providers.yaml`.

Kong supports streaming generation through `/v1/chat/completions`. DeepSeek's canonical API reference publishes the unversioned `/chat/completions` resource, while Kong's provider adapter deliberately uses the OpenAI-compatible versioned path. All four Kmodels rows now have exact Chat Completions and streaming evidence; the Kong example `deepseek-chat` is active.

Rolling IDs such as `deepseek-chat` still require current lifecycle and account checks; their underlying model revision must not be turned into a new request ID unless DeepSeek publishes one.

## Refinement decision

1. Keep the four exact IDs and current pricing model.
2. Require active lifecycle, exact Chat Completions evidence, and positive streaming support for the provider-level Kong intersection; account availability remains unknown.
3. Preserve legacy rows and replacement facts without treating another product version as an alias unless explicitly documented.

Implementation outcome: parsing now follows the fields that contribute public facts and no longer makes the refresh depend on the two otherwise-unused Chat Prefix/FIM feature cells. The beta FIM API and Anthropic-compatible interface remain documented source facts but are not published as bare endpoint paths because both require a distinct base URL that the current endpoint schema cannot bind. This avoids a lossy route claim rather than inventing a compatibility tuple.
