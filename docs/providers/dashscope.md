# Alibaba Cloud Model Studio

Status: current

## Official source topology and identity

Production uses only Alibaba Cloud first-party material. The public source graph consists of the official [recommended-model page](https://www.alibabacloud.com/help/en/model-studio/models.md), nine task catalogs, the [price book](https://www.alibabacloud.com/help/en/model-studio/model-pricing), the maintained [international](https://www.alibabacloud.com/help/en/model-studio/model-depreciation) and [China lifecycle pages](https://help.aliyun.com/zh/model-studio/model-depreciation), and the fixed [international](https://www.alibabacloud.com/help/en/model-studio/model-release-notes) and [China model-update pages](https://help.aliyun.com/zh/model-studio/newly-released-models). The task catalogs and recommendation page use their first-party Markdown representations; pricing, lifecycle, and release/update facts use the canonical rendered pages and their structured tables. The product-scoped [LLM document index](https://www.alibabacloud.com/help/en/model-studio/llms.txt) is useful for discovering official pages, but its prose summaries can lag the linked documents, so it supplies no model or price facts. The authenticated regional [`GET /api/v1/models`](https://www.alibabacloud.com/help/en/model-studio/list-models.md) inventory is a richer optional cross-check for exact identity, capabilities, context, release time, and price observations. It is account-, credential-, and region-scoped, and a custom API key may restrict model access, so its absence cannot remove a global public row and its response must not be retained as a raw account snapshot.

The nine task pages remain independent, non-exhaustive regional catalogs. Only exact IDs in labeled model columns under Recommended, All, or Legacy sections create rows. Specification tables, full-width labels, prose family names, and similar identifiers never create a model. Exact rows are unioned across sources and retain every source reference; distinct published IDs such as a regional suffix or publisher-qualified ID are not collapsed by family similarity.

Alibaba's Markdown preserves headings and table cells but omits some HTML section wrappers, row spans, and column spans. The adapter deterministically rebuilds nested heading context, recognizes only reviewed modality subheaders, expands price columns, and reconstructs sparse rows from typed anchors such as token range, resolution, mode, scope, price, and quota. The HTML lifecycle and release tables use the same bounded table representation, including row-span inheritance and bilingual exact headers. Systemic table/header drift and impossible sparse-row reconstruction still reject the source. An unrecognized model cell, price cell, unit, or explicit non-numeric disposition suppresses only that row or rate and emits reconciliation evidence; valid sibling rows and meters survive. Cardinality bounds remain the final systemic guard. This recovers the provider's maintained tables without an LLM and without guessing from neighboring model families.

The recommended page is a bounded non-creating overlay. Each Markdown card must publish one consistent ID, an exact region list, and one or more reviewed Base or Request URLs. Direct DashScope hosts and Alibaba workspace hosts are mapped independently to their published regions, including the `us-east-1` workspace route for US (Virginia); protocol and path must match the reviewed OpenAI, Anthropic, DashScope, embeddings, rerank, image, video, ASR, or realtime route. The set of route-derived regions must equal the card's region list, preventing a host/region Cartesian product.

The canonical international and China lifecycle pages publish maintained model tables with exact model ID, retirement date, and replacement. The collector unions those tables and follows row spans only inside the table that owns them. Announcement links remain human-facing provenance already present on the summary pages; refresh never fetches announcement details, bulletin APIs, or images and never uses OCR or prose inference. Lifecycle pages are non-exhaustive: when an unchanged extractor no longer sees a previously verified lifecycle row, the collector retains its last verified source-owned facts and emits a source coverage warning. A new extractor version recomputes the source instead of carrying an obsolete interpretation forward.

The international release-notes page and China model-update page form one fixed, bounded update bundle. Exact table rows provide release dates for matching catalog identities; they remain a non-creating overlay because historical release presence does not prove current callable availability. Duplicate regional observations select the earliest exact date.

The optional documented deployment inventory is `GET https://dashscope-intl.aliyuncs.com/api/v1/deployments/models` with `model_source=base`, `version=v1.0`, and bounded `page_no`/`page_size`. The transport now follows up to five 100-row pages, requires a stable declared total, exact requested page numbers, full intermediate pages, unique strict model objects and reviewed plan enums, then emits one normalized complete inventory. It is Singapore/account scoped, cannot create or remove public rows, and is skipped when `DASHSCOPE_API_KEY` is absent.

Alibaba also publishes the [Model Studio CLI](https://github.com/modelstudioai/cli). Its `bl model list` command exposes useful family, capability, context, price, and rate-limit fields through an interactive console-OAuth flow and an undocumented internal model-center gateway. That makes it an audit lead, not a stable unattended production contract. The CLI's deploy-model command separately confirms use of the documented deployment API above.

## First-party commercial source graph

The price collector uses the canonical rendered price book as the only required public price source. Six exact first-party companions cover [context cache](https://www.alibabacloud.com/help/en/model-studio/context-cache.md), [batch inference](https://www.alibabacloud.com/help/en/model-studio/batch-inference.md), [Chat Completions usage](https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions.md), [Responses usage](https://www.alibabacloud.com/help/en/model-studio/compatibility-with-openai-responses-api.md), [web search](https://www.alibabacloud.com/help/en/model-studio/web-search.md), and [billing and cost management](https://www.alibabacloud.com/help/en/model-studio/bill-query-and-cost-management.md). Inside a complete bundle, changed individual claims suppress only their cache derivation, automatic charge binding, service offer, or settlement claim. If a companion is unavailable, the complete previously accepted DashScope pricing partition is retained; price-book rows are never combined with a partial fresh commercial bundle. Usage statistics, savings plans, billing-plan routes, and `DescribeInstanceBill` remain reviewed audit authorities below, but the runtime does not fetch them until their richer plan, allowance, or account-settlement atoms are normalized. No third-party price book is a fallback.

The public price book is standard pay-as-you-go pricing. Every amount retains exact ID, physical region, deployment scope, thinking mode, total-input context tier, modality, resolution, operation, promotion, account eligibility, and native unit. When same-level Markdown headings lose the enclosing physical-region section, the row's reviewed deployment scope recovers the corresponding region (`International` to Singapore, `Chinese mainland` to China (Beijing), and the exact EU, Japan, or US scopes to their published regions); `Global` does not imply a physical region. Availability is the union of every exact region observed across a model's rates, not the first rate only. Input and output image prices are separate meters; sparse resolution rows retain shared input price while binding the changed output price to the new resolution. Invitational-preview labels are metadata, not part of the ID.

The Omni task catalog itself establishes text generation and transcription for its exact rows; a WebSocket or realtime API additionally establishes Speech to Speech and realtime delivery. Preserve the published Type value when present, otherwise preserve the row's HTTP/WebSocket API label as `raw_type`. Omni task and delivery evidence therefore do not depend on whether the separate ASR or recommended-model page happens to repeat the same ID.

Total input tokens in one request select a tier and that tier applies to every token in the request. Batch input and output are 50% of successful real-time inference rates; thinking tokens are output tokens. Batch and context-cache discounts cannot be combined. Explicit-cache writes are 125% of standard input and ordinary reads are 10%; ordinary implicit reads are 20%. Explicit and implicit modes are mutually exclusive. Exception identities and the affected percentage are extracted from the current cache guide rather than hardcoded: an exact “not 10%” or “not 20%” claim suppresses only that derived read rate while preserving the model, cache capability, write rate, and sibling region rates.

The currently normalized web-search document publishes USD 10 per 1,000 calls for Singapore and USD 0.573411 per 1,000 calls for China (Beijing). Rates bind only to exact IDs and dated snapshots in the two current support sections. Search content also contributes ordinary input tokens. The limited-time web-extractor promotion remains unbound because its complete strategy conditions are not a model rate. Free trials and limited-time-free cells are promotional numeric zeroes only when the billing unit is published or uniquely inherited from the reviewed table; published discontinuations are retired and not applicable. Subscription allowance, free quota, savings plan, coupon, and invoice discount are never flattened into model rates.

## Commercial topology audit

Design status: implemented for public PAYG model inference, Batch, cache, built-in
web search, charge reconstruction, and direct settlement. The broader plan,
allowance, training, deployment-capacity, marketplace, and account-settlement atoms
below remain the audited boundary for later normalization; they are not flattened
into the implemented model book in the meantime.

### Public commercial source graph

| Surface                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Exact authority and completeness boundary                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The [model price book](https://www.alibabacloud.com/help/en/model-studio/model-pricing), task catalogs, recommended-model page, lifecycle tables, and model-update tables                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Public PAYG presence, exact model/snapshot identity, physical region, deployment scope, thinking mode, total-input tier, modality, resolution, operation, promotion, eligibility, native unit, release, and lifecycle. Recommendation, lifecycle, and update omission is not exhaustive and cannot remove a task-catalog row.                                         |
| Authenticated regional [`GET /api/v1/models`](https://www.alibabacloud.com/help/en/model-studio/list-models.md) and [API-key controls](https://www.alibabacloud.com/help/en/model-studio/get-api-key.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Exact account-visible model metadata and price observations. The response is region/account scoped, custom keys can restrict model access, and price objects do not publish currency or complete promotion applicability; presence may enrich an exact public match, but absence cannot retire it and an unqualified API amount cannot replace the public price book. |
| [Context cache](https://www.alibabacloud.com/help/en/model-studio/context-cache.md), [batch inference](https://www.alibabacloud.com/help/en/model-studio/batch-inference.md), Chat Completions, Responses, and model-specific usage guides                                                                                                                                                                                                                                                                                                                                                                                                                                      | Cache and batch formulas, mutual exclusions, eligible models, response quantities, and outcome semantics. A general multiplier applies only while its exact eligibility and base meter remain current.                                                                                                                                                                |
| [Web search](https://www.alibabacloud.com/help/en/model-studio/web-search.md), [web extractor](https://www.alibabacloud.com/help/en/model-studio/web-extractor.md), [Code Interpreter](https://www.alibabacloud.com/help/en/model-studio/qwen-code-interpreter.md), [text-to-image search](https://www.alibabacloud.com/help/en/model-studio/web-search-image.md), [image search](https://www.alibabacloud.com/help/en/model-studio/image-search.md), [file search](https://www.alibabacloud.com/help/en/model-studio/file-search.md), and [MCP](https://www.alibabacloud.com/help/en/model-studio/mcp.md)                                                                      | Exact tool compatibility, execution signal, additive token behavior, provider-service call rate, current promotion, required resource, and external-billing boundary. Tool declaration or generic function-calling support alone never establishes a charge.                                                                                                          |
| [Training and deployment billing](https://www.alibabacloud.com/help/en/model-studio/model-training-and-deployment-billing.md), [deployment concepts](https://www.alibabacloud.com/help/en/model-studio/model-deployment-introduction.md), [deployable-model inventory](https://www.alibabacloud.com/help/en/model-studio/list-deployable-models-api.md), and deployment lifecycle APIs                                                                                                                                                                                                                                                                                          | Training formulas, Model Unit and PTU capacity, LoRA deployment, region/SKU/snapshot applicability, charged lifecycle, overflow, and account resource identity. A deployable base model does not create a running offer; a custom model or endpoint remains account scoped.                                                                                           |
| [Token Plan Personal](https://www.alibabacloud.com/help/en/model-studio/token-plan-personal-overview.md), both current Team pages ([USD](https://www.alibabacloud.com/help/en/model-studio/token-plan-overview.md) and [CNY](https://www.alibabacloud.com/help/en/model-studio/token-plan-team-overview.md)), [Coding Plan](https://www.alibabacloud.com/help/en/model-studio/coding-plan.md), [plan routes](https://www.alibabacloud.com/help/en/model-studio/base-url.md), [new-user quota](https://www.alibabacloud.com/help/en/model-studio/new-free-quota.md), and [savings plans](https://www.alibabacloud.com/help/en/model-studio/savings-plan-and-resource-package.md) | Subscription amounts, plan-specific model/tool allowlists, opaque Credits, call quotas, validity windows, eligible routes, deduction priority, commitment discounts, and enrollment. These account mechanisms do not rewrite PAYG model rates.                                                                                                                        |
| [RAG knowledge base](https://www.alibabacloud.com/help/en/model-studio/rag-knowledge-base.md), agent-application guides, [billing and cost management](https://www.alibabacloud.com/help/en/model-studio/bill-query-and-cost-management.md), and [`DescribeInstanceBill`](https://www.alibabacloud.com/help/en/user-center/developer-reference/api-bssopenapi-2017-12-14-describeinstancebill.md)                                                                                                                                                                                                                                                                               | Knowledge resources and composition, immediate usage, delayed account settlement, discounts, coupons, and payment. Billing evidence owns settled account cost but is too delayed and aggregated to create an unqualified request-time rate.                                                                                                                           |

Comparator catalogs remain audit-only. models.dev, LiteLLM, Portkey, gateway
registries, and marketplaces may identify a first-party page to review, but they do
not establish Alibaba product presence, rate applicability, or account settlement.

### Books, resources, and offer boundaries

- Realtime PAYG inference is one public usage book. Each offer binds an exact model
  ID or alias, physical region, deployment scope, thinking mode, total-input tier,
  modality, resolution or operation, promotion/eligibility, and native meter. Total
  input selects one tier for the whole request; thinking tokens count as output.
  Token, image, video, audio, character, second, and successful-operation meters must
  not be flattened into a generic input/output pair.
- A published alias may inherit a snapshot's amount only when the document gives an
  exact current target and the validity condition remains true. Family resemblance,
  a recommendation card, or an account API match without denomination is
  insufficient. Day/night and percentage discounts are effective promotion variants
  over the preserved base rate, not conflicts or arbitrary calculator toggles.
- Batch is a separate asynchronous usage offer rather than a realtime variant. It
  charges successful work at 50% of eligible realtime input/output rates. Parse,
  task, and line errors are free; completed work before cancellation remains billed.
  Batch is exclusive with realtime cache treatment and has its own plan eligibility.
- Explicit and implicit caching are distinct realtime mechanisms. Explicit writes
  are 125% and hits 10% of the eligible input rate; ordinary implicit creation is
  standard input and hits are 20%. Explicit and implicit cache are mutually
  exclusive. Minimum size, TTL, marker, model, and mode requirements remain
  applicability. Any exact model-specific “not 10%” or “not 20%” claim stays
  unbound because its amount is console-only. PTU cache and long-input factors
  belong to the PTU book and must not reuse PAYG cache derivation.
- Web search, text-to-image search, and image search are provider-service usage
  offers with exact regional per-call rates. They require an eligible inference
  request and add ordinary model tokens for inserted or processed content. Billing
  follows executed tool counts/outcomes, never the tool declaration.
- Web extractor and Code Interpreter are separate tool offers under current
  limited-time-free promotions. Preserve the exact zero effective state and its
  incomplete validity separately from any future base amount. Web extractor can
  compose with web search while search remains charged; Code Interpreter may trigger
  multiple model inferences and is request-exclusive with ordinary function calling.
- File search is currently a zero-rate tool-call offer that requires an exact
  knowledge-base resource; retrieved content still adds model input tokens. MCP has
  no generic Model Studio invocation rate: model usage remains Alibaba-billed while a
  third-party MCP server owns any external charge. Ordinary caller-defined function
  execution likewise creates no generic provider fee.
- A knowledge base is an account resource, not a model rate. Public material
  describes ordinary build/retrieval/management as free while separately referring
  to Enterprise specification/runtime fees and optional ADB-PG storage. Preserve the
  exact free file-search call and the resource, but keep capacity/specification cost
  unbound until edition, SKU, and rate exact-join. Never attach it to every retrieval.
- Training is a family of model-bound account jobs with exact token-, step-, pixel-,
  duration-, and epoch-dependent formulas. Successful processed work before user
  cancellation is billable; system-error interruption is not. A resulting custom
  model or checkpoint is an account resource related to its base model, never a new
  global catalog row.
- PTU is provisioned token capacity with separate input/output TPM rates, PAYG-hourly
  or subscription-daily settlement, charged lifecycle, model/snapshot/region, and
  long-input/cache factors. Capacity continues to accrue while overflow requests
  automatically fall back to public PAYG; only overflow work adds PAYG usage. A
  `service_tier` result, `provisioned_tokens`, and overflow header establish the
  realized route and already-adjusted usage.
- Model Unit is independent replica capacity with exact region, model, specification,
  replica/template, and optional prefill/decode topology. It bills by unit time with
  mechanism-specific minimums. Token-usage LoRA deployment is another deployed
  custom-model offer. The deployment API also names `cu`; preserve that plan/resource
  capability with `not_published` amount until a public commercial binding exists.
- Token Plan Personal, Team, and Coding Plan are subscription books over dedicated
  credentials and base URLs. They can coexist at account level, but a request uses
  one exclusive settlement route. Personal/Team consume opaque Credits in rolling
  windows and exact allowlists; Coding consumes actual model-call counts in three
  quota windows. They are interactive-use products, not backend automation rates,
  and a subscription's marginal quota use is not a zero PAYG model price.
- New-user quota is a time-limited account allowance for exact Singapore realtime
  offers. Savings plans are prepaid or committed account mechanisms with exact
  eligibility and deduction order. Neither creates another public model rate. The AI
  general-purpose plan may cover eligible model calls, cache, Batch, and named
  model-native tools, but excludes training/deployment and the web-search plugin;
  other model plans have narrower terms.
- Agent applications compose model, tool, memory, and knowledge resources. They do
  not create a global application rate when their underlying atoms already own the
  cost. Marketplace payment and third-party APIs remain external settlement routes.

### Commercial relationships

| Source offer or resource                  | Relation                      | Target and scope                                                         | Cost consequence                                                                                                                                    |
| ----------------------------------------- | ----------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Executed paid tool                        | `requires` and additive       | Exact eligible realtime inference offer                                  | Add the tool's realized call count and any resulting model tokens. A declaration contributes no cost.                                               |
| Responses web extractor                   | `requires`                    | Web search plus web extractor on an eligible model                       | Extractor is currently promotional zero; search calls and model tokens remain independently chargeable.                                             |
| File search                               | `requires`                    | Exact account knowledge-base resource and eligible inference offer       | Tool calls are currently zero-rate, retrieved content adds model input, and any resource capacity remains separate.                                 |
| External MCP                              | `requires`, externally billed | Eligible inference request plus selected MCP server                      | Alibaba model usage remains chargeable; the external seller owns any server charge.                                                                 |
| Code Interpreter                          | `exclusive_with` per request  | Ordinary caller function calling                                         | Do not construct a request that bills or realizes both paths; multiple internal model inferences remain additive.                                   |
| Batch                                     | `exclusive_with`              | Realtime execution, explicit cache, and implicit cache for the same work | Select the async batch offer or a realtime/cache path, never stack their discounts.                                                                 |
| Explicit cache                            | `exclusive_with`              | Implicit cache for the same request                                      | Only one cache mechanism can create/read cached input.                                                                                              |
| Token Plan route                          | `exclusive_with` per request  | PAYG, other Token Plans, and Coding route                                | The exact base URL and credential select one settlement book; account-level subscriptions may coexist.                                              |
| Plan pack                                 | `requires`                    | Owning Team plan and its seat quota order                                | Consume seat quota first and then the earliest-expiring shared pack; no PAYG overflow is implied.                                                   |
| Free quota and savings plans              | ordered allowance/discount    | Exact eligible PAYG atoms                                                | Apply the documented deduction priority to account settlement without modifying the public base offer.                                              |
| PTU capacity                              | conditionally additive        | Public PAYG inference only for an overflow request                       | Capacity keeps accruing; add PAYG solely for usage marked as overflow and do not double-apply PTU token factors.                                    |
| PTU, Model Unit, LoRA, or `cu` deployment | `exclusive_with` by resource  | Alternative deployment mechanism for one account endpoint                | One endpoint's selected plan owns capacity settlement; unrelated resources may accrue independently.                                                |
| Training job                              | resource graph                | Exact base model; account custom model/checkpoint                        | `requires_resource` for the base template and `produces_resource` for the private output; charge processed training work without catalog admission. |

### Meters, denominators, and observable signals

| Commercial atom      | Public denominator                                                      | Required signal or reconstruction                                                                                  | Phase                     |
| -------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| Text input/output    | million tokens in one selected total-input tier                         | Exact model/snapshot, region/scope, thinking mode, total input, prompt/completion and reasoning quantities         | Request/outcome           |
| Multimodal inference | published token, image, second, character, or successful-operation unit | Exact modality, resolution/operation, success, and provider-returned usage                                         | Outcome                   |
| Explicit cache       | cache-write or cache-read input token                                   | Cache mode plus `cache_creation_input_tokens` or `cached_tokens`; enforce minimum, TTL, and eligibility            | Outcome                   |
| Implicit cache       | cache-read input token                                                  | Exact eligible model/mode and returned cached tokens                                                               | Outcome                   |
| Batch                | successful batch input/output unit                                      | Completed result usage; exclude parse/task/line failures and include completed work before cancellation            | Job outcome               |
| Web search           | executed search call                                                    | Exact region/interface/model and `usage.x_tools.web_search.count` or completed search output item                  | Outcome                   |
| Web extractor        | executed extraction call                                                | `usage.x_tools.web_extractor.count` or completed extractor output item                                             | Outcome                   |
| Code Interpreter     | executed interpreter call plus all model usage                          | `usage.x_tools.code_interpreter.count` and aggregate response token usage                                          | Outcome                   |
| Text/image search    | executed provider tool call                                             | `web_search_image.count`/`image_search.count` or the corresponding completed output item                           | Outcome                   |
| File search          | executed retrieval call plus inserted tokens                            | `usage.x_tools.file_search.count`, completed output item, and exact knowledge-base ID                              | Outcome/resource          |
| Training             | processed tokens, steps, pixels, duration, and epochs as model-specific | Training configuration plus provider-system `usage`; user cancellation bills processed work                        | Job outcome/account       |
| PTU capacity         | provisioned input/output TPM-hour or subscription day                   | Exact model/snapshot/region, purchased TPM, charged deployment interval, tier factors, and subscription dates      | Resource timeline/account |
| PTU overflow         | ordinary PAYG usage                                                     | `x-dashscope-ptu-overflow: true`, realized `service_tier`, and returned usage                                      | Outcome                   |
| Model Unit capacity  | deployed MU-minute or subscription day                                  | Exact template/SKU/replica topology and charged deployment interval                                                | Resource timeline/account |
| Personal/Team quota  | provider-defined Credit                                                 | Plan, seat/account, rolling five-hour and seven-day windows, exact model/tool coefficients from account evidence   | Account                   |
| Coding quota         | actual model call                                                       | Plan and rolling five-hour, weekly, and subscription-month counters                                                | Account                   |
| Subscription/pack    | seat/account month or exact Credit pack                                 | Enrollment, renewal term, seat ownership, pack quantity, and expiry order                                          | Account                   |
| Free quota/savings   | exact model unit or committed currency amount                           | Account activation, validity, eligible atom, remaining allowance/commitment, and deduction order                   | Account                   |
| Settled cost         | provider billing line or account amount                                 | API key, billable item, minute/hour bucket, pretax amount, discounts, coupons, and payment after publication delay | Account                   |

### Requested, realized, allowance, enrollment, and settlement state

- Request-time state selects credential/base URL, PAYG or plan route, physical
  region, deployment scope, exact snapshot, thinking and batch mode, total-input
  tier, modality, resolution/operation, cache mechanism, requested tools, endpoint,
  and any account resource. These selectors support only a public estimate.
- Outcome state supplies successful output quantities, prompt/completion/reasoning and
  cache usage, realized tool counts, Batch results, PTU service tier and overflow,
  training work, and capacity lifecycle. Requested tools, output count, or purchased
  capacity cannot substitute for these realized signals.
- Allowance state includes new-user quota, Personal/Team Credits, Coding counters,
  shared packs, savings-plan commitment, promotion eligibility, and exact reset or
  expiry windows. These mechanisms can lower account settlement without changing the
  public base rate.
- Enrollment state includes plan purchase, seat, allowed model/tool set, dedicated
  route, deployment plan, API-key restrictions, limited product slots, and account
  region. It controls applicability but does not prove global presence or price.
- Settlement state arrives through the billing console and BSS API after product-
  specific aggregation and delay. Pretax, invoice discount, coupon deduction,
  payment, taxes, and unsettled usage own account-exact cost; response usage owns
  request quantity, not final money.

### Commercial-atom disposition ledger

| Reviewed atom class                       | Design disposition                                                                                                                                                               |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PAYG model rows and promotions            | Normalize exact multidimensional base and effective promotion offers. Preserve day/night or percentage applicability; do not collapse tiers, modalities, operations, or aliases. |
| Authenticated model API metadata/prices   | Exact-enrich public matches only. Preserve account scope; absence cannot delete, and prices lacking denomination/applicability remain unbound cross-checks.                      |
| Batch and cache                           | Normalize distinct offers/components only through exact eligible base-meter joins. Preserve mutual exclusions, success semantics, exceptions, and PTU separation.                |
| Paid provider tools                       | Normalize exact regional per-call offers with model/interface allowlists and realized-count meters; relate them additively to inference.                                         |
| Promotional/free tools                    | Preserve exact zero effective state, incomplete promotion validity, additive model tokens, and required resources. Never infer permanent zero.                                   |
| Functions and MCP                         | Emit no generic Alibaba function-call or MCP fee. Preserve caller execution and external seller settlement boundaries.                                                           |
| Knowledge base and applications           | Preserve account resource/composition. Keep free file-search calls exact and resource/specification fees unbound until an exact edition/SKU/rate relation exists.                |
| Training                                  | Normalize model-bound job formulas and cancellation rules. Preserve outputs as account resources related to base models, not catalog rows.                                       |
| PTU, Model Unit, LoRA, and `cu`           | Normalize exact published capacity/deployment offers and lifecycle. Keep `cu` amount `not_published`; model/resource binding remains account scoped.                             |
| Personal, Team, and Coding plans          | Normalize distinct subscription books, exclusive routes, allowlists, quotas, packs, and enrollment. Opaque Credits remain their native unit, never converted to PAYG tokens.     |
| Free quota and savings plans              | Normalize account allowance/commitment terms, eligibility, and deduction order separately from public rates.                                                                     |
| Billing evidence                          | Preserve delayed account settlement and adjustments for reconciliation; never reverse-engineer an unqualified public rate from an aggregate line.                                |
| Missing, malformed, or conflicting claims | Suppress only a malformed fact inside a complete bundle; an incomplete bundle retains the accepted provider pricing partition with visible staleness.                            |

### Authority and conflicts

Authority is specific to each commercial claim:

1. The model price book owns public PAYG dimensions and current promotions. A
   dedicated model/task guide may own a more specific eligibility or meter, but an
   account API amount without currency and full applicability cannot supersede it.
2. A dedicated tool guide owns its exact rate, compatible model/snapshot/interface,
   realized usage signal, and current promotion. A savings-plan eligibility mention
   such as “model-native tool calling” does not establish a generic tool-call rate.
3. Training/deployment pricing and lifecycle guides own their job/capacity formulas,
   billable states, overflow, and cancellation rules. Deployable inventory owns
   capability only; account deployment owns the base/custom model relation.
4. Exact plan pages own route, amount, quota, and allowlist claims. The current Team
   USD page publishes `$30/$100/$200` tiers and a `$700` Credit pack, while the Team
   CNY page publishes `CNY 198/698/1398` base tiers with `CNY 150/550` promotions and
   a `CNY 5,000` pack. Both are current first-party claims for the same Singapore
   product, but settlement-market/channel applicability is not stated. Keep both as
   a visible claim-local conflict until that dimension exact-joins; do not select by
   update date, convert currency, or mix one page's quota with the other's amount.
5. The knowledge-base page describes ordinary management/retrieval as free while the
   savings-plan guide refers to separately billed Knowledge Base specification fees.
   Preserve the free tool call and an unbound resource-fee atom; neither claim erases
   the other and no fee is attached without an exact edition/SKU relation.
6. The web-search page describes a separately billed Web Search MCP marketplace
   service, while the currently linked MCP integration resolves to an external
   Firecrawl product without the same Alibaba rate. Preserve the product-identity
   drift as bounded raw conflict; never attach it to Responses web search or generic
   MCP execution.
7. Dynamic aliases, console-only promotions, Token Credit coefficients, and account
   deployment IDs normalize only through exact current evidence. An older example or
   family-level similarity cannot fill the gap.
8. Delayed settled billing owns the account result. Promotions, allowances,
   negotiated terms, coupons, and taxes may change settlement without making the
   public rate wrong.

Refresh is deterministic and non-LLM. Public price sections, task and lifecycle
tables, authenticated regional inventories, each tool guide, cache, Batch, training,
each deployment mechanism, each plan, quota/savings terms, and billing evidence are
independent claim groups. Validate an exhaustive envelope only within the scope that
the source itself owns. Fact-level drift in a successfully parsed bundle suppresses
only the affected group. An unavailable public commercial companion retains the
provider pricing partition; it must not erase the model, another region, sibling
meter, unrelated tool, or capacity offer. A
non-exhaustive omission never becomes a negative claim. Every recognized atom gets a
normalized, derived, promotional, included, externally billed, account-only,
conflicting, unsupported, ambiguous, or pending disposition instead of rejecting the
whole row.

### Model-detail composition and cost coverage

Model details should project exact public PAYG, Batch, cache, and compatible
provider-tool offers for the admitted model, with region, scope, snapshot, mode,
tier, modality/operation, promotion, and native meter visible. Plan allowlists may
show eligible settlement alternatives, but opaque Credits, account quota, or an
active subscription do not replace the PAYG amount. Training eligibility and
deployable base-model capability may be shown as relationships; account custom
models, endpoints, knowledge bases, and capacity prices remain detached until an
exact resource binds them to the model.

Rate details preserve the mutually exclusive realtime, cache, Batch, promotion, and
settlement paths, and show paid-tool meters independently from inserted model-token
usage. They never combine base and promotion, explicit and implicit cache, Batch and
realtime, two plans, external MCP fees, or unrelated shared capacity. Partial cost
coverage is expected: show an unbound console price, opaque Credit coefficient,
capacity resource, external seller charge, promotion validity, or delayed account settlement instead of rejecting
the offer or inventing a complete total.

## Request usage, account cost, and gateway decision

Immediate responses expose quantities for post-request list-price correction, not exact charged money. Chat Completions provides prompt, completion, total, and cached-token details; Responses provides input, output, total, cached-input, and reasoning-output details; explicit cache can also expose cache-creation tokens. Image, video, audio, character, and request-metered products require their corresponding success quantity rather than token fields alone.

The billing console aggregates at minute level and normally appears 2–10 minutes after a request, with dimensions including API Key ID and input/output type. `DescribeInstanceBill` is slower: roughly 24-hour data delay, omission of unsettled pay-as-you-go usage, and final monthly availability after noon on the third day of the next month. Pretax, invoice-discount, coupon-deduction, and payment fields make it suitable for account reconciliation, not request attribution.

An AI gateway therefore needs the selected credential/billing route, region and deployment scope, exact snapshot, total input tier, thinking and batch mode, modality, resolution, cache mode plus hit/write quantities, promotion eligibility, output quantity, and tool-call count. Pre-request routing can compare normalized public marginal prices only as estimates. Subscription commitments, remaining quota, negotiated discounts, coupons, and unsettled billing require separate account state and must not be inferred from a zero marginal third-party entry.

## Comparator audit only

Third-party catalogs are drift signals, never production inputs:

- [models.dev](https://github.com/anomalyco/models.dev) keeps Alibaba rows in hand-maintained TOML rather than a provider sync. Its flat input/output pairs cannot retain every region, tier, mode, or subscription condition.
- LiteLLM refreshes a central repository JSON on startup with retries, a bundled fallback, minimum-count checks, and maximum-shrink protection; it does not run a DashScope-specific first-party collector.
- [Portkey](https://github.com/Portkey-AI/models) primarily describes runtime parameters and limits, not an independent Alibaba price book.
- [Helicone](https://github.com/Helicone/helicone) routes Qwen records through third-party providers rather than establishing direct Alibaba pricing authority.

These comparisons explain apparent extra coverage: flattening one tier, retaining historical IDs, routing through another provider, or treating subscription marginal consumption as zero does not replace Alibaba's current region/tier price contract.
