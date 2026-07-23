# DeepSeek refinement

Status: reviewed against catalog snapshot `2026-07-22T17:04:19.221Z` and Kong AI Gateway 2.0

## Catalog assessment

Four active rows are reasonable because the official exhaustive Models & Pricing table publishes a deliberately small set of current and explicitly bound legacy request IDs. All four are generation models with context limits, structured capability facts, and direct cached-input, input, and output pricing. The snapshot contains 12 price rates and no unknown pricing.

The exact catalog IDs are authoritative. The dated update log adds dates only where it names an exact callable ID, leaving two rows without a model update date. The authenticated `/models` inventory was skipped, so account visibility is unknown but global presence is unaffected.

## Kong AI Gateway 2.0

The Kong source of truth is `app/ai-gateway/ai-providers/deepseek.md` and the DeepSeek entry in `app/_data/ai-gateway/v2/providers.yaml`.

Kong supports streaming generation through `/v1/chat/completions`. All four Kmodels rows belong to the matching operation family, and the Kong example `deepseek-chat` is active. This is one of the strongest direct provider matches in the catalog.

Rolling IDs such as `deepseek-chat` still require current lifecycle and account checks; their underlying model revision must not be turned into a new request ID unless DeepSeek publishes one.

## Refinement decision

1. Keep the four exact IDs and current pricing model.
2. Treat active chat-completions evidence as sufficient for the provider-level Kong intersection, with account availability remaining unknown.
3. Preserve legacy rows and replacement facts without treating another product version as an alias unless explicitly documented.
