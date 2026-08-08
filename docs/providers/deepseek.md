# DeepSeek

Status: current

## Sources and identity

- The exhaustive global catalog is the official [Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing) table. Callable IDs and facts come only from its model columns; compatibility names mentioned only in footnotes or history do not become current rows.
- Parse and validate every table row. Base URLs, beta feature support, and positive concurrency values are source-shape contracts even when the public model schema cannot represent their base-path or account-quota semantics.
- Lifecycle/replacements require an exact official footnote. Release/update dates require a valid dated log entry and exact callable ID. “Backward compatibility” establishes an update or alias observation, never a first release. A date-like model-version suffix such as `0731` is not sufficient release-date evidence by itself.
- Optional authenticated `/models` is account-scoped exact-schema validation. It may add API provenance to exact public matches but cannot create/remove rows or retain raw data. Enable it with `DEEPSEEK_API_KEY`.

## First-party commercial source graph

The catalog collector treats the price book and its accounting references as one atomic first-party bundle. Reviewed companions cover [Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion), [Responses](https://api-docs.deepseek.com/api/create-response), [token usage](https://api-docs.deepseek.com/quick_start/token_usage/), [context caching](https://api-docs.deepseek.com/guides/kv_cache/), [current balance](https://api-docs.deepseek.com/api/get-user-balance), [rate limits and isolation](https://api-docs.deepseek.com/quick_start/rate_limit/), [insufficient-balance errors](https://api-docs.deepseek.com/quick_start/error_codes/), the [Responses compatibility guide](https://api-docs.deepseek.com/guides/responses_api/), and the [Anthropic compatibility guide](https://api-docs.deepseek.com/guides/anthropic_api/).

All documents are public, exact URLs. Docusaurus companions under `/quick_start` and `/guides` keep their trailing slash because the slashless CDN objects serve the site root instead of the named documents. Deterministic HTML/schema extraction verifies the model enum, usage fields, cache semantics, account deductions, route mappings, and future-price notice. Missing documents, changed commercial claims, an unknown price row, a partially parsed model column, or an API-reference disagreement rejects the provider refresh. Third-party price books are never fallbacks.

## Public price normalization

- Current public pricing is per one million tokens. Each exact catalog model receives separate cache-hit input, cache-miss input, and output-token facts. The source formula is `tokens × price`; reasoning tokens are part of generated completion/output tokens rather than a separate rate.
- Context caching is automatic and enabled by default. Cache writes have no separately published write fee; input tokens are billed at either the cache-hit or cache-miss rate reported for the model. Cache construction takes seconds, operation is best-effort, and unused cache entries normally disappear within hours to days.
- The current price page announces a significant overall price increase but publishes neither its rates nor its effective date. Keep the six current rates active and record the future increase as unbound; the daily contract will fail again when the provider publishes actionable applicability or amounts.
- The Responses API executes server-side web search, but no separate web-search fee is published in the price book or Responses accounting documentation. Do not assume that absence means either free or token-only; retain an explicit unbound diagnostic.
- The Anthropic-compatible route maps `claude-opus*` to `deepseek-v4-pro`, maps `claude-haiku*` and `claude-sonnet*` to `deepseek-v4-flash`, and maps other unsupported model names to Flash. These are wildcard request-route mappings, not additional price-book model IDs. The current schema cannot safely publish them as exact aliases, so the mapping remains a visible unbound gateway requirement.

Live first-party validation on 2026-08-04 returns two callable models and six numeric price facts:

- `deepseek-v4-flash`: USD 0.0028 cache-hit input, USD 0.14 cache-miss input, and USD 0.28 output per million tokens.
- `deepseek-v4-pro`: USD 0.003625 cache-hit input, USD 0.435 cache-miss input, and USD 0.87 output per million tokens.

Reconciliation partitions 13 reviewed commercial items into six normalized price facts, four account/non-model exclusions, and three deliberately unbound items. There are no raw, ambiguous, unsupported, or unresolved items.

## Request usage and account cost

The API response supplies the quantities needed for an immediate list-price calculation, but not a monetary charge:

- Chat Completions returns `prompt_tokens`, `completion_tokens`, `total_tokens`, `prompt_cache_hit_tokens`, `prompt_cache_miss_tokens`, and `completion_tokens_details.reasoning_tokens`. For streaming, the gateway must request `stream_options.include_usage`; the additional final chunk carries usage for the entire request while ordinary chunks have `usage: null`.
- Responses returns `input_tokens`, `input_tokens_details.cached_tokens`, `output_tokens`, `output_tokens_details.reasoning_tokens`, and `total_tokens`. Its terminal streaming event carries the full response including usage.
- The official token guide says the model-returned usage is authoritative; offline tokenizer estimates are only estimates.
- `user_id` changes KV-cache and scheduling isolation and can therefore change actual cache hits. Anthropic `cache_control`, OpenAI `service_tier`, and Responses prompt-cache controls are ignored; they must not create synthetic price conditions.

Granted balance is preferred before topped-up balance. A grant is an account entitlement, not a public model discount, and the 402 response only reports that balance is exhausted. The authenticated `/user/balance` API exposes availability plus total, granted, and topped-up balances, but no request ID, model usage, charged amount, or documented update latency. It is suitable for availability/budget guards, not request-cost attribution.

The official [FAQ](https://static.deepseek.com/faq/index.html?lang=en#/category/4) points users to authenticated Usage and Billing pages; Usage can be filtered by API Key and exported, including an `amount` CSV. No public Usage/Costs API or freshness guarantee is documented. Consequently, account-effective cost can be reconciled from console exports and balance movements, but those surfaces cannot provide a proven real-time cost signal.

## Gateway costing decision

Pre-request estimation must resolve the actual routed model, including Anthropic wildcard mapping, then use the public snapshot and an estimate of cache-hit/miss input plus expected output. Post-request calculation should replace those estimates with returned usage. Thinking mode/effort changes output quantity but not the unit rate. Responses `service_tier` is ignored. `user_id` can indirectly change price through cache isolation. The announced increase has no usable selector, amount, or effective date and therefore cannot enter an estimate yet.

The balance endpoint is not a cost API, and its freshness is unspecified. Usage/Billing exports are not documented as real-time. Neither is suitable for hot-path cost-based load balancing. A gateway can compare current public marginal prices before dispatch and reconcile afterward, but account grants, outstanding balance, and unsettled usage must remain separate state with explicit uncertainty.

## Third-party audit only

- The 2026-08-03 models.dev DeepSeek catalog had four entries. Its two current V4 models matched all three official price components exactly; `deepseek-chat` and `deepseek-reasoner` were retained as current models even though they are absent from the exhaustive current price-table columns and current API model enum. Its `deepseek-v4-flash` release date `2026-07-31` appears derived from the `0731` model-version suffix rather than an exact dated release-log statement, so it is not imported.
- The same-day LiteLLM snapshot had 12 raw DeepSeek entries representing eight IDs. Four duplicate-prefixed entries for the two current V4 IDs matched current official prices, while six older IDs were absent from the current catalog. All four current entries still listed an 8,192-token maximum output rather than the official 384K maximum, demonstrating that price agreement does not establish full-record currentness.
- ccusage obtains these prices through LiteLLM and therefore adds no independent DeepSeek billing authority. None of the three sources represents the announced but unspecified future increase, the Anthropic wildcard routing rule, account grants, or a request-level charged-cost API.

## Kong AI Gateway

- Chat Completions evidence requires exactly one POST `/chat/completions` operation plus the request-model enum, thinking controls, effort values, streaming field, JSON response format, function-tool schema, and usage breakdown. Responses evidence requires exactly one POST `/responses` operation and exact agreement between its request-model enum and the per-model support row.
- The beta FIM and Anthropic-compatible interfaces require distinct base URLs. Validate their support rows but do not publish them as bare paths until the route schema can retain that requirement.
- Concurrency limits are account-level defaults that can be expanded at no extra cost, not architectural model limits, so validate but do not publish them under `limits`.
- Candidates require active lifecycle, exact Chat Completions evidence, positive streaming, and account availability. Kong's versioned OpenAI-compatible upstream may intersect DeepSeek's reviewed unversioned resource; broad text generation alone cannot.
- Historical change-log mentions do not restore IDs absent from the exhaustive current catalog.
