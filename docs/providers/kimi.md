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

Restricted and retired notices are parsed structurally. Identity-bearing catalog and OpenAPI
contradictions still fail their source. Commercial extraction is claim-local: an invalid price row
or pricing document is rejected with a bounded reconciliation item while valid sibling rows remain;
a changed accounting or ancillary companion claim suppresses only the dependent service or charge
binding. It never erases independently parsed model prices. Source references are additive:
independent agreement from both regions is preserved instead of discarded after the first match.

## First-party commercial source graph

Each regional price collector fetches its K3 index and 23 fixed companions as one bounded transport
bundle, then reviews their claims independently. The companions cover K2.7, K2.6, K2.5, Moonshot V1, Batch, web-search pricing, rate limits, Chat
usage, token estimation, balance, context caching, web-search usage, Formula official tools, Batch
API and console behavior, account payments, organization budgets, product plans, introduction, the
[service terms](https://platform.kimi.ai/docs/agreement/modeluse), and the regional
`llms.txt` index. Commercial-looking pages newly added to the index produce an explicit unbound
review signal; they cannot remain silently undiscovered or suppress already recognized prices.

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

Batch is a distinct model offer, not a selector on the standard offer. China publishes cache/input/output rates of CNY
0.78/3.90/16.20 for K2.7, 0.66/3.90/16.20 for K2.6, and 0.42/2.40/12.60 for K2.5. International
rates are USD 0.114/0.57/2.40, 0.10/0.57/2.40, and 0.06/0.36/1.80 respectively. The price page lists
K2.7 while the Batch guide still names only K2.6 and K2.5; retain the exact rate and surface the
scope disagreement as unbound.

Kimi web search costs CNY 0.03 or USD 0.005 per call. The dedicated billing prose is more precise
than the table's “successful tool call” label: the built-in route is charged when a response has
`finish_reason=tool_calls` and an exact `$web_search` item, even if the caller stops before the
follow-up request. The billable quantity is therefore each matching emitted call, not a generic
successful tool call or one request containing any tool. Search-result tokens are separately visible
in `arguments.usage.total_tokens` and enter `prompt_tokens` only when the caller submits the next
Chat request, so they must not be charged twice. The Formula `moonshot/web-search:latest` route
links to the same price page and says that billing occurs at Fiber execution; the topology audit
below keeps the routes and their distinct charge signals explicit.

Kimi Formula lists 11 non-search official tools as temporarily free. Each exact Formula URI is an
independently callable provider service, including without model inference. The source publishes no
numeric zero amount, denominator, or promotion end date, so these are limited-time `free` states,
not invented zero-price `tool_call` rates. A model's ordinary function-call output does not itself
incur a Formula fee: execution occurs only when the caller subsequently creates a Formula Fiber.
Fiber identity, status, logs, and resource usage are operational evidence; they do not establish one
universal priced meter for all Formula tools.

The regional tables publish no effective dates. Kimi's China terms designate the official site and
order pages as price truth and allow noticed changes; the international terms use the pricing page
or Order Form and apply changes after their effective date. These clauses justify treating table
rows as current observations, but do not justify inventing historical start dates from collection
time.

## Commercial topology audit

Design status: implemented. Kimi publishes regional model-token books plus separate provider
resources for web search, Formula, and Files. Standard and Batch inference are distinct offers;
standard usage binds to Kimi's exact token counters, while unsupported or conflicting Batch
partitions remain visibly unbound. Built-in and Formula web search retain distinct routes and
charge signals. Non-search Formula tools and Files preserve their promotional `free` state without
fabricating numeric-zero rates. Direct regional settlement is with Moonshot AI; account balances,
vouchers, tax, budgets, and enterprise terms remain account or reconciliation evidence rather than
model-rate modifiers.

### Public commercial source graph

| Surface                                                                                                                                                                                                                                                                  | Exact authority and completeness boundary                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The China and international [model catalogs](https://platform.kimi.com/docs/models), regional [`openapi.json`](https://platform.kimi.ai/docs/openapi.json) contracts, and optional authenticated `GET /v1/models`                                                        | Exact direct-model identities, regional API origins, callable request enums, route schemas, and public/account-scoped inventory. Authenticated rows can exact-enrich public identities but cannot create or remove a global model.                                                                  |
| Regional model price pages under [international pricing](https://platform.kimi.ai/docs/pricing/chat) and [China pricing](https://platform.kimi.com/docs/pricing/chat), plus the cache and Chat usage guides                                                              | Current standard PAYG cache-hit, cache-miss, input, output, context, and applicability claims. Each regional table owns only its currency and platform. Chat response usage owns realized quantities; token estimation remains preflight evidence.                                                  |
| Regional [Batch pricing](https://platform.kimi.ai/docs/pricing/batch), [Batch API guide](https://platform.kimi.ai/docs/guide/use-batch-api), Batch endpoint contracts, and Batch-purpose Files API                                                                       | Numeric Batch rates, async acquisition route, completion-window and state semantics, supported-model conflict, input/result files, result-item usage, cancellation, failure, and expiry. The price table and guide are independent scopes rather than interchangeable inventory authorities.        |
| Regional [web-search pricing](https://platform.kimi.ai/docs/pricing/tools), the built-in [web-search guide](https://platform.kimi.ai/docs/guide/use-web-search), K3 price warning, and China counterparts                                                                | Exact regional amount and unit, built-in `$web_search` declaration, billable response signal, exact named model compatibility, search-result token timing, and operational caveats. A generic function tool or caller search implementation is outside this provider-service claim.                 |
| Regional [Formula official-tools guide](https://platform.kimi.ai/docs/guide/use-official-tools), `GET /v1/formulas/{uri}/tools`, and `POST /v1/formulas/{uri}/fibers`                                                                                                    | Exact official Formula URIs, independent direct execution, model-loop integration, the Fiber execution/billing phase, status/resource evidence, the temporary-free statement, and the specific `web-search` pricing cross-reference. The guide publishes no numeric non-search Formula denominator. |
| The [Files API](https://platform.kimi.ai/docs/api/files), exact upload/content/list/retrieve/delete contracts, and the model-inference pricing explanation                                                                                                               | File purposes, extraction/storage operations, account capacity, temporary-free state, and the rule that extracted content becomes ordinary model input only when passed to Chat. “Temporarily free” does not establish permanent zero rates or free downstream inference.                           |
| Regional [rate limits](https://platform.kimi.ai/docs/pricing/limits), [balance](https://platform.kimi.ai/docs/api/balance), account/payment guidance, organization budgets, [product comparison](https://platform.kimi.ai/docs/guide/product-plans), checkout, and terms | Recharge enrollment, tier quotas, voucher/cash/available balances, budget lag, tax/invoice treatment, public PAYG versus enterprise procurement, and product separation. These account and settlement facts do not create model-rate variants.                                                      |
| Regional `llms.txt`, bounded navigation, platform change log, official releases, model lifecycle notices, and Kimi Code release surfaces                                                                                                                                 | Exhaustive discovery within each documented surface and exact lifecycle evidence. Kimi Membership, Kimi Business, Kimi Code, open weights, and other distribution products remain separate unless a source explicitly binds their commercial entitlement to an Open Platform API credential.        |

Comparator catalogs remain audit-only. models.dev, LiteLLM, Portkey, Helicone, gateways, and
resellers may identify a first-party claim worth checking, but they cannot create a Kimi-direct ID,
copy a regional amount, resolve an account's platform, or override Kimi's route and billing signal.

### Books, resources, and offer boundaries

- China and international Open Platform PAYG are independent regional books. Preserve their exact
  API origin, account/key boundary, currency, taxes, and settlement state. The same model spelling
  does not make CNY and USD variants simultaneously applicable, and spot conversion cannot choose
  an account's book.
- Standard inference is a direct model offer. For Kimi-family price rows, cache-hit input,
  cache-miss input, and output are components of that offer, not three offers. Moonshot V1 instead
  publishes one input rate over full prompt usage and one output rate. Automatic cache construction
  has no separately published write or storage charge. Thinking and reasoning effort change
  realized output quantity or behavior, not the token rate.
- Batch is a separate asynchronous offer because it has a distinct acquisition route, price,
  completion window, lifecycle, input-file requirement, and result objects. It is not a `batch`
  selector on a realtime offer. The K2.7 price row remains a valid numeric observation, but its
  route eligibility is conflicting while the current guide still limits request bodies to K2.6 and
  K2.5.
- Kimi web search is one provider-service resource with two explicit delivery offers. The built-in
  offer is invoked through `$web_search` inside an eligible Chat route. The Formula offer is the
  independently callable `moonshot/web-search:latest` Fiber route and is the recommended K3
  channel. They share the region's published web-search amount because the exact Formula row defers
  its pricing to that page and the Formula workflow says billing occurs at Fiber creation, but each
  route keeps its own identity and charge signal. The dedicated price prose still naming only
  `$web_search` remains a visible applicability caveat, especially for failure outcomes.
- The other 11 official Formula URIs are 11 independently callable provider-service offers within
  a Formula resource. Distinct URI, behavior, state, resource use, and future priceability justify
  distinct offers; one price-like row per UI table is not the boundary. Their current state is
  promotional `free` with an unknown end, not numeric zero. `memory` persistence and compute or
  fetch behavior do not justify a storage, CPU, network, or generic execution price until Kimi
  publishes one.
- File upload, extraction, storage, content retrieval, listing, and deletion form a provider file
  service. The exact operation/purpose remains visible, but the current public price claim is one
  temporary-free service state rather than fabricated zero rates for every endpoint. File capacity
  and peak-load throttling are account quotas/availability, not commercial meters.
- Ordinary caller-defined functions are not Kimi services. Model-emitted `tool_calls` consume
  ordinary output tokens; client execution may have an external seller cost. Only an explicit Kimi
  built-in event or Formula Fiber enters Kimi's provider-service book.
- Open Platform offers public PAYG and custom enterprise procurement. The enterprise option has no
  public amount or guaranteed capacity, so it is an account/procurement state, not a second numeric
  model price. Kimi Membership, Kimi Business, and Kimi Code subscriptions are explicitly separate
  products; their benefits do not make Open Platform inference free or included.
- The bounded API and pricing graph publishes no direct fine-tuning/training job, embeddings,
  provisioned throughput, reserved capacity, model deployment, or general media-generation price.
  Do not manufacture these offers from compatible request fields, open weights, or another seller.

### Commercial relationships

| Source offer or resource            | Relation                                      | Target and scope                                                                | Cost consequence                                                                                                                                                                                                        |
| ----------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Built-in `$web_search`              | `requires` and additive when realized         | Exact standard inference offers named by the built-in guide                     | Declaration costs nothing. Each matching emitted built-in call adds one search charge; every Chat request in the loop retains its own token charge.                                                                     |
| Formula `web-search`                | independently callable; `compatible_with`     | Exact K3/K2.6/K2.5 model-loop examples, without limiting direct Fiber execution | Model emission alone costs only output tokens. Each executed web-search Fiber adds the regional search charge; the following Chat request adds its own input/output tokens.                                             |
| Built-in and Formula search routes  | alternative delivery for one search execution | Same Kimi provider-service operation                                            | Select the actual route and signal; never charge both for one event. A workflow that deliberately executes separate calls through both routes may legitimately incur both, so they are not globally mutually exclusive. |
| Non-search Formula offer            | independently callable; optionally compatible | Any exact model workflow documented for that Formula URI                        | Current Fiber execution is within a temporary-free promotion. Subsequent model calls remain token-billed; no generic tool-call amount is added.                                                                         |
| Batch inference                     | resource/route prerequisite                   | A valid `purpose=batch` file and exact supported model                          | Use `requires_resource` for the file and exact route applicability for the model. Apply Batch rates only to realized result items; separate jobs remain independently chargeable.                                       |
| File extraction/storage             | independently callable; optionally compatible | Chat input, multimodal input, or Batch according to exact file purpose          | File operations are temporarily free. Extracted content becomes additive normal model input only when submitted; a Batch input file enables the job but adds no published file fee.                                     |
| Cache-hit and cache-miss components | partition                                     | Input tokens of one inference result                                            | Each input token is billed once as hit or miss. Do not add cache write/storage or count total input again.                                                                                                              |
| Voucher balance                     | ordered allowance over                        | Eligible charges in the exact regional account                                  | Voucher value reduces settlement according to account state but does not change public rates or count toward recharge-tier qualification.                                                                               |
| Cash/prepaid balance                | settlement source                             | Remaining charges for the regional account                                      | Balance availability gates requests. Negative cash and voucher interaction remain account state, not a model discount.                                                                                                  |
| Regional currency book              | account-selected alternative                  | China CNY or international USD for one credential/request                       | Apply exactly one platform's rates. Keys, balances, origins, currencies, taxes, and vouchers never merge.                                                                                                               |
| Enterprise Order Form               | account-specific replacement/override         | Exact contracted services and credential                                        | Contract terms can replace public settlement only when account evidence binds them; public PAYG remains the uncontracted comparison baseline.                                                                           |

### Meters, denominators, signals, and phase

| Commercial atom                         | Public denominator or state                      | Required signal or reconstruction                                                                                                                                                                 | Earliest resolution phase |
| --------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Standard cache-hit input                | million input tokens                             | Chat `cached_tokens`                                                                                                                                                                              | Outcome                   |
| Standard cache-miss input               | million input tokens                             | Exact `prompt_tokens - cached_tokens` for Kimi-family rows                                                                                                                                        | Outcome                   |
| Standard output                         | million output tokens                            | Chat `completion_tokens`; reasoning is included rather than additive                                                                                                                              | Outcome                   |
| Moonshot V1 input/output                | million input/output tokens                      | Returned prompt/completion usage, without an invented cache split                                                                                                                                 | Outcome                   |
| Batch cache-hit/cache-miss/output       | million tokens                                   | Per-result usage where the exact component exists. Current examples expose prompt/completion/total but no `cached_tokens`, so hit/miss reconstruction remains partial.                            | Result item/account       |
| Built-in web-search call                | one matching `$web_search` call item             | A response with `finish_reason=tool_calls`, then count exact `message.tool_calls[]` items whose function name is `$web_search`; declaration, `finish_reason=stop`, and ordinary tools count zero. | Outcome                   |
| Formula web-search Fiber                | one `moonshot/web-search:latest` Fiber execution | Exact Formula URI plus the POSTed Fiber execution/billing event. Fiber status and later account evidence must preserve uncertainty about failed-call charging.                                    | Outcome/account           |
| Non-search Formula Fiber                | promotional `free`; no numeric denominator       | Exact Formula URI and Fiber execution/status establish use, not a numeric charge. The promotion's end and post-promotion meter remain unpublished.                                                | Outcome/account           |
| File service                            | promotional `free`; no numeric denominator       | Exact file route, purpose, file ID, storage/extraction state, and account quota. Downstream model usage is a separate token signal.                                                               | Request/outcome/account   |
| Search-result content                   | ordinary input tokens only on follow-up          | Built-in `arguments.usage.total_tokens` is explanatory; the authoritative charge quantity is the next Chat response's `prompt_tokens`, which already includes search content.                     | Next outcome              |
| Token estimate                          | estimated input tokens                           | Token Estimate `data.total_tokens`                                                                                                                                                                | Preflight                 |
| Recharge-tier quotas                    | concurrency, RPM, TPM, and TPD                   | Exact regional cumulative cash recharge threshold and current account tier; vouchers do not qualify                                                                                               | Enrollment/account        |
| Available/voucher/cash balance          | regional currency amount                         | Authenticated `/v1/users/me/balance` fields and voucher validity                                                                                                                                  | Account                   |
| Project budgets and settled consumption | regional currency amount                         | Console budget, organization/project consumption, invoice, or account evidence; enforcement may lag about ten minutes                                                                             | Account/settlement        |

The web-search amount is not a generic `tool_call` rate. The built-in signal occurs in the model
response before the provider performs the follow-up search flow, whereas the Formula signal occurs
only when the caller creates the specific Fiber. A response can contain multiple tool calls, so
request-level booleans and `successful_tool_calls` counters are dimensionally wrong even when they
happen to produce the same total for a one-call example.

### Requested, realized, allowance, enrollment, and settlement state

- Request-time state selects regional credential/origin, model, standard versus Batch route,
  reasoning controls, file purpose, declared ordinary or built-in tools, and optional Formula URI.
  Declarations and planned tool loops establish eligibility and estimates, not realized provider
  service charges.
- Outcome state supplies returned model and usage, exact built-in tool-call items, subsequent Chat
  usage, Formula URI/Fiber identity/status, and Batch result-item outcomes. Tool charging cannot be
  derived from the original Chat request alone.
- Allowance state contains voucher amount, validity, eligibility, and deduction behavior. The
  international recharge voucher and China K3 new-user exclusion are account-scoped grants, not
  public model discounts or catalog rows.
- Enrollment state contains platform/key ownership, minimum recharge where applicable, cumulative
  cash recharge tier, concurrency/RPM/TPM/TPD, organization/project membership, Formula or Batch
  access, file quotas, risk controls, and enterprise approval. These gates alter availability, not
  the published marginal rate.
- Settlement state contains cash/voucher/available balances, taxes, invoice treatment, console
  consumption, enterprise Order Form terms, and adjustments. No public per-request monetary charge
  or Usage/Costs API with a freshness contract is documented.
- China and international state never falls back across platforms. A key rejected by one origin
  does not establish availability, price, or balance on the other.

### Commercial-atom disposition ledger

| Reviewed atom class                                          | Design disposition                                                                                                                                                                                             |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Standard regional token rows                                 | Normalize exact CNY and USD books with cache-hit/cache-miss/output components and regional route identity.                                                                                                     |
| Moonshot V1 token rows                                       | Bind the published input rate to full `prompt_tokens` and output to `completion_tokens`. Do not subtract `cached_tokens` or invent a cache rate when the table publishes no cache dimension.                   |
| Batch rows                                                   | Normalize as separate async offers. Retain K2.7's numeric row and the conflicting guide scope instead of deleting either or claiming confirmed callability.                                                    |
| Standard/Batch split                                         | Publish distinct synchronous and asynchronous offers; remove the legacy `service_tier` selector after the split.                                                                                               |
| Built-in `$web_search` amount                                | Normalize as a Kimi provider-service rate with exact per-matching-call denominator, emitted-call binding, supported-model scope, and `requires` relation.                                                      |
| Formula `moonshot/web-search:latest`                         | Normalize as a route-distinct web-search offer using the linked regional amount and Fiber billing event. Preserve the price page's built-in-only wording and failed-Fiber semantics as applicability warnings. |
| Generic prototype `tool_call` meter                          | Reject. It conflates ordinary caller functions, built-in emissions, and Formula executions, whose billers, signals, phases, and outcomes differ.                                                               |
| Prototype `successful_tool_calls`/request binding            | Reject. Built-in billing is triggered by each exact emitted `$web_search` item even if the caller stops; multiple matching items cannot be collapsed to one request success.                                   |
| Prototype web-search `compatible_with` relation              | Replace for the built-in route with `requires` plus exact inference compatibility. Keep Formula direct execution independent and model-loop use compatible rather than required.                               |
| Eleven non-search official Formula tools                     | Normalize exact URI offers with temporary `free` state and unknown validity end. Do not create numeric-zero rates or a universal tool-execution meter.                                                         |
| Prototype generic Formula execution signal                   | Reject as a priced universal counter. Preserve exact URI/Fiber activity and status; add a numeric meter only when a first-party tool-specific price publishes one.                                             |
| Ordinary function tools                                      | Exclude from Kimi provider-service pricing. Preserve model token usage and externally billed execution separately.                                                                                             |
| Search-result token quantity                                 | Preserve as explanatory composition evidence; charge only the next response's authoritative prompt usage and never add the quantity twice.                                                                     |
| File upload, extraction, and storage                         | Normalize a standalone provider service with promotional `free` state, operation/purpose, quotas, and downstream token relation. Do not flatten missing numeric pricing into zero.                             |
| `moonshot-v1-auto`                                           | Retain callable model and explicit unknown price. Unequal concrete context variants plus no resolved billed-model signal prohibit assigning a guessed rate.                                                    |
| Recharge tiers and risk/capacity limits                      | Preserve enrollment and account quotas. A zero China Tier0 threshold or free limit increase is not a free inference offer.                                                                                     |
| Vouchers, balances, budgets, taxes, invoices                 | Preserve allowance/control/settlement state with exact region and timing. They do not modify public rate observations.                                                                                         |
| PAYG, enterprise, Membership, Business, and Kimi Code        | Keep Open Platform PAYG and custom procurement facts; explicitly exclude separate consumer/team/code subscriptions from API price coverage unless a future exact credential entitlement binds them.            |
| Products absent from the bounded direct API                  | Emit no speculative training, embeddings, provisioned throughput, deployment, reserved capacity, or media price. Reconsider only from exact first-party commercial evidence.                                   |
| Missing, malformed, conflicting, or temporarily absent claim | Suppress only the affected claim, retain compatible prior evidence with freshness, and keep sibling models, rates, routes, free states, relationships, and account facts.                                      |

### Authority, conflicts, and claim-local refresh

Authority is specific to each claim:

1. Each regional canonical price page owns current amounts in its own currency and platform. China
   and international observations are alternatives, not conflicts or candidates for FX-based
   cheapest-price selection. The account's exact origin/key/balance resolves applicability.
2. The web-search table labels its unit “per successful tool call,” but the detailed billing logic
   says an emitted exact `$web_search` item is charged even if the caller stops. The detailed rule
   owns the event trigger; retain the shorter table label as a wording conflict rather than waiting
   for backend success or rejecting the numeric rate.
3. The Formula guide's general temporary-free statement does not apply to `web-search`: that exact
   row explicitly delegates pricing and availability to the paid WebSearch page and says the Fiber
   step produces billing. This more specific claim owns the operation. The amount is therefore
   usable on the Formula route with a warning that the dedicated price prose still describes only
   `$web_search`; failed-Fiber charging remains unknown.
4. K3's price page warns that `web_search` is being updated and calls its documentation outdated,
   while the current built-in guide includes K3 examples and recommends the Formula channel for
   K3. Preserve the exact compatibility evidence, the Formula recommendation, and the operational
   warning together. Do not turn the warning into a missing price, a global K3 tool disablement, or
   silent proof that both routes behave identically.
5. The Batch price page lists K2.7 and says Batch supports it, while the detailed workflow still
   restricts bodies to K2.6/K2.5. Preserve K2.7's numeric rate and a conflicting applicability
   observation. K2.6/K2.5 remain exactly bindable; neither sibling loses rates because one model's
   route scope conflicts.
6. The model catalog and OpenAPI own identities/callable route enums; price-only mentions do not
   create models. `moonshot-v1-auto` remains unknown-priced because no price or returned resolved
   variant bridges its callable identity to unequal concrete V1 rates.
7. A temporary-free statement is an exact non-numeric commercial state. It must not become numeric
   zero, permanent free, or evidence that downstream model tokens, network traffic, storage after
   the promotion, or failed execution have zero cost.
8. Account APIs and console facts own availability, allowances, quotas, and settlement. They cannot
   override list prices or prove a realtime per-request charge. Enterprise Order Forms override
   only their bound accounts.

Refresh remains deterministic and non-LLM. Regional catalogs, OpenAPI, each model-price document,
Batch price and route guides, built-in search pricing and usage, Formula inventory and Fiber
semantics, Files, lifecycle, account limits, balance, payments, product comparison, terms, and
`llms.txt` discovery are independent claim groups. Validate exhaustiveness only within a source's
proven scope. A missing page, malformed row, changed wording, new Formula URI, unsupported MDX
fragment, authenticated failure, or one regional drift suppresses that claim or retains a compatible
prior claim as stale; it must not erase a model, sibling rate, other route, service, free state, or
the other regional book. Every recognized commercial atom receives a normalized, derived,
included, externally billed, account-only, superseded, conflicting, unsupported, ambiguous, or
pending disposition.

### Model-detail composition and cost coverage

K3 model details show the exact regional cache-hit, cache-miss, and output components, then
compose optional Kimi web search as a separate provider service. The built-in and recommended
Formula routes must display their different trigger phases and the same regional per-call amount
with the Formula applicability caveat. Non-search Formula tools appear as a separate limited-time
free service family; ordinary caller tools do not acquire a Kimi fee. File service state and Batch
eligibility remain separate from K3's token row. Voucher, balance, and enterprise facts stay in
account or reconciliation evidence rather than becoming public model rates.

Pre-request calculation can estimate token cost for the selected regional model but must assign no
search calls merely because a tool was declared. Post-response calculation adds one built-in search
rate for every exact emitted `$web_search` item, or one Formula search rate for every executed
`moonshot/web-search:latest` Fiber, then adds every realized Chat request's token usage. Search
content is charged only through the follow-up prompt usage. Formula tool-call emission, a
temporary-free non-search Fiber, file upload, and cache construction add no numeric rate. Partial
coverage remains explicit for Formula failure charging, K2.7 Batch applicability, Batch cache
partition, `moonshot-v1-auto`, voucher expiry, tax, delayed budgets, and enterprise settlement; none
is a reason to reject the model or its compatible price components.

## Request usage, account cost, and gateway decision

Chat Completions returns `prompt_tokens`, `completion_tokens`, `total_tokens`, and
`cached_tokens`. Standard Kimi-family input, cache-read, and output rate variants respectively bind
to uncached input (`prompt_tokens - cached_tokens`), cached input, and output usage. Moonshot V1's
single input rate instead binds to full `prompt_tokens`; no separate cache dimension means there is
nothing to subtract or charge twice. Streaming can return whole-request usage in the final chunk when
`stream_options.include_usage` is requested, but an interrupted stream may never deliver that
chunk. The Token Estimate API's `data.total_tokens` is a pre-request estimate, not a charged-cost
record. Batch output records publish prompt, completion, and total tokens, but the Batch guide does
not document `cached_tokens`, so exact cache-hit/uncached Batch reconstruction remains unbound even
though both rates are published. Output rates for the guide's exact K2.5/K2.6 scope bind to
completed result-item output usage; K2.7 Batch pricing remains unbound because the price page and
guide disagree on its supported scope.

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
