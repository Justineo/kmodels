# DeepSeek

Status: current

## Sources and identity

The exhaustive global catalog and current public rates come from the official
[Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/) table. A valid model column
creates one exact callable ID; names found only in footnotes, integrations, wildcard routing, old
pages, or release history do not create current rows. The current table is also authoritative over
orphaned `pricing-details-*` pages that still describe retired models.

The fetch bundle contains only companions that contribute a current catalog or rate-book field:

- the official [Chinese price table](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/) for
  CNY-denominated variants;
- [Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion),
  [Responses](https://api-docs.deepseek.com/api/create-response), and
  [FIM](https://api-docs.deepseek.com/api/create-completion) references for exact operation model
  sets and returned usage fields; and
- the public [Lists Models](https://api-docs.deepseek.com/api/list-models) example as a second
  current-inventory witness.

The [change log](https://api-docs.deepseek.com/updates) supplies exact-ID release and update dates.
Optional authenticated `GET /models`, enabled with `DEEPSEEK_API_KEY`, may add account-scoped
provenance to exact public matches but cannot create or remove global rows. Family-level marketing,
the consumer app, open weights, status pages, and third-party catalogs are not identity or price
sources.

## Rate-book boundary

Each current model owns one PAYG inference offer. The offer contains the three rates published by
DeepSeek:

- cache-hit input tokens;
- cache-miss input tokens; and
- output tokens.

USD and CNY remain separate `billing_currency` variants with no FX conversion. They are not a
conflict because their denominations differ. Kmodels does not infer which currency settles a
credential; a consumer selects the applicable currency from its own account configuration.

The current price tables publish Peak and Off-peak rows directly inside the model table. They are
`billing_period` variants: Peak covers the half-open UTC windows `01:00–04:00` and `06:00–10:00`,
while Off-peak is the remainder of each UTC day. The Chinese table is accepted only when its
Beijing-time rule maps to the same UTC schedule. The pages publish no effective instant, so Kmodels
does not infer a validity boundary. Kmodels records the published daily rule and exposes
Peak/Off-peak as categorical choices; collection never decides a period from its own clock.

Cache hits and misses partition input. A cache miss already pays the miss rate, so the catalog does
not invent a cache-write or storage charge. Thinking tokens are part of output, and thinking effort
changes quantity rather than rate. FIM, Responses, and Anthropic compatibility do not create new
offers when they use the same model rates.

DeepSeek publishes no separate generic function-call or web-search-call rate. A tool loop or built-in
search may cause additional inference requests, but an AI Gateway observes and prices those requests
individually. This does not establish an unknown search fee, a provider-service price book, or a
commercial relation. Anthropic wildcard rewriting is request routing, not pricing or catalog
identity.

The collector intentionally discards account balance, granted credit, recharge/refund terms,
concurrency, capacity expansion, settlement order, and future price notices without an effective
rate and exact applicability rule. Training, storage, provisioned capacity, subscriptions, and
self-hosted execution are also outside the direct request-rate boundary. Excluded facts are not
published as `unknown` or raw pricing.

## Usage bindings

Numeric rates remain useful even if an optional interface reference drifts. A charge binding is
added only for an interface whose current operation and usage schema were verified:

| Rate             | Chat Completions           | Responses                                           | FIM                        |
| ---------------- | -------------------------- | --------------------------------------------------- | -------------------------- |
| Cache-hit input  | `prompt_cache_hit_tokens`  | `input_tokens_details.cached_tokens`                | `prompt_cache_hit_tokens`  |
| Cache-miss input | `prompt_cache_miss_tokens` | `input_tokens - input_tokens_details.cached_tokens` | `prompt_cache_miss_tokens` |
| Output           | `completion_tokens`        | `output_tokens`                                     | `completion_tokens`        |

All bindings aggregate per request. Streaming remains costable only when the terminal usage object
is available. Reasoning-token fields are subsets used for explanation, not additional charged
quantities.

The current price table marks both models as FIM-capable while the operation-specific API reference
enumerates only `deepseek-v4-pro`. The specific operation controls the binding; the disagreement is
reported without removing either model or its ordinary rates.

## Resilience and conflicts

- A missing or ambiguous main model table is systemic and retains the previously accepted DeepSeek
  partition.
- A malformed model header, field, support value, billing-period label, price cell, companion
  operation, or usage group suppresses only that exact claim. Valid siblings remain.
- An optional companion failure cannot erase current IDs or numeric price-table rows. If usage
  evidence fails, only the affected charge binding is omitted.
- The public model-list witness and optional authenticated inventory report exact-ID disagreements
  but do not override the exhaustive price table.
- Unknown table rows are reported and ignored. Account-only and otherwise out-of-scope rows are
  recognized but deliberately discarded.
- Current canonical price tables outrank stale auxiliary pages for the same exact model, currency,
  meter, and validity. A genuinely unresolved same-scope conflict withholds only the disputed rate.

Refresh is deterministic and non-LLM. Matching uses exact callable IDs and exact operation schemas;
there is no fuzzy reconciliation, family inheritance, or comparator fallback.

## Presentation

Model details show one PAYG mechanism, billing-currency and Peak/Off-peak selectors, the compact UTC
daily rule, the three applicable published rates, and their verified usage counters. They do not
show balance, concurrency, settlement, routing, provisioning, training, storage, or a separate
web-search price. The website presents rates rather than calculating a total or deciding the
current billing period; Gateway consumers may select the applicable rule, multiply rates by
returned usage, and sum requests.

## Comparator audit only

models.dev, LiteLLM, Portkey, Helicone, gateways, and cloud sellers may reveal claims worth checking
against DeepSeek documentation. They cannot create a direct DeepSeek ID, copy another seller's rate,
or override the current official model and pricing tables.
