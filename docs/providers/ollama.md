# Ollama

## Official source topology and refresh

- Production refresh uses only first-party Ollama surfaces. The non-exhaustive Library at
  `https://ollama.com/library` supplies current family identities, descriptions, capability badges,
  and update dates. An untagged family name is callable as its default/`latest` tag; the collector
  never invents size, quantization, `:cloud`, `-cloud`, or community-namespace identities.
- Ollama Cloud combines public `GET https://ollama.com/api/tags`, the Cloud-filtered Library search,
  every current Cloud family page, and `POST https://ollama.com/api/show` for the union of exact list
  IDs and family-page IDs. Family pages provide the authoritative mapping from Library tags such as
  `name:cloud` or `name-cloud` to direct Cloud API IDs. Reconcile these witnesses per identity and
  claim. A missing or malformed page/detail withholds that dependent claim or retains a compatible
  prior value as stale; it does not erase valid sibling models or the other inventory witness.
- Fixed first-party companions include both official `llms.txt` indexes, canonical Markdown for the
  API introduction, list/show contracts, usage, authentication, Cloud routing, OpenAI/Anthropic
  compatibility, web search, tool calling, thinking, and vision, plus raw OpenAPI, pricing, and
  terms. The indexes are discovery sentinels: a new commercial, billing, quota, cache, or usage page
  becomes pending/unbound until reviewed; it cannot silently disappear or suppress recognized
  claims.
- Ollama documents the local base as `http://localhost:11434/api` and the same Cloud API at
  `https://ollama.com/api`. The API is not strictly versioned, but is expected to remain stable and
  backwards compatible; rare deprecations are announced in GitHub release notes. Release notes are
  policy evidence, not a structured exhaustive model-history feed, so they do not create rows.
- Refresh is deterministic and requires no LLM. It uses exact URLs and hosts, bounded response and
  model counts, schema validation, semantic assertions, normalized page/API payloads, and atomic
  dependency hashes. CI never authenticates or contacts an arbitrary local runtime.

## Identity, API contract, and resilient matching

- The official List Models contract fixes `GET /api/tags`, operation ID `list`, `ListResponse`, and
  `ModelSummary`. The collector owns `name`, `model`, `modified_at`, `size`, `digest`, and the detail
  shape, and accepts the documented optional `remote_model` and `remote_host` fields. Those optional
  transport fields do not manufacture a second catalog identity.
- The official Show Model Details contract fixes `POST /api/show`, operation ID `show`,
  `ShowRequest`, and `ShowResponse`. Capabilities, `model_info`, modification time, and exact parent
  identity provide tasks, modalities, context/embedding limits, updates, and Cloud identity checks.
  Documented optional parameters, license, and template fields are recognized but do not imply
  provider-neutral semantics.
- Raw OpenAPI is independently checked for version 3.1.0, current document version 0.1.0, local
  server and bearer scheme, Tags/Show requests and responses, Generate/Chat/Embed routes, and native
  prompt/output usage counters. New unrelated endpoints do not fail collection.
- Additive fields in list items or successful Show responses are accepted with bounded
  source-contract diagnostics so ordinary API evolution does not interrupt refresh. Unknown fields
  and capability values remain raw diagnostics; malformed owned fields suppress only their dependent
  facts. An exact identity contradiction can invalidate that model/route claim, while count,
  envelope, or status drift cannot erase independently valid rows. Request-specific UUIDs in 410
  retirement errors and unordered list ordering are removed before hashing; family pages are reduced
  to exact Cloud tags, usage levels, rate cards, and enrollment notes.
- Library and Cloud are independent channels. Exact overlaps retain both source and service-family
  evidence. A Cloud retirement is published only for an exact identity with no current Library
  evidence; current Library presence keeps the global row active.

## Model boundary

- The public Library is curated and non-exhaustive. Ollama publishes no stable global endpoint for
  every community namespace and every tag. `/api/tags` on a local daemon describes that operator's
  installed state, not Ollama's global offer, and therefore cannot fill this boundary in CI.
- Cloud docs say models may be deprecated and retired. Current list/page/detail probes capture
  visible transitions, while the Cloud guide publishes current upcoming and recent retirement
  tables with recommended alternatives and exact 410 responses confirm individual retired routes.
  No first-party public API exposes complete disappeared-model history. Historical Cloud
  completeness remains intentionally bounded rather than reconstructed from downstream catalogs.

## Public price coverage

- The pricing page publishes plans and allowance mechanics, not a general per-model dollar price
  book: Free is `$0`; Pro is `$20/month` or `$200/year`; Max is `$100/month` with new sign-ups
  paused; Team is an introductory `$25/seat/month` with a five-seat minimum, included usage, and a
  waitlist; Enterprise is custom. Session limits reset every five hours, weekly limits every seven
  days, and concurrency varies by plan. Pro includes 50 times Free usage and Max five times Pro, but
  the Free baseline and exact weighted allowance quantities are not public.
- Individual allowance consumption depends on model plus input, cached-input, and output tokens.
  Most Cloud pages publish only ordinal usage levels 1 through 4, currently labeled Low, Medium,
  High, or Extra High. Preserve the exact class as a raw allowance fact; it is neither currency nor
  a stable multiplier. Those rows remain `not_published` rather than receiving a guessed rate.
- Kimi K3 currently publishes `$3.00` input, `$0.30` cached input, and `$15.00` output per million
  tokens. Its page also says the model requires Pro or Max and always consumes extra usage credits.
  These rates therefore belong to a plan-gated extra-usage offer, not an unconditional model rate or
  included subscription allowance. Other Cloud rows retain their official usage-level raw fact and
  `not_published` extra-usage amount until an exact card appears.
- Local execution is not Ollama-billed inference, but its compute is operator-borne rather than
  economically nonexistent. Model it as an `externally_billed` local execution path, separate from
  the `$0` Free account plan and Cloud allowances. Plans, allowances, taxes, automatic renewal,
  one-year extra-credit expiry, and custom Enterprise terms remain distinct commercial or
  settlement facts rather than exclusions.

## Request, response, and cost boundary

- Native Generate/Chat responses return `prompt_eval_count` and `eval_count`; streaming emits them
  in the final `done: true` chunk. OpenAI compatibility can include usage. Anthropic compatibility
  reports approximate tokenizer counts and does not support prompt caching.
- Native OpenAPI still exposes no cached-input token count even though pricing says cached input
  affects usage. Consequently even Kimi K3 cannot be reconstructed exactly from a normal response
  when cache reads occur. No public Usage/Costs ledger API or freshness contract is documented.
- Thinking, vision input, and client-executed tool follow-ups can alter work or token volume. Ollama
  publishes no separate thinking/image or generic function-call billing meter, and tool execution is
  client-side. Ollama Web Search and Web Fetch are separate provider-owned APIs with no public price
  or billable denominator; a free account requirement proves access, not zero cost. A gateway may
  estimate a published marginal token charge only when an exact rate and every billed counter exist;
  it cannot derive account-effective allowance cost before a request.

## Commercial topology audit

Design status: implemented. Library rows share one provider-wide local-execution offer with operator
settlement because the commercial mechanism and external-cost boundary are identical for every
admitted local model; Cloud rows carry the plan, included-allowance, extra-balance, Web Search, Web Fetch, and
model-inference books described below. Team uses the exact seat-month denominator. A model card that
publishes a Pro/Max extra-usage gate receives two cumulative `requires` relationships: Pro and Max
are alternatives in one relationship, and the personal extra-usage balance is the second
requirement. Native `eval_count` binds only the output component; input and cache-read rates remain
unbound when the response has no authoritative split.

### Public commercial source graph

| Surface                                                                                                                                                                                                                                                                             | Exact authority and completeness boundary                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The curated [Library](https://ollama.com/library), [Cloud-filtered search](https://ollama.com/search?c=cloud), public [`GET /api/tags`](https://docs.ollama.com/api/tags), exact family/tag pages, and [`POST /api/show`](https://docs.ollama.com/api-reference/show-model-details) | Distribution families, current Cloud candidates, direct callable IDs, local-to-Cloud route aliases, capabilities, limits, ordinal usage classes, exact model rate cards, and account-enrollment notes. The Library is intentionally non-exhaustive; a local daemon's installed tags are account/operator state rather than global inventory. |
| The current [Pricing](https://ollama.com/pricing) page and [Terms](https://ollama.com/terms)                                                                                                                                                                                        | Current Free, Pro, Max, Team, and Enterprise acquisition, amounts, billing periods, relative allowances, reset periods, concurrency, included/extra usage order, enrollment state, renewal, taxes, and purchased-credit expiry. Pricing-page model examples do not create inventory.                                                         |
| [Cloud Models](https://docs.ollama.com/cloud) and its current retirement tables                                                                                                                                                                                                     | Local offload versus direct Cloud routing, exact suffix/direct-ID examples, account requirement, current availability pointer, route-specific deprecations, retirement dates, and recommended alternatives. A Cloud retirement does not retire an independently available local artifact.                                                    |
| [Usage](https://docs.ollama.com/api/usage), raw OpenAPI, and OpenAI/Anthropic compatibility                                                                                                                                                                                         | Native prompt/output counters, terminal streaming usage, route schemas, compatibility quantities, and documented precision limits. Compatibility does not create another commercial offer or make copied local aliases global identities.                                                                                                    |
| [Web Search and Web Fetch](https://docs.ollama.com/capabilities/web-search), tool calling, thinking, vision, and embeddings                                                                                                                                                         | Two independently callable Ollama provider services, API-key enrollment, response shapes, client-executed tool composition, and modality behavior. Capability or an example agent loop is not evidence of a generic tool fee, an included allowance, or a provider-executed model add-on.                                                    |
| Account settings, usage progress, extra-usage balance, subscription, and team administration linked by the public pricing surface                                                                                                                                                   | Account-effective allowance, balance, renewal, membership, and settlement. No public usage/cost ledger API or stable unauthenticated amount endpoint is documented; authenticated values cannot become global facts.                                                                                                                         |
| API stability policy and exact GitHub release notes                                                                                                                                                                                                                                 | Deprecation policy and exact runtime/route changes when named. Release notes are not an exhaustive model or commercial-history feed and cannot create rows or current prices.                                                                                                                                                                |

models.dev, LiteLLM, gateway registries, upstream model creators, and external hosting partners remain
comparison evidence only. Ollama is the seller for Ollama Cloud; another seller's price for the same
underlying weights never becomes an Ollama rate.

### Books, resources, and offer boundaries

- The Library is a distribution catalog, not one globally hosted inference offer. An exact family can
  have a local artifact route, an Ollama Cloud route, both, or only descriptive Library evidence.
  Local tags and direct Cloud IDs are route identities over the same catalog candidate only when an
  exact first-party family page or Cloud guide maps them.
- Local runtime inference is a distinct execution mechanism. Ollama charges no provider inference
  usage for computation performed on the user's machine, but hardware, energy, administration, and
  any external hosting remain operator cost. Represent the local execution offer as
  `externally_billed`, not a zero-price Cloud model and not commercial nonexistence. The free runtime,
  public weights, and unlimited local use are distribution/software facts around that boundary.
- Free is a public subscription/account offer explicitly priced at `$0`. It includes a bounded but
  unpublished amount of eligible Cloud usage and one concurrent Cloud model. This makes the plan
  `free`; it does not make Cloud inference unlimited or give every Cloud model a zero rate. Exact
  Kimi K3 evidence excludes Free.
- Pro is one subscription offer with alternative billing-period variants of `$20/month` and
  `$200/year`. It is open to new enrollment, includes 50 times the unspecified Free Cloud usage,
  allows three concurrent Cloud models, enables private-model upload/sharing, and permits purchase
  of extra usage. The relative allowance is useful but cannot be converted to tokens or money.
- Max is `$100/month`, includes five times Pro usage, and permits ten concurrent Cloud models and
  extra usage. New enrollment is paused while existing subscribers retain their plan, limits, and
  price. Preserve numeric price separately from `closed_to_new` enrollment; do not retire or hide the
  plan.
- Team is currently introductory `$25/seat/month` with a five-seat minimum and a waitlist. Each seat
  has an unpublished included usage allowance; after that, usage consumes one organization-shared
  extra-usage balance. The pricing FAQ explicitly derives a `$125/month` minimum seat charge and says
  automatic usage billing can be disabled. Team creates a separate account from a member's personal
  account, so balances and allowances never merge by inference.
- Enterprise is a `custom_quote` subscription/contract offer with volume pricing, custom terms,
  support, security/procurement help, and deployment planning. “Everything in Team” does not prove
  Kimi K3 eligibility, exact included usage, concurrency, or a public overage amount.
- Included Cloud usage is an allowance inside each eligible plan, not a model price. Individual
  consumption depends on model plus input, cached-input, and output tokens, with session limits
  resetting every five hours and weekly limits every seven days. The exact baseline, weighting,
  counter, and reset anchors are unpublished. Pro's `50x`, Max's `5x`, and model levels 1–4 remain
  relative/raw allowance facts rather than invented quantities.
- Extra usage is a usage-priced Cloud inference mechanism settled from a purchased balance after the
  included allowance for ordinarily eligible Pro/Max/Team traffic. Its amount is model specific.
  Preserve a `not_published` amount for a model until its exact public card supplies rates; an ordinal
  usage level cannot fill that gap. Purchased credits expire one year after being added and are a
  prepaid settlement source, not included usage or a discount.
- Kimi K3 is the current exact exception: its Cloud inference offer publishes `$3.00` uncached input,
  `$0.30` cached input, and `$15.00` output per million tokens, requires either Pro or Max, and always
  consumes extra usage credits. The subscription fee and token charge therefore compose. Kimi K3
  does not first consume the plan's included allowance, and its page establishes no current Free,
  Team, or Enterprise applicability.
- Ollama Web Search and Ollama Web Fetch are independently callable provider-service offers under an
  Ollama API key. Both exist even without model inference, and the documented search-agent loop has
  the client invoke them. No public amount, denominator, quota, or relation to Cloud plan allowances
  is published, so both use `not_published` rather than `free`, `included`, or a fabricated per-call
  rate.
- Ordinary function calling is model output plus client-owned execution. Supplying tools can consume
  input tokens, and every follow-up inference request has its own usage, but Ollama publishes no
  generic function-call event fee. When the client chooses Ollama Web Search/Fetch, preserve those
  separate provider-service events; arbitrary functions remain external/operator cost.
- Native local API, local Cloud offload, direct `ollama.com` API, OpenAI compatibility, Anthropic
  compatibility, and SDKs are delivery routes. They do not duplicate a plan or model offer. A copied
  local alias such as `gpt-3.5-turbo` or `claude-3-5-sonnet` is operator state, not a global Ollama
  identity or price binding.
- Private-model upload/sharing, queueing above concurrency, account routing, and future priority
  tiers are plan entitlements or announced possibilities. No independent storage, queue, priority,
  Batch, fine-tuning, or deployment rate is currently public; do not manufacture those offers from
  feature text.

### Commercial relationships

| Source offer or resource       | Relation                                    | Target and scope                                                           | Cost consequence                                                                                                                          |
| ------------------------------ | ------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Free/Pro/Max included usage    | allowance over                              | Exact Cloud inference eligible for that plan                               | Consumes opaque model/token-weighted session and weekly quotas before any eligible extra balance; the allowance is not a zero model rate. |
| Team seat allowance            | allowance over                              | Eligible Cloud usage by that member in the separate team account           | Consume the member's included usage first, then the organization's shared extra-usage balance.                                            |
| Pro or Max extra-usage balance | fallback settlement                         | Eligible ordinary Cloud inference after included plan usage                | Apply the exact model token rate when published; missing amount remains `not_published`.                                                  |
| Team extra-usage balance       | fallback settlement                         | Eligible team Cloud inference after the member's allowance                 | Settle from the shared organization balance or enabled usage billing; never consume a personal balance by inference.                      |
| Kimi K3 extra-usage inference  | `requires` with Pro and Max as alternatives | Active Pro or existing Max subscription plus funded extra-usage settlement | Subscription and token charges compose. Included plan usage does not cover Kimi K3.                                                       |
| Local Cloud alias              | realized route mapping                      | Exact direct Cloud ID proven by the family page/Cloud guide                | Price the Cloud offer once when offloaded; the alias is not a second model or a simultaneous local-compute charge.                        |
| Local artifact inference       | external execution boundary                 | Operator hardware/runtime                                                  | No Ollama Cloud usage is charged; operator or external infrastructure cost remains outside Ollama settlement.                             |
| Web Search or Web Fetch        | client-controlled composition               | Any workflow that explicitly invokes the standalone endpoint               | Preserve the completed provider-service call with unknown amount. Do not infer an add-on merely from model tool capability.               |
| Caller function loop           | client-controlled composition               | Each explicit inference follow-up plus selected external/provider service  | Charge each model request from its own applicable accounting; no generic emitted-tool-call term is added.                                 |
| Max and Team enrollment state  | availability qualifier                      | Existing Max subscribers or Team waitlist applicants                       | Numeric plan prices remain valid even though new acquisition is paused or waitlisted.                                                     |

### Meters, denominators, signals, and phase

| Commercial atom               | Public denominator                                                  | Required signal or reconstruction                                                                        | Phase                        |
| ----------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Pro monthly subscription      | Account month                                                       | Active Pro monthly enrollment                                                                            | Enrollment/account           |
| Pro annual subscription       | Account year                                                        | Active Pro annual enrollment                                                                             | Enrollment/account           |
| Max subscription              | Account month                                                       | Existing active Max enrollment                                                                           | Enrollment/account           |
| Team subscription             | Seat-month, minimum five seats                                      | Active team seat count and billing period                                                                | Enrollment/account           |
| Enterprise                    | Contract denominator not public                                     | Exact negotiated contract                                                                                | Enrollment/account           |
| Included individual usage     | Opaque weighted usage across model, input, cached input, and output | Ollama account usage progress for the session/weekly windows; public API signal absent                   | Account                      |
| Included Team usage           | Opaque weighted member usage                                        | Exact member allowance progress in the team account                                                      | Account                      |
| Model usage level             | Ordinal class 1–4, not a billable denominator                       | Exact current family/tag page label                                                                      | Publication/request estimate |
| Kimi K3 uncached input        | Million input tokens                                                | Exact uncached-input quantity; native total input has no documented cached decomposition                 | Outcome/account              |
| Kimi K3 cached input          | Million cached-input tokens                                         | No documented native/OpenAI/Anthropic authoritative counter                                              | Unbound/account              |
| Kimi K3 output                | Million output tokens                                               | Native `eval_count` or an exact compatible usage quantity; thinking inclusion remains under-documented   | Outcome/account              |
| Purchased extra-usage balance | Account credit amount                                               | Account purchase, remaining balance, expiry, and model-rate debit                                        | Account                      |
| Cloud concurrency             | Simultaneously running models                                       | Active model slots: Free 1, Pro 3, Max 10; requests beyond the limit queue or reject                     | Request timeline/account     |
| Web Search                    | No published commercial denominator                                 | Completed `POST /api/web_search`; requested/max returned result count is not a documented charge signal  | Outcome/account              |
| Web Fetch                     | No published commercial denominator                                 | Completed `POST /api/web_fetch`; one returned document is not a documented charge signal                 | Outcome/account              |
| Local runtime inference       | Operator compute/infrastructure                                     | Local route realization and operator observability                                                       | External/operator            |
| Account-effective Cloud cost  | Account currency amount                                             | Subscription invoice, extra-usage balance debit, or team/Enterprise billing record; no public ledger API | Account                      |

Native `prompt_eval_count` and `eval_count` are useful performance/usage signals, and streaming places
them in the final `done: true` chunk. They are not enough to reconstruct opaque plan consumption or
Kimi K3 cached-input cost. OpenAI compatibility can return usage; Anthropic counts are explicitly
approximate and omit prompt-cache support. Image, audio, embedding, and thinking accounting remain
partial unless an exact billed quantity is documented.

### Requested, realized, allowance, enrollment, and settlement state

- Request state selects local versus Cloud route, local alias or direct ID, account/API key,
  compatibility interface, model, images, thinking level, tool definitions, and explicit Web
  Search/Fetch calls. It establishes eligibility and a partial estimate, not route realization,
  cache class, output quantity, allowance consumption, or settled amount.
- Outcome state supplies the realized local/remote model, native prompt/output counters, terminal
  streaming usage, emitted caller tool requests, and completed Search/Fetch responses. An emitted
  tool request is not proof that any tool executed or that Ollama charged a service.
- Allowance state contains the plan's session/weekly progress, member seat allowance, opaque model
  weighting, and reset timing. It determines whether ordinarily eligible usage is included before
  overage. Kimi K3 has an exact exclusion from that order because its page says it consumes extra
  credits directly.
- Enrollment state distinguishes open Free and Pro, closed-to-new Max, Team waitlist, custom
  Enterprise, Kimi K3's Pro/existing-Max gate, API-key access, and separate personal/team accounts.
  It controls acquisition and callability independently of plan price and model lifecycle.
- Settlement state contains subscription billing interval, purchased/automatic extra usage,
  balance expiry, team shared balance, taxes, and invoice/contract adjustments. Those account facts
  own paid cost; public rates and response usage remain only list/marginal evidence.

### Commercial-atom disposition ledger

| Reviewed atom class                       | Design disposition                                                                                                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Library families and tags                 | Preserve distribution and exact route identities. Do not turn every tag or community namespace into a hosted offer.                                                        |
| Local execution                           | Preserve an `externally_billed` operator-compute offer. Do not flatten local inference to provider price zero or conflate it with the Free Cloud plan.                     |
| Free plan                                 | Normalize as a `free` subscription with unpublished included Cloud allowance and one-model concurrency, not as free unlimited inference.                                   |
| Pro                                       | Normalize monthly/annual amount variants, open enrollment, relative allowance, concurrency, private-model entitlement, and extra-usage eligibility.                        |
| Max                                       | Normalize monthly amount, relative allowance, concurrency, extra-usage eligibility, and `closed_to_new` state while retaining existing-customer applicability.             |
| Team                                      | Normalize introductory seat-month amount, five-seat minimum, waitlist, separate account, member allowance, and shared overage settlement.                                  |
| Enterprise                                | Preserve a `custom_quote` contract offer and only its published entitlements.                                                                                              |
| Included usage                            | Preserve opaque allowance, relative plan ratios, session/weekly reset periods, and account-only progress. Do not fabricate token quantities or dollar value.               |
| Model usage levels 1–4                    | Preserve as ordinal workload/allowance classes only. Never use the ordinal as a multiplier, quantity, or price.                                                            |
| Extra-usage balance                       | Preserve prepaid/automatic settlement order, exact plan/account scope, and one-year purchased-credit expiry. It is not included usage.                                     |
| Kimi K3 rates and gate                    | Normalize three plan-gated numeric token rates and `requires` alternatives Pro/Max. Mark cached accounting and account-effective totals partial.                           |
| Other Cloud extra-usage rates             | Keep `not_published` until an exact first-party rate card appears; upstream or comparator rates cannot fill the gap.                                                       |
| Web Search and Web Fetch                  | Preserve separate provider-service offers, API/result signals, account enrollment, and `not_published` amount/denominator. Free-account access is not free-price evidence. |
| Caller tools                              | Preserve capability and client execution. Emit no generic Ollama function-call rate; compose only explicit model follow-ups and selected services.                         |
| Thinking, vision, audio, embeddings       | Preserve applicability and observable quantities. Emit no distinct surcharge or zero term without exact billing evidence.                                                  |
| Native/OpenAI/Anthropic routes            | Preserve route and usage precision differences over one execution offer. Local aliases and compatibility names create no global rows.                                      |
| Private models, queues, future priority   | Preserve current plan entitlement or future/pending observation. Emit no storage, queue, or priority offer/rate.                                                           |
| Cloud retirements and replacements        | Preserve route-specific lifecycle. Local Library evidence can keep the catalog model active without reviving the Cloud route.                                              |
| Missing, malformed, or conflicting claims | Suppress only a malformed fact inside a complete bundle; an incomplete bundle retains the accepted provider pricing partition with visible staleness.                      |

### Authority and conflicts

Authority is specific to each claim:

1. Public `/api/tags` owns current direct Cloud IDs; Cloud search/family pages own visible route
   families, local suffix mappings, ordinal levels, exact cards, and enrollment notes. `/api/show`
   exact-enriches an identity. A disagreement is preserved per route/model and cannot erase all
   otherwise valid Cloud inventory.
2. The current pricing page owns plan amount, acquisition, allowance order, relative ratios, and
   concurrency. Its Max FAQ still says Kimi K3 is “coming soon,” while the current public API,
   Cloud-filtered Library, and Kimi K3 page expose it as callable. Treat that sentence as a stale
   capacity explanation, not inventory or lifecycle authority.
3. The Kimi K3 page owns its current Ollama-specific token amounts, Pro/Max gate, and direct
   extra-credit consumption. Moonshot's direct Kimi price book—including any direct tool-call term—
   belongs to a different seller and cannot add to or override the Ollama offer. Ollama publishes no
   generic function-call amount on this card or in its tool guide.
4. Model levels 1–4 and plan ratios describe relative allowance pressure. They do not conflict with
   Kimi K3 dollar rates because the dimensions and applicability differ. Never compare or convert
   them into a “cheapest” value.
5. `$0` owns the Free subscription price. “Run models on your hardware” and “unlimited local” own
   provider-account limits, not the economic cost of compute. Preserve external/operator cost rather
   than reporting local inference as free.
6. The Web Search guide proves both Search and Fetch services plus API-key/free-account access. It
   publishes no price, included-plan relation, commercial denominator, or billable counter. Absence
   is `not_published`, not zero, and the search-agent example proves client composition rather than a
   server-executed add-on.
7. Native usage owns prompt/output counters; compatibility guides own their translated fields and
   precision. Pricing owns cached-input relevance. Because no response contract supplies the cached
   split, retain Kimi K3 cost as partial instead of assigning every input token the uncached or cached
   rate.
8. The Cloud retirement tables and exact current/410 responses own Cloud route lifecycle. Library
   presence owns surviving local distribution. A retired Cloud route cannot retire the catalog model
   or be silently revived by an unchanged local page.
9. Account settings and invoices own actual allowance, balance, tax, and settled amount. A relative
   limit, public rate, or response token count cannot override account evidence or claim invoice
   completeness.

Refresh remains deterministic and non-LLM. Library distribution, direct Cloud list, Cloud search,
each family page/tag, Show detail, plan, allowance, Kimi K3 rate component and gate, terms, usage
schema, compatibility route, Search, Fetch, caller tools, modalities, and lifecycle are independent
claim groups. Validate exhaustiveness only inside a source's proven scope. A new commercial-looking
page becomes pending/unbound; a malformed tag, unknown capability, count drift, stale
FAQ sentence, unbound price card, or unresolved replacement suppresses its dependent claim. A missing
commercial page retains the accepted provider pricing partition. None may erase another valid model, route, plan, service, or the
provider snapshot. Every recognized atom receives a normalized, included, externally billed,
account-only, custom-quote, not-published, superseded, conflicting, ambiguous, or pending
disposition.

### Model-detail composition and cost coverage

Model details should separate distribution from execution. Show exact local artifacts with the
operator-cost boundary and exact Cloud routes with eligible plans, route lifecycle, ordinal included
usage class, and extra-usage price state. A `$0` Free plan is not a `$0` model. Plan fees and
allowances are reusable account mechanisms and should not be copied into every model rate table.

Kimi K3 should explicitly compose an active Pro or existing Max subscription with its three
extra-credit token rates. Rate details bind output and any input whose cached partition is known,
and show incomplete coverage when only total prompt tokens are returned. They do not allocate the
recurring subscription fee to one request, consume included allowance, import a Moonshot tool-call
fee, or call the account invoice exact.

For other Cloud models, show the ordinal usage level and plan allowance uncertainty without guessing
token or dollar rates. Web Search and Web Fetch remain standalone Ollama provider services with
unknown prices. A client can compose them with a tool-capable local or Cloud model, but that does not
make them automatic model add-ons; charge composition begins only when the client actually invokes a
service and an exact amount/binding becomes available. Ordinary caller functions add only explicit
follow-up model requests and external execution cost.

## Comparator audit

- models.dev has a standalone Ollama Cloud generator that reads official Tags/Show, removes missing
  TOMLs, and preserves manually enriched fields. It is not wired into the common provider sync and
  does not read Ollama's plan, allowance, family-page pricing, enrollment, Web Search, or settlement
  surfaces. Its current rows are useful inventory/capability drift alarms, not a commercial book.
- LiteLLM's current central map gives zero input/output cost to local Ollama entries and a small set
  of `-cloud` aliases, including identities no longer in the current Cloud list. That zero reflects
  the local-runtime assumption; it cannot represent operator compute, subscriptions, opaque included
  usage, Kimi K3 extra-credit rates, or route lifecycle.
- Other gateway catalogs describe their own routes or repeat local defaults. None can create Ollama
  inventory, make an unpublished service free, or override first-party plan, route, and settlement
  evidence.
