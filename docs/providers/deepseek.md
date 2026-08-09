# DeepSeek

Status: current

## Sources and identity

- The exhaustive global catalog is the official [Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing) table. Callable IDs and facts come only from its model columns; compatibility names mentioned only in footnotes or history do not become current rows.
- Parse and validate every table row. Base URLs, beta feature support, and positive concurrency values are source-shape contracts even when the public model schema cannot represent their base-path or account-quota semantics.
- Lifecycle/replacements require an exact official footnote. Release/update dates require a valid dated log entry and exact callable ID. “Backward compatibility” establishes an update or alias observation, never a first release. A date-like model-version suffix such as `0731` is not sufficient release-date evidence by itself.
- The public [Lists Models](https://api-docs.deepseek.com/api/list-models) contract is a second current-inventory witness. Require exactly one `GET /models` operation, the documented `object`/`data` and `id`/`object`/`owned_by` response topology, one non-placeholder strict JSON example, and exact ID-set equality with the price-table columns. This catches a stale price table, stale generated API reference, and DeepSeek's 200-status fallback page without treating an example owner as identity.
- Optional authenticated `/models` is account-scoped strict-schema validation. Unknown root or item fields, duplicate IDs, and invalid discriminators fail closed. It may add API provenance to exact public matches but cannot create/remove rows or retain raw data. Enable it with `DEEPSEEK_API_KEY`.

## First-party commercial source graph

The catalog collector treats the price book, public model-list reference, and accounting references as one atomic first-party bundle. Reviewed companions cover [Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion), [Responses](https://api-docs.deepseek.com/api/create-response), [Lists Models](https://api-docs.deepseek.com/api/list-models), [token usage](https://api-docs.deepseek.com/quick_start/token_usage/), [context caching](https://api-docs.deepseek.com/guides/kv_cache/), [current balance](https://api-docs.deepseek.com/api/get-user-balance), [rate limits and isolation](https://api-docs.deepseek.com/quick_start/rate_limit/), [insufficient-balance errors](https://api-docs.deepseek.com/quick_start/error_codes/), the [Responses compatibility guide](https://api-docs.deepseek.com/guides/responses_api/), and the [Anthropic compatibility guide](https://api-docs.deepseek.com/guides/anthropic_api/).

All documents are public, exact URLs. Docusaurus companions under `/quick_start` and `/guides` keep their trailing slash because the slashless CDN objects serve the site root instead of the named documents. Deterministic HTML/schema extraction verifies the model enum, usage fields, cache semantics, account deductions, route mappings, and future-price notice. Missing documents, changed commercial claims, an unknown price row, a partially parsed model column, or an API-reference disagreement rejects the provider refresh. Third-party price books are never fallbacks.

The documentation is server-rendered Docusaurus backed by a build-time OpenAPI file, but DeepSeek
does not publish that file as a stable asset. Guessed machine-readable paths return the site root and
the sitemap has no useful per-document freshness metadata. Production therefore reads canonical
rendered pages, validates their semantics, and uses dependency hashes to detect changes.

Other first-party surfaces are deliberately not merged. The [Transparency Center](https://www.deepseek.com/en/transparency/) publishes family-level `DeepSeek-V4` and `DeepSeek-V3.2` release dates, not callable API IDs. Its Next.js payload and the main-site translation payload also retain unrendered legacy marketing strings such as a 64K context claim, demonstrating that “official embedded data” is not automatically current product evidence. The [service status](https://status.deepseek.com/) tracks availability, not model identity or pricing. The dated change log remains the exact-ID lifecycle overlay.

## Public price normalization

- Current public pricing is per one million tokens. Each exact catalog model receives separate cache-hit input, cache-miss input, and output-token facts. The source formula is `tokens × price`; reasoning tokens are part of generated completion/output tokens rather than a separate rate.
- Context caching is automatic and enabled by default. Cache writes have no separately published write fee; input tokens are billed at either the cache-hit or cache-miss rate reported for the model. Cache construction takes seconds, operation is best-effort, and unused cache entries normally disappear within hours to days.
- The current price page announces a significant overall price increase but publishes neither its rates nor its effective date. Keep the six current rates active and record the future increase as unbound; the daily contract will fail again when the provider publishes actionable applicability or amounts.
- The Responses API executes server-side web search, but no separate web-search fee is published in the price book or Responses accounting documentation. Do not assume that absence means either free or token-only; retain an explicit unbound diagnostic.
- The Anthropic-compatible route maps `claude-opus*` to `deepseek-v4-pro`, maps `claude-haiku*` and `claude-sonnet*` to `deepseek-v4-flash`, and maps other unsupported model names to Flash. These are wildcard request-route mappings, not additional price-book model IDs. The current schema cannot safely publish them as exact aliases, so the mapping remains a visible unbound gateway requirement.

Change-log rows may enrich an exact current model with release, update, and maturity facts, but they
cannot create a model absent from the current price-table inventory.

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

## Comparator audit only

- models.dev does not register DeepSeek in its provider sync, while LiteLLM's updater imports
  OpenRouter and Vercel data rather than DeepSeek's direct catalog. Portkey and Helicone likewise
  publish community-maintained rows. DeepSeek's own Awesome repository explicitly defers to API Docs.
  These are comparison signals only and cannot override the canonical price book, lifecycle, route
  mapping, or account-cost boundary.
