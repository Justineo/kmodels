# Cerebras refinement

Status: implemented and replayed against the live public and authenticated APIs, current Cerebras documentation, and current Kong Cerebras provider documentation on 2026-07-23

## Catalog assessment

The catalog remains a lifecycle union of 15 exact IDs: one active, two preview, and 12 deprecated. Historical IDs remain useful evidence but are not current deployment candidates. The three current rows are independently present in the unauthenticated public model API, Model Catalog, and the configured authenticated account inventory; the catalog's Production/Preview sections own lifecycle when the public API flags disagree.

All rows are generation models. The three current rows publish context limits and direct input/output rates, and the prompt-cache policy establishes a derived cache-read rate equal to standard input. Model-card amounts are accepted only when they carry `/ M tokens` themselves or appear under the same component's exact `per million tokens` label. This covers both current structured forms while ignoring a conflicting stale prose price on the Gemma card. The structured public API retains its documented per-token denomination before exact decimal scaling and currently agrees with all three component values. Historical rows retain unknown price and context rather than inheriting facts from another host of the same open-weight model.

The separate Dedicated Endpoints page lists model families and Hugging Face weight repositories available for account-defined deployment. Those are not stable shared Cerebras request IDs and therefore do not create global rows. Free account credits are an allowance rather than a zero model price; dedicated capacity is negotiated and cannot be attached to a speculative shared ID in the current flat pricing schema.

## Endpoint and Kong compatibility

Current model cards list exact endpoint labels. The collector accepts only `Chat Completions` and `Completions` and binds those labels to exact POST paths validated from the fixed official API references:

- all three current models publish `v1/chat/completions`;
- `gemma-4-31b` additionally publishes `v1/completions`;
- lifecycle-only historical rows publish no endpoint evidence.

The current Kong provider supports Cerebras chat completions at `/v1/chat/completions`, including streaming, and now uses `gpt-oss-120b` in its example. The earlier `llama-3.3-70b` example is no longer current Kong documentation.

A current Kong candidate therefore requires:

1. active or preview lifecycle;
2. exact `Chat Completions` endpoint evidence;
3. positive streaming capability; and
4. visibility in the user's authenticated account.

All four conditions are satisfied by `gpt-oss-120b`, `gemma-4-31b`, and `zai-glm-4.7` in the current synchronized account. The global catalog deliberately keeps `account_availability: "unknown"`; the account-scoped confirmation is retained only as the `cerebras-api` source reference rather than turned into a fact about every account.

## Simplification decision

The two shared-service catalogs remain independent because they provide different authoritative facts and either can introduce a newly public exact ID. The implementation does not add a third pricing scraper or a dedicated-model allowlist. Instead, it tightens the two assumptions that could silently misclassify facts:

1. A model-card price must retain either its exact `/ M tokens` suffix or its enclosing component's exact `per million tokens` label before becoming a token rate.
2. A Completions label must still resolve to an exact POST request, not merely mention the same URL.

The repo-wide offer model in `docs/pricing.md` remains a proposal. Cerebras account credits, service tiers, and dedicated capacity should be modeled only when coherent offers replace the flat rate list across providers.
