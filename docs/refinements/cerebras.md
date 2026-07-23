# Cerebras refinement

Status: implemented and replayed against catalog snapshot `2026-07-22T17:04:19.221Z`, the current Cerebras API references, and the current Kong Cerebras provider documentation

## Catalog assessment

The catalog remains a lifecycle union of 15 exact IDs: one active, two preview, and 12 deprecated. Historical IDs remain useful evidence but are not current deployment candidates. The three current rows are independently present in the public model API and Model Catalog; the catalog's Production/Preview sections own lifecycle when the public API flags disagree.

All rows are generation models. The three current rows publish context limits and direct input/output rates, and the prompt-cache policy establishes a derived cache-read rate equal to standard input. Historical rows retain unknown price and context rather than inheriting facts from another host of the same open-weight model.

## Endpoint and Kong compatibility

Current model cards list exact endpoint labels. The collector accepts only `Chat Completions` and `Completions` and binds those labels to exact paths validated from the fixed official API references:

- all three current models publish `v1/chat/completions`;
- `gemma-4-31b` additionally publishes `v1/completions`;
- lifecycle-only historical rows publish no endpoint evidence.

The current Kong provider supports Cerebras chat completions at `/v1/chat/completions`, including streaming, and now uses `gpt-oss-120b` in its example. The earlier `llama-3.3-70b` example is no longer current Kong documentation.

A current Kong candidate therefore requires:

1. active or preview lifecycle;
2. exact `Chat Completions` endpoint evidence;
3. positive streaming capability; and
4. visibility in the user's authenticated account.

The first three conditions are satisfied by `gpt-oss-120b`, `gemma-4-31b`, and `zai-glm-4.7` in the public snapshot. Account visibility remains unknown until the optional authenticated inventory succeeds.
