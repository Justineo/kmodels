# DeepSeek

Status: current

## Sources and identity

- The exhaustive global catalog is the official [Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing) table. Callable IDs and facts come only from its model columns; compatibility names mentioned only in footnotes or history do not become current rows.
- Parse and validate every table row. Base URLs, beta feature support, and positive concurrency values are source-shape contracts even when the public model schema cannot represent their base-path or account-quota semantics.
- Lifecycle/replacements require an exact official footnote. Release/update dates require a valid dated log entry and exact callable ID. “Backward compatibility” establishes an update or alias observation, never a first release. A date-like model-version suffix such as `0731` is not sufficient release-date evidence by itself.
- The public [Lists Models](https://api-docs.deepseek.com/api/list-models) contract is a second current-inventory witness. Require exactly one `GET /models` operation, the documented `object`/`data` and `id`/`object`/`owned_by` response topology, one non-placeholder strict JSON example, and exact ID-set equality with the price-table columns. This catches a stale price table, stale generated API reference, and DeepSeek's 200-status fallback page without treating an example owner as identity.
- Optional authenticated `/models` is account-scoped strict-schema validation. Unknown root or item fields, duplicate IDs, and invalid discriminators fail closed. It may add API provenance to exact public matches but cannot create/remove rows or retain raw data. Enable it with `DEEPSEEK_API_KEY`.

## First-party commercial source graph

The current catalog collector treats the English USD price book, public model-list reference, and accounting references as one atomic first-party bundle. Reviewed companions cover [Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion), [Responses](https://api-docs.deepseek.com/api/create-response), [Lists Models](https://api-docs.deepseek.com/api/list-models), [token usage](https://api-docs.deepseek.com/quick_start/token_usage/), [context caching](https://api-docs.deepseek.com/guides/kv_cache/), [current balance](https://api-docs.deepseek.com/api/get-user-balance), [rate limits and isolation](https://api-docs.deepseek.com/quick_start/rate_limit/), [insufficient-balance errors](https://api-docs.deepseek.com/quick_start/error_codes/), the [Responses compatibility guide](https://api-docs.deepseek.com/guides/responses_api/), and the [Anthropic compatibility guide](https://api-docs.deepseek.com/guides/anthropic_api/).

All documents are public, exact URLs. Docusaurus companions under `/quick_start` and `/guides` keep their trailing slash because the slashless CDN objects serve the site root instead of the named documents. Deterministic HTML/schema extraction verifies the model enum, usage fields, cache semantics, account deductions, route mappings, and future-price notice. Missing documents, changed commercial claims, an unknown price row, a partially parsed model column, or an API-reference disagreement currently rejects the provider refresh; the audited target below replaces this provider-wide boundary with claim-local refresh. Third-party price books are never fallbacks.

The documentation is server-rendered Docusaurus backed by a build-time OpenAPI file, but DeepSeek
does not publish that file as a stable asset. Guessed machine-readable paths return the site root and
the sitemap has no useful per-document freshness metadata. Production therefore reads canonical
rendered pages, validates their semantics, and uses dependency hashes to detect changes.

Other first-party surfaces are deliberately not merged. The [Transparency Center](https://www.deepseek.com/en/transparency/) publishes family-level `DeepSeek-V4` and `DeepSeek-V3.2` release dates, not callable API IDs. Its Next.js payload and the main-site translation payload also retain unrendered legacy marketing strings such as a 64K context claim, demonstrating that “official embedded data” is not automatically current product evidence. The [service status](https://status.deepseek.com/) tracks availability, not model identity or pricing. The dated change log remains the exact-ID lifecycle overlay.

## Public price normalization

- The current collector normalizes the English USD public pricing per one million tokens. Each exact catalog model receives separate cache-hit input, cache-miss input, and output-token facts. The source formula is `tokens × price`; reasoning tokens are part of generated completion/output tokens rather than a separate rate. The audited target below also preserves the first-party CNY book without currency conversion.
- Context caching is automatic and enabled by default. Cache writes have no separately published write fee; input tokens are billed at either the cache-hit or cache-miss rate reported for the model. Cache construction takes seconds, operation is best-effort, and unused cache entries normally disappear within hours to days.
- The current price page announces a significant overall price increase but publishes neither its rates nor its effective date. Keep the six currently normalized USD rates active and record the future increase as unbound; the daily contract will fail again when the provider publishes actionable applicability or amounts.
- The Responses and Anthropic-compatible APIs execute server-side web search. No separate search-call amount is published, while the Claude Code integration explicitly says a search can generate additional LLM requests and model-token charges. Preserve the provider service and realized search action with incomplete cost coverage; do not call the search free, fabricate a per-call amount, or treat every generic tool call as search.
- The Anthropic-compatible route maps `claude-opus*` to `deepseek-v4-pro`, maps `claude-haiku*` and `claude-sonnet*` to `deepseek-v4-flash`, and maps other unsupported model names to Flash. These are wildcard request-route mappings, not additional price-book model IDs. The current schema cannot safely publish them as exact aliases, so the mapping remains a visible unbound gateway requirement.

Change-log rows may enrich an exact current model with release, update, and maturity facts, but they
cannot create a model absent from the current price-table inventory.

## Commercial topology audit

Design status: audited; implementation pending. This section is the DeepSeek
disposition for the provider-wide commercial-topology review. It describes the
intended resources, books, offers, relationships, meters, accounting bindings,
and evidence boundaries; it does not claim that the current collector, schema,
generated data, or UI already represents them.

### Public commercial source graph

| Surface                                                                                                                                                                                                                                                                                                                                                                              | Exact authority and completeness boundary                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The current English [Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing) page and its [Chinese counterpart](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)                                                                                                                                                                                               | Exact current API model columns, USD and CNY amounts, cache-hit/cache-miss/output meters, base URLs, shared model facts, current alias footnote, deduction rule, and unbound future-increase notice. Locale is not by itself account-price applicability.                                                                                               |
| [Lists Models](https://api-docs.deepseek.com/api/list-models), the bounded API-reference navigation, and optional authenticated `GET /models`                                                                                                                                                                                                                                        | Current callable direct-model inventory. The public example is a second global witness; authenticated presence can exact-enrich a public match but is account scoped and cannot create or remove a global row. The current API reference enumerates Chat Completions, Responses, FIM, model listing, and balance, not a general OpenAI product surface. |
| [Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion), [Responses](https://api-docs.deepseek.com/api/create-response), [FIM](https://api-docs.deepseek.com/api/create-completion), [Responses compatibility](https://api-docs.deepseek.com/guides/responses_api/), and [Anthropic compatibility](https://api-docs.deepseek.com/guides/anthropic_api/)         | Interface-specific model applicability, beta route, route rewriting, request controls, output events, and usage quantities. Interface compatibility does not create another price or turn arbitrary mapped names into catalog IDs.                                                                                                                      |
| [Context caching](https://api-docs.deepseek.com/guides/kv_cache/), [token usage](https://api-docs.deepseek.com/quick_start/token_usage/), [thinking mode](https://api-docs.deepseek.com/guides/thinking_mode), and [tool calls](https://api-docs.deepseek.com/guides/tool_calls)                                                                                                     | Automatic hit/miss mechanics, returned authoritative quantities, reasoning-token subset, caller-executed functions, and beta strict-schema behavior. Historical cache announcements do not override the current price page.                                                                                                                             |
| Built-in web-search contracts in [Responses](https://api-docs.deepseek.com/api/create-response), [Anthropic compatibility](https://api-docs.deepseek.com/guides/anthropic_api/), and the official [Claude Code integration](https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code/)                                                                               | Provider-executed search presence and action signals. Search can trigger additional model calls and token cost, but no first-party search-call amount, denominator, or guarantee that the terminal response aggregates all hidden model usage is published.                                                                                             |
| [Rate Limit & Isolation](https://api-docs.deepseek.com/quick_start/rate_limit/), [Get User Balance](https://api-docs.deepseek.com/api/get-user-balance), [errors](https://api-docs.deepseek.com/quick_start/error_codes/), [FAQ](https://api-docs.deepseek.com/faq), and [Open Platform terms](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html) | Account concurrency, free expansion-request policy, cache/scheduling isolation, prepaid and granted balances, currency observations, deduction priority, grant expiry, refundability, usage export, and settlement. These account facts do not establish another model rate.                                                                            |
| The [change log](https://api-docs.deepseek.com/updates/), exact release posts, the consumer App, and official open-weight releases                                                                                                                                                                                                                                                   | Exact callable-ID history and retirement evidence when named. The free consumer App and downloadable weights are different distribution/execution products; neither creates a free direct-API offer.                                                                                                                                                    |

Comparator catalogs remain audit-only. models.dev, LiteLLM, Portkey, Helicone,
gateways, and cloud sellers may reveal a first-party claim to investigate, but
they cannot create a DeepSeek-direct ID, copy another seller's rate, or override
DeepSeek's current price, route, and settlement evidence.

### Books, resources, and offer boundaries

- Direct API PAYG inference is the sole current numeric DeepSeek commercial
  mechanism tied to callable models. The same model offer can be delivered by
  OpenAI Chat Completions, Anthropic Messages, eligible Responses, or beta FIM;
  a delivery interface is not another offer without a distinct price,
  acquisition path, or biller. Responses currently supports only
  `deepseek-v4-flash`; FIM is documented at the same Chat price and is limited
  by its exact beta/model/mode applicability.
- USD and CNY are first-party settlement-currency variants of the direct PAYG
  book. Preserve both exact published amounts and currencies. The balance API
  can expose CNY or USD balances, but neither locale nor spot FX proves which
  book settles a credential. Before exact account evidence, show both labeled
  observations rather than converting them, selecting the cheaper one, or
  reporting a price conflict between dimensionally different money units.
- Cache-hit input, cache-miss input, and output are components of the same PAYG
  inference offer. Hit and miss quantities partition input and may both occur in
  one request. Every request can construct cache state, but current billing has
  no separately priced cache write: missed tokens already use the miss rate and
  cache storage is not a second charge. Do not emit a synthetic zero-price cache
  write merely because storage is described as free.
- Thinking and non-thinking modes share the same token rates. Reasoning tokens
  are a subset of completion/output tokens, so effort changes realized output
  quantity rather than adding a reasoning surcharge or a second output term.
  Ignored compatibility controls such as `service_tier`, Anthropic
  `cache_control`, and prompt-cache selectors create no price variants.
- Caller-defined function calling is model output plus client-owned execution.
  DeepSeek publishes no generic function-call fee. Each follow-up inference
  request is independently token-billed, but the emitted `tool_calls` item is
  not itself a commercial meter. Strict mode and parallel tool calling are
  interface behavior, not offers.
- Built-in web search is a distinct DeepSeek provider service because the
  provider executes it. It requires an eligible inference route, emits search
  actions, and can trigger additional LLM requests to summarize results. The
  only published economic claim is additional model-token cost; no search-call
  amount is published. Preserve a provider-service offer with
  `not_published` search amount and separately compose every observable model
  usage event. Do not turn missing search price into zero or token-only
  completeness.
- The Anthropic endpoint rewrites `claude-opus*` to `deepseek-v4-pro`,
  `claude-haiku*` and `claude-sonnet*` to `deepseek-v4-flash`, and other
  unsupported names to Flash. These are request-routing policies over current
  offers, not callable DeepSeek catalog identities or separately priced aliases.
  The official Claude Code example also uses `deepseek-v4-pro[1m]`, but no
  inventory or pricing contract defines the bracket suffix as a global ID;
  retain it as route syntax pending an exact mapping claim.
- `deepseek-chat` and `deepseek-reasoner` were compatibility routes to Flash
  non-thinking and thinking modes. Their published retirement deadline has
  passed, the V4 release says they become inaccessible, and the current model
  list excludes them. Preserve historical route/lifecycle evidence, not current
  model rows or live offers.
- A topped-up balance is prepaid settlement value, not a subscription or usage
  discount. A granted balance is an account allowance preferred before top-up,
  may expire, and can be exhausted. Exact free quota is subject to the account
  product surface but no stable public numeric grant applies to every user.
  Top-up non-expiry and refundability do not change the public unit rate.
- Standard concurrency and approved expansion are account entitlements. The
  published expansion request has no additional fee, but it is not a purchasable
  provisioned-capacity offer, a guaranteed public quantity, or a zero-rate model
  service. `user_id` partitions cache and scheduling state and may change hit
  realization without changing unit prices.
- The bounded current API reference and price book publish no direct Batch,
  fine-tuning job, embeddings, media generation, subscription, reserved
  capacity, storage, or deployment offer. Do not manufacture unbound products
  from OpenAI-compatible endpoint names, historical news, or the ability to use
  API output for external fine-tuning. The free consumer App and self-hosted
  open weights remain separate products with operator/external compute cost.

### Commercial relationships

| Source offer or resource   | Relation                            | Target and scope                                                           | Cost consequence                                                                                                                                                       |
| -------------------------- | ----------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Built-in web search        | `requires` and potentially additive | Exact eligible DeepSeek inference offer                                    | A realized search may trigger one or more extra token-billed inference events. Search-call amount remains `not_published`; requested tool presence alone adds nothing. |
| Caller function loop       | client-controlled composition       | Each explicit follow-up inference request plus external function execution | Charge every model request from its returned tokens. DeepSeek charges no generic function event; any external tool cost belongs to its operator/seller.                |
| Granted balance            | ordered allowance over              | Exact eligible direct PAYG settlement for the owning account               | Deduct grant before topped-up balance until expiry/exhaustion; the public unit rate remains unchanged.                                                                 |
| Topped-up balance          | settlement source                   | Remaining direct PAYG charges                                              | Consumes refundable non-expiring account value after grants; it is not an included allowance or discount.                                                              |
| Currency-qualified rate    | account-selected alternative        | USD or CNY direct PAYG variant for one settled quantity                    | Apply one settlement currency, never both or an FX-derived minimum. Exact account billing evidence resolves the route.                                                 |
| Anthropic wildcard mapping | realized route selection            | Pro or Flash according to the exact prefix/fallback rule                   | Price only the realized DeepSeek model; wildcard request strings do not accrue in parallel or create catalog rows.                                                     |
| Cache hit/miss components  | partition                           | All input tokens in one inference result                                   | Each input token is billed once as hit or miss; sum both partitions and never add a separate cache-write fee.                                                          |

### Meters, denominators, and observable signals

| Commercial atom            | Public denominator                                               | Required signal or reconstruction                                                                               | Phase                    |
| -------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Cache-hit input            | million input tokens                                             | Chat `prompt_cache_hit_tokens` or Responses `input_tokens_details.cached_tokens`                                | Outcome                  |
| Cache-miss input           | million input tokens                                             | Chat `prompt_cache_miss_tokens`; for Responses, exact `input_tokens - cached_tokens` derivation                 | Outcome                  |
| Generated output           | million output tokens                                            | Chat `completion_tokens` or Responses `output_tokens`; reasoning is a subset, not additive                      | Outcome                  |
| FIM input/output           | same direct PAYG token meters                                    | Exact beta FIM model/mode plus returned prompt/completion usage                                                 | Outcome                  |
| Built-in web search action | No published price denominator                                   | Completed Responses `web_search_call` action or Anthropic `server_tool_use`/`web_search_tool_result` evidence   | Outcome                  |
| Search-induced inference   | ordinary hit/miss/output token meters per realized model request | Every observable summarization/inference usage record; terminal-response aggregation is not publicly guaranteed | Outcome/account          |
| Account concurrency        | concurrent open request                                          | Request interval against account/model and optional `user_id` quota                                             | Request timeline/account |
| Granted/top-up balance     | currency amount                                                  | `/user/balance` currency, total, granted, and topped-up balances                                                | Account                  |
| Settled usage cost         | account currency amount                                          | Usage export `amount`, API-key grouping, Billing page, and balance movement                                     | Account                  |

`prompt_tokens` or `input_tokens` cross-checks the hit-plus-miss partition. A
streaming request becomes costable only when its terminal usage object arrives.
The provider-returned tokenizer quantities are authoritative; offline tokenizers
remain preflight estimates.

### Requested, realized, allowance, enrollment, and settlement state

- Request-time state selects credential, interface/base path, submitted model or
  wildcard, thinking mode/effort, beta route, `user_id`, function tools, and
  built-in search. These inputs establish eligibility and a partial estimate,
  not realized model, cache class, search actions, or account charge.
- Outcome state supplies the returned model, cache hit/miss split, output and
  reasoning subset, completed search actions, and every exposed additional model
  usage event. Anthropic fallback and built-in search make this phase essential.
- Allowance state contains granted balance, expiry, available currency, and any
  account-specific free quota. A grant reduces settlement after usage; it does
  not create a public free model or lower list price.
- Enrollment state contains API-key/account access, concurrency expansion,
  account currency, and any account restriction. It controls callability and
  capacity but does not prove global inventory or a new offer.
- Settlement state appears in Usage/Billing exports and balance movement. It owns
  account amount after grants and any adjustments but lacks a documented realtime
  request-cost API or freshness SLA.

### Commercial-atom disposition ledger

| Reviewed atom class                                     | Design disposition                                                                                                                                                                              |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current USD and CNY PAYG rows                           | Normalize both exact currency-qualified books without FX conversion. Bind a credential only when account settlement evidence establishes the currency.                                          |
| Cache hit, cache miss, and output                       | Normalize as three components of one inference offer with exact usage bindings. Do not add cache-write storage or reasoning terms.                                                              |
| Thinking, effort, prefix completion, JSON, strict tools | Preserve request/interface applicability and realized quantities; no separate commercial offer or surcharge.                                                                                    |
| FIM beta                                                | Preserve a distinct delivery route using the same eligible model token book and exact non-thinking/beta applicability.                                                                          |
| Caller functions                                        | Preserve capability and external execution boundary. Emit no generic DeepSeek tool-call rate.                                                                                                   |
| Built-in web search                                     | Preserve a provider-service offer, precise realized action, `requires` relation, additional inference effect, and `not_published` search amount. Do not claim free or complete token-only cost. |
| Anthropic wildcard and unsupported-name fallback        | Preserve route-selection rules and resolved target. Never admit wildcard/source names or duplicate target offers.                                                                               |
| Claude Code `[1m]` syntax                               | Preserve as bounded route syntax with ambiguous identity mapping; no catalog row or copied rate until the first-party contract defines it.                                                      |
| Retired `deepseek-chat`/`deepseek-reasoner`             | Preserve historical route and retirement evidence only; current inventory and offers remain V4 Pro/Flash.                                                                                       |
| Topped-up and granted balances                          | Preserve settlement source, allowance priority, currency, expiry/refund state, and account scope. Never flatten to a model rate.                                                                |
| Concurrency and free expansion                          | Preserve account quota/enrollment. Do not create provisioned-capacity pricing or a global zero offer.                                                                                           |
| Future increase notice                                  | Preserve an unbound pending price observation with no amount/effective date. It cannot override current numeric rows.                                                                           |
| Consumer App and open weights                           | Preserve separate product/distribution facts. App free use does not apply to API; self-host compute is operator/external cost.                                                                  |
| Products absent from the bounded API surface            | Emit no speculative Batch, training, subscription, media, embedding, or deployment offer. Reconsider only when exact first-party product evidence appears.                                      |
| Missing, malformed, or conflicting claims               | Suppress only the affected claim and retain current models, sibling meters, routes, account facts, raw evidence, and compatible prior claims with freshness state.                              |

### Authority, conflicts, and claim-local refresh

Authority is specific to each claim:

1. The canonical current pricing pages own current amounts and currencies; the
   current model list owns callable direct IDs. Orphaned first-party
   `/pricing-details-usd` and `/pricing-details-cny` pages still publish old
   `deepseek-chat`/`deepseek-reasoner` limits and rates, but are absent from the
   current sitemap/navigation and contradict the V4 inventory, release, and
   canonical price table. Keep them as visible superseded observations and
   never create current rows or a price conflict from them.
2. English USD and Chinese CNY amounts are not conflicting numeric claims after
   currency is retained. Their account/channel selector is under-documented, so
   retain both with an applicability warning until balance/billing evidence
   resolves one. Do not choose a “more trusted” locale or compare converted cost.
3. The current price page owns cache-hit/miss/output amounts. Historical cache
   news may explain mechanics but its old numeric examples are superseded. A
   comparator's zero cache-write field is not first-party evidence for a new
   charge term.
4. The dedicated API and compatibility guides own interface model sets, route
   mapping, and usage signals. The price table owns shared model rates. A mapped
   Claude name or official integration string cannot override global inventory.
5. Built-in search guides prove execution and extra model-token cost but publish
   no distinct amount or aggregation contract. Preserve the search amount as
   `not_published` and immediate total as partial; absence is neither zero nor
   evidence that one terminal usage object covers hidden summarization calls.
6. The future overall price-increase notice has no effective time or amount.
   Preserve current rows plus the pending observation. When exact replacement
   rows appear, their validity owns the new snapshot; disappearance of the
   notice alone changes no price.
7. The price footnote retains future-tense retirement wording after the July 24,
   2026 deadline. The V4 release, change log, current price columns, and model
   list jointly establish that the old routes are not current inventory. Keep
   the stale wording as a local warning rather than weakening current identity.
8. Usage/Billing export and balance evidence own account settlement. Grants,
   refunds, account currency, and adjustments can change paid amount without
   making the public token rate wrong.

Refresh remains deterministic and non-LLM. English and Chinese price tables,
public and authenticated inventory, each delivery-interface schema, cache,
thinking, caller tools, built-in search, route mappings, lifecycle, rate limits,
balance, FAQ/terms, and account evidence are independent claim groups. Validate
exhaustiveness only inside a source's proven scope. One missing guide, stale
orphan, malformed usage field, unresolved currency binding, or web-search drift
suppresses that claim or retains a compatible prior claim as stale; it must not
erase the model, another meter, another interface, account facts, or the whole
provider snapshot. Every recognized atom receives a normalized, derived,
included, externally billed, account-only, superseded, conflicting,
unsupported, ambiguous, or pending disposition.

### Model-detail composition and cost coverage

Model details should project exact currency-qualified PAYG components and the
interfaces proven for that model. Cache is shown as hit/miss input, reasoning as
included output quantity, and FIM as an eligible route rather than another
price. Built-in web search appears only for an exact compatible route, with its
separate provider-service identity, unknown search amount, action signal, and
additional-model-usage warning. Anthropic wildcard names, `[1m]` route syntax,
balances, and concurrency do not create model rows.

The calculator resolves the realized DeepSeek model and settlement currency,
then sums hit input, miss input, and output once for every observable inference
event. A realized built-in search can add further inference events, but not a
fabricated search-call fee or a zero. Caller functions add only explicit
follow-up model requests and externally owned execution cost. Partial coverage
is expected: show unknown account currency, hidden search subrequest usage,
pending price increase, grants, and delayed settlement instead of rejecting the
offer or claiming an exact total.

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

- models.dev has hand-maintained DeepSeek provider TOML but no DeepSeek first-party
  sync adapter. Its current V4 rows flatten the USD miss/hit/output book and model
  reasoning as the output rate; they do not establish CNY applicability, built-in
  search cost, account settlement, or route fallback.
- LiteLLM's central JSON has direct V4 rows and cache fields, but currently keeps an
  8,192-token output limit where DeepSeek's price table publishes 384K, lists only
  Chat Completions for the direct rows, and expresses cache construction as a zero
  write price. That is useful drift evidence, not authority for output limits,
  route coverage, or a cache-write commercial atom.
- Portkey currently carries V4 rows and also retains retired
  `deepseek-chat`/`deepseek-reasoner` prices plus a zero-priced default fallback.
  Helicone's direct DeepSeek registry still centers older V3/R1 identities. Neither
  can override current inventory or make an unknown model free.
- DeepSeek's own Awesome repository and agent-integration pages defer API facts to
  the current API Docs; third-party agent subscriptions, plugins, MCPs, and cloud
  deployments remain in their seller's books.

These are comparison signals only and cannot override the canonical price books,
lifecycle, route mapping, tool-cost boundary, or account settlement.
