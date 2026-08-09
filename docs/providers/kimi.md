# Kimi

Status: current

## Official source topology and identity

Kimi operates independent China and international API platforms. Production therefore uses both
first-party regional document sets instead of assuming that one is a translation or commercial
proxy for the other:

- The international and China [`openapi.json`](https://platform.kimi.ai/docs/openapi.json)
  contracts establish the exact Chat Completions discriminator IDs, Token Estimate model enum,
  List Models response shape, route semantics, usage fields, tool controls, caching controls, and
  documented output ceilings. Their API origins must respectively remain
  `https://api.moonshot.ai` and `https://api.moonshot.cn`.
- The international [model catalog](https://platform.kimi.ai/docs/models) and China
  [model catalog](https://platform.kimi.com/docs/models) independently establish labeled current,
  restricted, and retired inventory. Exact IDs in their model tables create rows; family names,
  examples, release prose, and pricing-only mentions do not.
- China and international price books are separate regional sources. They retain CNY and USD,
  region, service tier, tool operation, promotion state, and every exact model applicability
  condition rather than manufacturing a global default.
- The official platform change log, Kimi research blog, Kimi Code release page, and model catalog
  form a bounded lifecycle overlay. An exact ID is direct evidence. A release title is joined only
  when its normalized identity resolves uniquely to an existing catalog ID.
- Optional authenticated `GET /v1/models` inventories are account scoped and independent for the
  two regions. Enable them with `MOONSHOT_API_KEY` and `MOONSHOT_CN_API_KEY`. They may enrich exact
  public matches, but cannot create or remove catalog rows and are never retained as raw data.

The public OpenAPI contract is deliberately cross-checked three ways: the Chat discriminator and
request enum must agree, the Token Estimate enum must equal that ID set, and `GET /v1/models` must
retain the reviewed `object`/`data` response and eight documented item fields. This catches a stale
operation or generated schema without needing an LLM. Authenticated responses require strict root
fields and valid documented item fields. Kimi currently returns additional fields such as
`reasoning_efforts`, `think_efforts`, `supports_dynamic_tools`, `supports_thinking_type`, `parent`,
`root`, and `permission`; these are accepted only with explicit source-contract diagnostics and are
not silently promoted into unsupported catalog semantics.

Both documentation sites expose stable first-party Markdown, `llms.txt`, and OpenAPI JSON assets
from a Mintlify-style static documentation build. The OpenAPI asset carries ordinary HTTP cache
validators; Markdown is fetched from its canonical document URL. The collector relies on exact
URLs, bounded bytes/counts, parsed topology, semantic assertions, and dependency hashes, not DOM
positions or browser execution. `platform.moonshot.ai` redirects to the current international
platform and is not used as a second source. The older structured platform change-log Markdown is
stale, so recent lifecycle dates are intentionally obtained from the current HTML blog, research
blog, and Kimi Code release surface instead.

The two public catalogs must agree on their shared IDs; the OpenAPI may add an exact callable ID.
Models restricted to existing users remain `legacy`, not deprecated. A retirement date requires a
complete dated first-party notice: a notice without a year, a date-shaped ID suffix, or an API
object's creation timestamp never becomes lifecycle evidence.

## Resilient deterministic extraction

The catalog parser is bilingual and recognizes only reviewed English or Chinese headings, tables,
notices, exact code-formatted IDs, and date/replacement structures. Context limits require an
anchored phrase such as “context window” or “上下文”; a bare number followed by “Tokens/s” is speed,
not capacity. Consequently the K2.7 HighSpeed catalog description no longer produces a false
180-token context observation. Its exact 262,144-token context can still be supplied by pricing or
authenticated inventory evidence.

Restricted and retired notices are parsed structurally. Invalid dates, an unknown section, partial
table interpretation, duplicate IDs, an unexplained OpenAPI ID-set disagreement, a missing
commercial page, or a changed accounting claim fails the source. Source references are additive:
independent agreement from both regions is preserved instead of discarded after the first match.

## First-party commercial source graph

Each regional price collector treats its K3 index and 23 fixed companions as one atomic bundle.
The companions cover K2.7, K2.6, K2.5, Moonshot V1, Batch, web-search pricing, rate limits, Chat
usage, token estimation, balance, context caching, web-search usage, Formula official tools, Batch
API and console behavior, account payments, organization budgets, product plans, introduction, the
[service terms](https://platform.kimi.ai/docs/agreement/modeluse), and the regional
`llms.txt` index. Commercial-looking pages newly added to the index cause a failure until reviewed;
they cannot remain silently undiscovered.

Pricing Markdown/MDX is parsed statically, including reviewed JSX currency literals. The current
standard rates per one million tokens are:

| Model                      | China cache / input / output | International cache / input / output |
| -------------------------- | ---------------------------- | ------------------------------------ |
| `kimi-k3`                  | CNY 2 / 20 / 100             | USD 0.30 / 3 / 15                    |
| `kimi-k2.7-code`           | CNY 1.30 / 6.50 / 27         | USD 0.19 / 0.95 / 4                  |
| `kimi-k2.7-code-highspeed` | CNY 2.60 / 13 / 54           | USD 0.38 / 1.90 / 8                  |
| `kimi-k2.6`                | CNY 1.10 / 6.50 / 27         | USD 0.16 / 0.95 / 4                  |
| `kimi-k2.5`                | CNY 0.70 / 4 / 21            | USD 0.10 / 0.60 / 3                  |

Moonshot V1 does not publish a cache-price dimension. The 8K, 32K, and 128K text/vision variants
respectively publish China input/output rates of CNY 2/10, 5/20, and 10/30, and international rates
of USD 0.20/2, 1/3, and 2/5. `moonshot-v1-auto` is callable but absent from both price books. The
three concrete variants have unequal rates and the contract publishes neither a billing threshold
nor a resolved-model field, so assigning the 128K rate or merging all three would be speculation.
It remains the sole current unknown-priced row.

Batch rates remain distinct service-tier facts. China publishes cache/input/output rates of CNY
0.78/3.90/16.20 for K2.7, 0.66/3.90/16.20 for K2.6, and 0.42/2.40/12.60 for K2.5. International
rates are USD 0.114/0.57/2.40, 0.10/0.57/2.40, and 0.06/0.36/1.80 respectively. The price page lists
K2.7 while the Batch guide still names only K2.6 and K2.5; retain the exact rate and surface the
scope disagreement as unbound.

Successful `$web_search` calls cost CNY 0.03 or USD 0.005. The supported model set comes only from
the exact IDs in the official guide. Search-result tokens are separately visible in
`arguments.usage.total_tokens` and later enter the next request's input, so they must not be charged
twice. The K3 price page now warns that web search is being updated and its documentation is
outdated; the numeric tool rate remains normalized, while the warning is retained as an unbound
commercial caveat.

Kimi Formula lists 11 non-search official tools as free for a limited time for exact supported
models. These become promotional zero-price tool-call facts, never permanent free rates. No
promotion end date is published. `moonshot/web-search:latest` points to the separate `$web_search`
billing page but does not establish whether a Formula `/fibers` operation triggers the same meter,
so that mapping remains unbound.

The regional tables publish no effective dates. Kimi's China terms designate the official site and
order pages as price truth and allow noticed changes; the international terms use the pricing page
or Order Form and apply changes after their effective date. These clauses justify treating table
rows as current observations, but do not justify inventing historical start dates from collection
time.

## Request usage, account cost, and gateway decision

Chat Completions returns `prompt_tokens`, `completion_tokens`, `total_tokens`, and
`cached_tokens`. Streaming can return whole-request usage in the final chunk when
`stream_options.include_usage` is requested, but an interrupted stream may never deliver that
chunk. The Token Estimate API's `data.total_tokens` is a pre-request estimate, not a charged-cost
record. Batch output records publish prompt, completion, and total tokens, but the Batch guide does
not document `cached_tokens`, so exact cache-hit/uncached Batch reconstruction remains unbound even
though both rates are published.

No public Kimi Usage/Costs API or inference-response monetary charge is documented. The
authenticated balance endpoint returns available, voucher, and cash balances only. Console
organization/project consumption analysis is not a public API, and project budget enforcement can
lag by about ten minutes. These surfaces can guard availability or reconcile an account, but are
not trustworthy request-time cost signals.

Account tiers alter concurrency, RPM, TPM, and TPD according to cumulative recharge; they do not
alter the public model rate. Project budgets, balance alerts, vouchers, the China K3 new-user voucher
exclusion, Batch console Tier1 eligibility, checkout tax, promotions, and enterprise terms are
account/invoice conditions outside the public price book.

A gateway must retain the credential platform/region, exact routed model, endpoint and service
tier, Formula or built-in tool outcome, cache outcome, and returned usage. China and international
accounts, keys, balances, currencies, and endpoints are independent, so model ID alone is
insufficient. Pre-request price comparison is necessarily an estimate; post-request public-list
cost can replace token estimates only when the usage record is complete.

## Comparator audit only

Third-party catalogs are drift and implementation research, never production evidence:

- models.dev's Moonshot rows are hand-maintained rather than part of its provider sync, and its China
  provider reuses international data instead of modeling the CNY price book. LiteLLM's updater reads
  OpenRouter and Vercel rather than Kimi's regional sources. Portkey and Helicone also publish manual
  subsets; OpenRouter describes its own routed offer. None can establish Kimi identity, regional
  pricing, lifecycle, or account-effective cost.

This provider audit imports no third-party model or price facts and does not use an LLM during
refresh.
