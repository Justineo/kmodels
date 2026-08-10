# Cerebras

## Source topology and refresh

- Production refresh uses only first-party Cerebras surfaces. The required current inventory is
  `GET https://api.cerebras.ai/public/v1/models`; it is unauthenticated, documented, exhaustive,
  and collected with its official `format=openrouter` and `format=huggingface` serializers plus the
  public-model contract. Reconcile each model and field across the three representations. An invalid
  serializer claim suppresses that claim or retains a compatible prior value as stale; it does not
  erase valid native inventory or sibling facts. Compatibility cache/image/request zeroes are
  documented placeholders and never become native price facts.
- The official Model Catalog is an independent exhaustive source for current model cards, exact
  callable IDs, Production/Preview maturity, endpoint labels, features, limits, and structured
  `ModelInfo` rates. Dynamic cards and a fixed set of commercial/API companions are fetched in one
  linked bundle. `llms.txt` is the discovery sentinel: a new commercial-looking documentation page
  produces a pending/unbound review signal until it is classified; it cannot silently disappear or
  suppress already recognized claims.
- The bundle includes Cerebras's raw OpenAPI 3.1 document, API-version policy,
  public pricing page, usage schemas, prompt caching, image inputs, reasoning, predicted outputs,
  service tiers, tools, Batch, console billing/cost reporting, projects, rate limits, metrics,
  dedicated inference, and AWS Marketplace billing. The raw OpenAPI is route/capability/usage
  evidence only; example model names cannot create inventory rows.
- Cerebras docs are Mintlify-style stable Markdown surfaces (`llms.txt`, canonical `.md` pages and
  raw `openapi.yaml`) with ordinary HTTP validators. The website price table is a Next.js page backed
  by embedded Sanity data. The public endpoint's three official serializers provide a first-party
  self-consistency check that does not depend on page layout or a community catalog.
- Deprecations and the change log add lifecycle and exact earliest-release evidence. Parameter
  deprecations do not create model rows. Replacement links resolve through exact catalog path/ID or
  change-log name/ID bindings; unresolved, conflicting, or dangling references suppress only the
  affected replacement relation and remain visible for review.
- Optional authenticated `/v1/models` is account-scoped inventory validation enabled by
  `CEREBRAS_API_KEY`. It cannot create or remove global rows and raw responses are not retained.
  Reviewed additive item fields are accepted with a bounded contract signal. Unknown fields, changed
  types, unknown values, ID-set divergence, and envelope drift remain account-scoped diagnostics;
  only dependent claims are withheld.
- Refresh is fully deterministic and requires no LLM. Do not replace any of these sources with
  models.dev, LiteLLM, Portkey, Helicone, OpenRouter, Hugging Face, or another downstream catalog.

## Identity, mapping, and source conflicts

- Callable IDs must be exact structured API IDs or exact `modelId` values bound to a model link in
  the Production/Preview catalog tables. `/models/choose-a-model` is a reviewed selection guide, not
  a model card. Any other newly discovered `/models/*` page remains pending until classified and
  cannot create inventory by itself.
- The catalog owns maturity when official surfaces disagree. In the current snapshot Gemma 4 31B is
  in the Preview table while the public native serializer says `preview: false`; the merged row stays
  Preview. API `created` values are not release dates.
- Current model-card prices come from structured `ModelInfo`. Every card's natural-language pricing
  sentence and every website price-table component is independently reconciled. The current Gemma
  prose says $2.15/$2.70 per million input/output tokens, while structured `ModelInfo`, all three
  public serializers, and the website table say $0.99/$1.49. The structured consensus wins and both
  prose components remain explicit unbound source-conflict evidence. Equal prose/page components are
  recorded as corroboration rather than disappearing from the reconciliation denominator.
- Current endpoint cards accept only reviewed Chat Completions and Completions labels bound to exact
  POST paths. The raw OpenAPI currently contains only `POST /v1/chat/completions` and validates bearer
  authentication, request/response schemas, structured output, tools, reasoning effort, service
  tiers, prompt-cache routing and usage detail. The separately documented legacy Completions route
  remains card evidence; it is not invented from the raw OpenAPI.
- Cache-read rates derive only from the official rule that cached input is billed at the standard
  input rate. There is no separate public cache-write meter. A single unconditional rate remains
  valid only while the service-tier guide says all preview tiers are billed equally.
- `reasoning_effort` is positive effort-control evidence only when the exact parameter appears on a
  model card. Account-tier rate limits and per-request image limits do not fit provider-neutral scalar
  limits and are not flattened into them.

## Cost boundary

- A completed shared-inference response is publicly calculable from exact model ID plus
  `usage.prompt_tokens` and `usage.completion_tokens`. Image tokens are included in prompt tokens.
  Cached input has the standard input rate. Hidden reasoning and rejected predicted-output tokens are
  included in completion accounting and must not be added again. The client executes tool calls, so
  no Cerebras tool-execution meter is added.
- Batch is Private Preview and currently documents only `/v1/chat/completions`. Only completed batch
  requests are charged, but no current public Batch rate is published; synchronous shared rates and
  example model names are not promoted to Batch pricing or support facts.
- The immediate result is shared-inference list cost, not the whole commercial topology or an
  account-effective invoice. Trial credits are allowances over that book; per-model monthly
  subscriptions, Cerebras Code subscriptions, Batch, and Dedicated are separate commercial
  mechanisms; AWS Marketplace is an alternate settlement channel. Console Cost can lag by 10
  minutes, active monthly-plan requests are excluded from usage billing, and Marketplace charges may
  lag 24–48 hours.
- Cerebras documents console Usage, Cached-Usage and Cost reports with CSV export, but no public
  Usage/Costs ledger API. The opt-in dedicated Metrics API reports aggregate counters for the last
  complete minute, not request cost. Gateways should route on public marginal-rate estimates and
  returned usage, then reconcile account-effective cost asynchronously.

## Commercial topology audit

Design status: audited; implementation pending. This section is the Cerebras disposition for the
provider-wide commercial-topology review. It describes the intended resources, books, offers,
relationships, meters, accounting bindings, and evidence boundaries; it does not claim that the
current collector, schema, generated data, or UI already represents them.

### Public commercial source graph

| Surface                                                                                                                                                                                                                             | Exact authority and completeness boundary                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`GET /public/v1/models`](https://inference-docs.cerebras.ai/api-reference/models/public-models), its native, Hugging Face, and OpenRouter serializers, and the [Model Catalog](https://inference-docs.cerebras.ai/models/overview) | Current direct public-model inventory, callable IDs, public limits, modalities, maturity, and structured Developer rates. The serializers are alternate first-party representations, not separate sellers or books. Catalog/card maturity wins over a serializer's compatibility flag.         |
| The current [Cerebras pricing page](https://www.cerebras.ai/pricing) and exact current model cards                                                                                                                                  | Public Free Trial, Developer, Enterprise, Cerebras Code, availability, and Developer token-price claims. Model-card prose is an independent observation, not authority over a conflicting structured rate.                                                                                     |
| [Chat Completions](https://inference-docs.cerebras.ai/api-reference/chat-completions), prompt caching, image input, reasoning, Predicted Outputs, tools, and service tiers                                                          | Request applicability, returned usage quantities, subset relationships, caller/provider execution boundaries, and current tier-price equality. These capability guides cannot create inventory or a priced add-on without an exact commercial claim.                                           |
| [Account & Billing](https://inference-docs.cerebras.ai/console/account-billing), [Usage & Monitoring](https://inference-docs.cerebras.ai/console/usage-monitoring), projects, and rate limits                                       | Credit, auto-recharge, per-model monthly-plan, quota, project, console-cost, and account-settlement facts. Values visible only after login are account scoped and cannot become global amounts.                                                                                                |
| [Batch](https://inference-docs.cerebras.ai/capabilities/batch), its API reference, and the Files API                                                                                                                                | Distinct asynchronous mechanism, preview enrollment, completion trigger, successful-result usage, retention, and resource prerequisites. “Only completed requests are charged” proves the billable outcome, not the amount or equality with synchronous pricing.                               |
| [Dedicated Inference](https://inference-docs.cerebras.ai/dedicated/overview), the Management API, Metrics, and dedicated capability pages                                                                                           | Reserved endpoint resource, account-scoped endpoint/model identities, supported deployment artifacts, custom-weight lifecycle, aggregate usage signals, and contract-only applicability. Published Hugging Face repository names are deployable artifacts, not globally callable Cerebras IDs. |
| [AWS Marketplace](https://inference-docs.cerebras.ai/integrations/aws-marketplace)                                                                                                                                                  | Alternate procurement and settlement for normal Cerebras API usage, required routing header, monthly AWS settlement, account consolidation, EDP boundary, and delay. Its model examples do not override the current public inventory.                                                          |
| Current Cerebras Code pricing and dated first-party Code launch/model posts                                                                                                                                                         | Current public subscription amount, daily allowance, and enrollment state; historical plan/model relationships and rate limits. A dated Code model binding is not a current global model binding when the live plan no longer names that exact model.                                          |
| Deprecations, the change log, API-version policy, and release posts                                                                                                                                                                 | Exact lifecycle or effective-time evidence when the callable ID and route are named. Historical model/rate announcements remain history and cannot restore retired inventory or supersede the current table.                                                                                   |

The first-party Hugging Face and OpenRouter integration guides describe routed requests using those
downstream services and credentials. They are useful route and mapping evidence, but the resulting
downstream commercial offers belong to that seller's price book. models.dev, LiteLLM, Portkey,
Helicone, and other comparator registries remain drift alarms only.

### Books, resources, and offer boundaries

- Shared direct inference is a Developer PAYG offer with model-qualified input and output rates per
  million tokens. Free Trial can call the same public models and consumes a USD credit allowance;
  it is not a zero-price model book. Developer's minimum self-serve purchase and auto-recharge are
  prepaid settlement mechanics, not additional unit rates.
- Free Trial currently grants USD 5 after a verified payment method, expires after 30 days, and
  applies across current public models. Preserve amount, acquisition requirement, expiry, and
  coverage as an allowance over the shared PAYG offer. Exhaustion or expiry stops access; it does
  not make the underlying rate invalid.
- The Cloud Console exposes per-model monthly inference subscriptions with multiple tiers and
  monthly rates. Requests covered by an active subscription are excluded from usage-based billing.
  This establishes separate subscription offers and exclusivity with PAYG settlement for an
  eligible request, but the exact tier amounts, allowances, enrollment, and model bindings are
  account scoped. Their public price state is `not_published`, not zero or custom quote.
- Cerebras Code Pro and Max are separately advertised subscription products at USD 50/month and USD
  200/month, with headline allowances of up to 24 million and 120 million tokens per day. The live
  page currently marks both sold out. Normalize the public plan amount, allowance wording, and
  `closed_to_new` state, but leave the current model, route, token direction, reset boundary, and
  relation to ordinary API PAYG unbound unless a current first-party contract supplies them. The
  marketing “daily value” is not a model rate.
- Historical Code announcements named Qwen3-Coder and later GLM variants. The current page now says
  only “top open source model,” while the current public catalog contains different IDs. Preserve
  dated historical bindings without creating a current Qwen/GLM catalog row, attaching Code to all
  public models, or copying old limits forward.
- Batch is a distinct asynchronous offer in Private Preview. It requires a batch-purpose input file,
  currently accepts Chat Completions jobs, and charges only completed requests. No public Batch
  amount or discount relation is published, so its price state is `not_published`. Successful result
  usage makes the outcome measurable but cannot manufacture the missing rate. Files are a Batch
  resource prerequisite with bounded retention, not an independently sold storage offer; absence of
  a file fee is not evidence of free storage.
- Dedicated Inference is a reserved, organization-exclusive endpoint/capacity offer with custom
  contract pricing. It enables account-specific endpoint IDs, broader deployable model families,
  custom weights, Batch, service tiers, Predicted Outputs, and Metrics. Those are resources and
  compatible mechanisms inside the Dedicated contract unless an independent amount is published;
  do not copy shared PAYG rates or mint public model rows from account endpoint IDs and supported
  weight repositories.
- The Enterprise pricing surface also advertises model fine-tuning and training services. Preserve a
  provider-service offer with `custom_quote` pricing. Weight upload/deployment in the Dedicated
  Management API proves serving of existing weights, not a globally available self-serve training
  API or a public training meter.
- AWS Marketplace is an alternate procurement and settlement channel for the same direct Cerebras
  inference mechanism. Requests use a normal Cerebras key plus the Marketplace header, the linked
  AWS account is billed monthly, and the documentation sends rate lookup back to Cerebras's pricing
  page. Preserve channel, biller, delay, cancellation, and account applicability without duplicating
  the model offer. Select one evidenced account settlement path; do not assume direct credits also
  apply to Marketplace-routed usage. EDP coverage is an external AWS account allowance, not a
  Cerebras discount.
- Prompt caching, image input, reasoning, Predicted Outputs, and service tiers modify execution or
  partition returned usage; none is a separately acquired public offer today. Cached input uses the
  standard input rate. Image tokens are inside prompt tokens. Reasoning and rejected prediction
  tokens are inside completion accounting. All service tiers are currently billed equally during
  preview. Preserve selectors and realized quantities so a future exact rate can bind without
  inventing a current surcharge or zero-rate term.
- Caller-defined tools are emitted by the model and executed by the client. Cerebras publishes no
  generic tool-call or tool-execution fee; each explicit follow-up inference request is token billed.
  Exa, Parallel, Browserbase, and similar cookbook integrations are external sellers. Their cost does
  not belong in the Cerebras book merely because Cerebras generated the invocation.
- Organization and project rate limits are entitlements and quota accounting. An API key belongs to
  one project, both project and organization ceilings can apply, and billing remains aggregated at
  the organization. Separate uncached-token and total-token buckets do not create separate price
  terms.

### Commercial relationships

| Source offer or resource        | Relation                                                   | Target and scope                                                      | Cost consequence                                                                                                                                                                   |
| ------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Free Trial credit               | allowance over                                             | Direct shared PAYG input/output terms for current public models       | Public list rates determine debit against the finite credit; credit reduces settlement, not usage quantity or unit price.                                                          |
| Account monthly inference plan  | `exclusive_with` for one covered request                   | PAYG settlement for the exact subscribed model/tier/account           | A covered request is excluded from usage-based billing. Exact allowance and overage behavior remain account scoped.                                                                |
| Cerebras Code Pro or Max        | allowance internal to plan; current model relation unbound | The plan's provider-selected coding route                             | Apply the monthly fee and stated daily ceiling only to the exact Code entitlement. Do not infer coverage of the direct public catalog.                                             |
| Batch                           | resource prerequisite                                      | Batch-purpose input File resource and eligible Chat Completions route | Only completed result items can incur the unpublished Batch charge; file upload alone has no proven independent fee.                                                               |
| Batch and synchronous inference | `exclusive_with` for one execution                         | Alternative delivery mechanisms for the same logical request          | One realized execution is priced by its selected mechanism. Independent retry or resubmission events remain separately accountable.                                                |
| Dedicated Inference             | enrollment/resource boundary                               | Enterprise enrollment and a provisioned organization endpoint         | Contract settlement replaces any assumption of Developer PAYG for traffic on that endpoint.                                                                                        |
| Dedicated custom weights        | contained resource/compatible mechanism                    | Exact account endpoint and uploaded weight version or alias           | Deployment changes the realized account model identity; no separate public amount is known.                                                                                        |
| Service tier                    | execution modifier                                         | Eligible shared or Dedicated inference route                          | The response's realized tier matters, but every current preview tier has the same published rate; `priority` is Dedicated-only.                                                    |
| Prompt cache hit                | quantity subset                                            | Direct input term                                                     | Cached tokens use the same input amount and must not be added to prompt tokens a second time.                                                                                      |
| Image input                     | quantity subset                                            | Direct input term for an exact image-capable model                    | `image_tokens` is included in prompt tokens; no separate image charge is published.                                                                                                |
| Predicted Outputs               | quantity partition                                         | Direct output term for an exact eligible route                        | Rejected prediction tokens are billed at output rates but already counted in completion usage; Dedicated contract customers are explicitly outside the public rejected-token rule. |
| Caller tool loop                | client-controlled composition                              | Each explicit inference follow-up plus external tool execution        | Cerebras charges model tokens only. An external seller may charge its own execution independently.                                                                                 |
| AWS Marketplace channel         | alternative settlement                                     | Same eligible direct-inference usage for the linked account           | Settle through the evidenced account path once; do not assume direct credits also apply or add the USD 0.01 reporting SKU as a surcharge.                                          |

### Meters, denominators, signals, and phase

| Commercial atom                | Public denominator                                               | Required signal or reconstruction                                                                                   | Phase                    |
| ------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Direct input                   | Million prompt tokens                                            | `usage.prompt_tokens`; `image_tokens` and cached tokens are subsets                                                 | Outcome                  |
| Direct output                  | Million completion tokens                                        | `usage.completion_tokens`; reasoning, accepted prediction, and rejected prediction quantities are detail subsets    | Outcome                  |
| Cached input                   | Same direct input meter and amount                               | `usage.prompt_tokens_details.cached_tokens` for performance/quota explanation, never additive cost                  | Outcome                  |
| Batch completed inference      | Public denominator not published; result contains ordinary usage | Successful JSONL result plus its usage and exact Batch enrollment                                                   | Outcome/account          |
| Per-model monthly subscription | Account/model/month and unpublished tier allowance               | Active subscription, exact model/tier, billing period, and console coverage evidence                                | Enrollment/account       |
| Cerebras Code Pro/Max          | Subscription month plus “up to” aggregate tokens/day             | Active plan, current plan route, provider's daily-usage counter, and reset rule; several are not publicly specified | Enrollment/account       |
| Free Trial credit              | USD credit amount                                                | Eligible shared PAYG list cost deducted from credit until expiry/exhaustion                                         | Account                  |
| Dedicated endpoint             | Contract capacity/period; public denominator not published       | Provisioned endpoint and account contract                                                                           | Enrollment/account       |
| Project/org request quotas     | Request count by minute/hour/day                                 | Provider quota counters at both project and organization scope                                                      | Request timeline/account |
| Project/org token quotas       | Uncached and total token counts by minute/hour/day               | Provider preflight estimate followed by actual-usage reconciliation                                                 | Request timeline/account |
| Console settled cost           | USD/account/model/input-output category                          | Cost report or CSV, delayed by up to 10 minutes and excluding active-subscription requests                          | Account                  |
| AWS settled cost               | AWS account currency amount                                      | Marketplace billing line item, commonly delayed 24–48 hours                                                         | Account                  |
| Dedicated Metrics              | Aggregate requests/tokens/cache/latency for last complete minute | Prometheus counters from the opted-in endpoint                                                                      | Account aggregate        |

The response's provider tokenizer quantities are authoritative for list-cost reconstruction. A
streaming response exposes whole-response usage only in its terminal usage-bearing chunk; an
interrupted stream can therefore remain partially costable or uncostable. The dedicated Metrics
surface and rate-limit buckets help capacity analysis but cannot be substituted for a request ledger
or an invoice.

### Requested, realized, allowance, enrollment, and settlement state

- Request state selects API key/project, submitted model or dedicated endpoint ID, delivery route,
  service tier, image content, cache key, prediction, and caller tools. It establishes eligibility
  and an estimate, not the completed token quantities, realized tier, cache hit, or account charge.
- Outcome state supplies the returned model, realized service tier, prompt/completion totals, cached
  and image subsets, reasoning and prediction subsets, Batch item status, and any completed
  follow-up requests. Only quantities dimensionally compatible with an exact rate enter immediate
  list cost.
- Allowance state contains trial credit and expiry, Code or account-subscription allowance, and any
  external AWS committed-spend coverage. These reduce or replace settlement only inside their exact
  scope; none changes the current public model rate.
- Enrollment state distinguishes Free Trial, Developer, private Batch access, active per-model
  subscription, closed-to-new Code plan, Enterprise/Dedicated endpoint, project membership, and AWS
  Marketplace linkage. Enrollment controls acquisition and callability independently of price
  validity and model lifecycle.
- Settlement state appears in the Cerebras Cost report, credit history, subscription invoice, custom
  contract, or AWS line item. Those account records own paid amount after allowance and contract
  effects; public marginal rates and returned usage remain the hot-path estimate.

### Commercial-atom disposition ledger

| Reviewed atom class                         | Design disposition                                                                                                                                                                        |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public Developer input/output rates         | Normalize exact model-qualified numeric USD terms from the structured public sources and current website.                                                                                 |
| Free Trial                                  | Normalize the USD 5/30-day credit as an allowance over PAYG, including payment-method requirement and exhaustion behavior; never create free model rows.                                  |
| Developer prepaid credits and auto-recharge | Preserve as settlement sources and account controls. Minimum top-up is not a subscription fee or unit-price condition.                                                                    |
| Account per-model subscriptions             | Preserve separate account-scoped subscription offers with `not_published` global amounts and exact PAYG exclusivity. Do not conflate them with Cerebras Code.                             |
| Cerebras Code Pro/Max                       | Normalize current monthly amounts, headline daily allowances, and sold-out enrollment. Keep current model/route/reset applicability unbound and historical model bindings dated.          |
| Batch and Files                             | Preserve Batch as Private Preview with `not_published` rate, completed-item trigger, result usage, and required File resource. Do not infer a discount, synchronous rate, or storage fee. |
| Dedicated Inference                         | Preserve a custom-quote capacity offer, exact account endpoint resources, deployment lifecycle, and contract boundary. Do not admit supported weight repositories as public model IDs.    |
| Fine-tuning/training service                | Preserve an Enterprise provider service with `custom_quote`; do not infer a self-serve API or numeric training meter.                                                                     |
| Prompt caching                              | Preserve cache quantity and quota effects. Charge cached input once at the standard input rate; emit no cache-write/storage offer.                                                        |
| Image input                                 | Preserve capability and image-token subset. Emit no image surcharge or synthetic zero term.                                                                                               |
| Reasoning and Predicted Outputs             | Preserve request controls and usage subsets. Charge completion once; retain Dedicated exception and exact feature applicability without a second rate.                                    |
| Service tiers                               | Preserve requested and realized tier plus current equal-rate claim. Emit no separate offer while preview tiers share the same amount.                                                     |
| Caller tools and external integrations      | Preserve capability and external execution boundary. Emit no Cerebras generic tool-call charge; downstream seller prices stay in their books.                                             |
| AWS Marketplace                             | Preserve alternate biller/procurement, routing header, lag, cancellation, and external allowance boundary without duplicating Cerebras rates.                                             |
| Projects, rate limits, and Metrics          | Preserve quota/enrollment and aggregate observability. Do not turn capacity counters into commercial meters or request-cost facts.                                                        |
| Compatibility serializer zeroes             | Retain as format evidence only. Never normalize request, image, cache-read, or cache-write zero-price terms from placeholders.                                                            |
| Missing, malformed, or conflicting claims   | Suppress only the affected claim and retain current models, sibling rates, commercial facts, raw evidence, and compatible prior claims with freshness state.                              |

### Authority, conflicts, and claim-local refresh

Authority is specific to each claim:

1. The native public-model endpoint and exact catalog bindings jointly own current callable IDs. The
   catalog owns Production/Preview maturity. The current Gemma row remains Preview even though the
   native serializer reports `preview: false`; that compatibility conflict cannot remove the model.
2. Structured `ModelInfo`, native/Hugging Face/OpenRouter public representations, and the current
   website table agree on Gemma at USD 0.99/M input and USD 1.49/M output. Its prose card instead
   says USD 2.15/M and USD 2.70/M. The independently corroborated structured/current-table values win,
   while both prose components remain visible conflicting observations rather than being discarded.
3. Native prices and capability guides own commercial meaning. OpenRouter-format zeroes for request,
   image, cache read, and cache write are compatibility placeholders. They cannot override the rule
   that cached and image input is already billed through prompt tokens or create new zero-price terms.
4. The current pricing page owns current Code plan amounts and sold-out state. Dated Code posts own
   their historical model mappings only. Neither historical Qwen3-Coder/GLM coverage nor ordinary
   API-key integration proves the live plan's current model set or coverage of every public route.
5. The console guide proves that per-model monthly plans exist and covered requests bypass usage
   billing. It publishes neither their exact global amounts nor a relation to Code Pro/Max. Keep the
   products separate until exact first-party account evidence binds them.
6. Batch's completed-request sentence establishes a charge trigger but no price denominator or
   amount. Keep `not_published`; do not copy Developer rates, assume a discount, or call it free.
7. Dedicated guides own supported deployment artifacts and account endpoint behavior. The current
   global public endpoint owns public callable IDs. A Hugging Face repository name, weight alias, or
   endpoint ID cannot cross that identity boundary.
8. AWS documentation owns biller/channel mechanics, while the current Cerebras pricing page owns the
   referenced public unit rates. Stale Marketplace model examples cannot recreate retired public
   inventory, and the USD 0.01 SKU is a conversion/reporting mechanism rather than an added fee.
9. Usage responses own immediate quantities; console and AWS records own account settlement. A
   delayed invoice amount can differ after subscription, credit, contract, tax, or external allowance
   without making the public list rate a conflict.

Refresh remains deterministic and non-LLM. Inventory representations, each model card and rate
component, current website plans, usage subsets, caching, image, reasoning, prediction, tiers, caller
tools, Batch/Files, Dedicated resources, console/account facts, Marketplace, Code, and lifecycle are
independent claim groups. Validate exhaustiveness only inside a source's proven scope. A new
commercial-looking page becomes pending/unbound; a missing page, malformed row, stale example,
unknown authenticated field, or unresolved replacement suppresses its dependent claim or retains a
compatible prior claim as stale. None may erase valid inventory, another price component, another
offer, or the provider snapshot. Every recognized atom receives a normalized, included,
externally billed, account-only, custom-quote, not-published, superseded, conflicting, ambiguous, or
pending disposition.

### Model-detail composition and cost coverage

Model details should show the applicable shared Developer input/output rates and maturity first,
then project exact commercial context without pretending that every fact is another model price.
Free Trial appears as a finite credit allowance; an account per-model subscription as an alternative
settlement plan; Batch as a Private Preview route with unpublished price; Dedicated as a custom
account endpoint; and AWS Marketplace as a settlement channel. Cerebras Code should appear only when
a current exact model relation is published. Its generic live plan must not be attached to every
public model.

The immediate calculator sums prompt and completion tokens once. Cached and image tokens explain
input composition; reasoning and prediction details explain output composition. They are not added
again. Batch cannot produce a numeric total without a public or account rate. Caller tools add only
explicit follow-up inference and externally billed execution. Coverage is deliberately partial:
show active subscription, trial credit, Code ambiguity, Dedicated contract, account adjustments, and
delayed settlement as unresolved or account-level facts instead of rejecting the offer or claiming an
exact invoice.

## Comparator audit

- models.dev and LiteLLM keep direct Cerebras entries manually rather than synchronizing the official
  public endpoint. Portkey and Helicone likewise publish community-maintained subsets; routed catalogs
  such as OpenRouter and Hugging Face describe their own downstream offers. These sources are useful
  drift alarms, but they neither establish Cerebras inventory nor override first-party facts.
