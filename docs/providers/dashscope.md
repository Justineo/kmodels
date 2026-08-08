# Alibaba Cloud Model Studio

Status: current

## Sources and identity

- Nine official model-inventory pages are independent non-exhaustive regional catalogs. Only their Recommended, All, and Legacy model sections define rows; specification tables and full-width section labels do not. IDs come only from labeled model fields, without a product-prefix allowlist.
- Union exact rows across sources while retaining every source reference.
- The lifecycle-and-updates tables are a non-creating release overlay. A model's earliest exact regional entry is its global `release_date`; later regional availability does not imply that the model itself was updated.
- The recommended page is a bounded, non-creating route overlay. A card adds facts only when all IDs agree and region, host, protocol, path, and complete request URL are reviewed.
- Unknown card data rejects the provider. Keep endpoint and region as separate positive facts; never create a host/region/endpoint Cartesian product.
- Optional Singapore deployment inventory is account/region scoped and one complete bounded page. It may add exact `mu`, `cu`, `ptu`, `ptu_v2`, or `lora` plans but cannot create/remove rows or retain private data. Enable it with `DASHSCOPE_API_KEY`.

## First-party commercial source graph

The pricing collector is an atomic first-party bundle. Its index is the [Model Studio price book](https://www.alibabacloud.com/help/en/model-studio/model-pricing); reviewed companion documents cover [context cache](https://www.alibabacloud.com/help/en/model-studio/context-cache), [batch inference](https://www.alibabacloud.com/help/en/model-studio/batch-inference/), [Chat Completions usage](https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions), [Responses usage](https://www.alibabacloud.com/help/en/model-studio/compatibility-with-openai-responses-api), [web search](https://www.alibabacloud.com/help/en/model-studio/web-search), [billing and cost management](https://www.alibabacloud.com/help/en/model-studio/bill-query-and-cost-management), [usage statistics](https://www.alibabacloud.com/help/en/model-studio/model-usage-statistics), [savings plans](https://www.alibabacloud.com/help/en/model-studio/savings-plan-and-resource-package), [billing plans](https://www.alibabacloud.com/help/en/model-studio/more-tools), [billing-plan endpoints](https://www.alibabacloud.com/help/en/model-studio/base-url), and the customer-billing [`DescribeInstanceBill` API](https://www.alibabacloud.com/help/en/user-center/developer-reference/api-bssopenapi-2017-12-14-describeinstancebill).

The bundle is required because the price table alone does not define all billable dimensions or account adjustments. Every companion is a reviewed exact URL, is collected without credentials, and has contract assertions for the commercial claims used by normalization. Missing documents, changed claims, unknown regions, unsupported price cells, or changed units fail the provider refresh. No third-party price book is a fallback.

## Public list-price normalization

- The public price book identifies itself as standard pricing; newer promotions may appear only in the console. Console-only promotions are account reconciliation data, not catalog rates.
- Parse labeled callable IDs and every price cell structurally. Each amount retains region, deployment scope, thinking mode, context range, modality, resolution, operation, promotion, eligibility, and native unit. A partially understood price row rejects the refresh even when another cell in the row is valid.
- Total input tokens in one request select the context tier, and that tier applies to all tokens in that request. A gateway therefore cannot select a tier from the input-token field alone without accounting for the full billable input.
- Batch input and output are 50% of successful real-time inference rates. Thinking tokens are output tokens. Batch and context-cache discounts cannot be combined, so cache rates are never derived from a batch or other service-tier fact.
- Explicit cache writes are 125% of standard input, explicit reads are 10%, and ordinary implicit reads are 20%. Explicit and implicit cache are mutually exclusive. `deepseek-v4-pro` is an official exception whose implicit-cache price is available only in the console; do not synthesize 20% for it.
- Web-search tool calls are USD 10 per 1,000 calls in the International deployment scope and USD 0.573411 per 1,000 calls in the Global and Chinese-mainland scopes. Bind these rates only to model IDs and dated snapshots explicitly covered by the official support lists. Search result content also contributes normal input tokens. The limited-time web-extractor promotion remains unbound until its model/strategy conditions can be represented without flattening them.
- Free trials and limited-time-free cells are numeric promotional zeroes only when their billing unit is published or can be inferred uniquely from the table's other price columns. Published discontinuations are retired and not applicable for pricing. TTS character input is `input_text`, its free generated audio is `output_audio`, and per-voice-clone charges are tool calls.
- Never flatten a subscription allowance, free quota, savings plan, coupon, or invoice discount into a model rate.

The live first-party validation on 2026-08-04 parsed 333 price-book models: 332 numeric and one retired, with 3,151 normalized price facts. Source reconciliation partitioned 3,265 reviewed commercial items into 3,242 normalized, one explicit non-numeric, seven account/billing exclusions, and 15 deliberately unbound items; it produced no ambiguous, unsupported, or unresolved items. The unbound set is visible rather than silently converted to `unknown` and includes missing regional cache bases, the `deepseek-v4-pro` exception, and the web-extractor promotion. The broader regional catalog currently has 23 non-retired IDs absent from the price book: four MiniMax/GLM partner models, two Paraformer realtime models, `qwen-long`, `qwen-tts`, ten Qwen 2.5 variants, three small Qwen 3 variants, and two Wan 2.1 image-to-video variants. Similar family names and third-party prices do not establish an Alibaba Cloud region/tier offer, so these remain unknown.

## Request usage and account cost

Immediate responses provide the quantities needed to correct a list-price estimate, not the exact charged amount:

- Chat Completions returns `prompt_tokens`, `completion_tokens`, `total_tokens`, and `prompt_tokens_details.cached_tokens`.
- Responses returns `input_tokens`, `output_tokens`, `total_tokens`, `input_tokens_details.cached_tokens`, and `output_tokens_details.reasoning_tokens`.
- Explicit cache usage can additionally expose `cache_creation_input_tokens`. Native and Responses web-search forms expose call counts under their respective `usage.plugins.search.count` and `usage.x_tools.web_search.count` structures.
- Image, video, audio, character, and request-metered products require their corresponding success quantity; token fields alone are not universal billing telemetry.

The response does not return exact monetary cost. The Model Studio billing console has minute-level aggregation and normally appears 2–10 minutes after a request; its exported dimensions include API Key ID and input/output type. The general Alibaba Cloud `DescribeInstanceBill` API is materially slower: data is updated with a 24-hour delay, unsettled pay-as-you-go usage is omitted, and the final monthly bill is available after noon on the third day of the next month. Its pretax, invoice-discount, coupon-deduction, and payment fields make it appropriate for account reconciliation, not request attribution.

Account-effective cost can differ from public list price because of free quota, console promotions, model resource plans, general savings plans with discounts up to 47%, Token Plan or Coding Plan subscriptions, coupons, and invoice discounts. Deduction order also matters. The target Base URL and API Key select a billing plan and region: they must belong to the same plan, regional keys are independent, and Token/Coding Plan endpoints use dedicated keys. Those plans are documented for interactive coding tools rather than gateway backend services.

## Gateway costing decision

An AI gateway must inspect the request and selected route to estimate public list cost. Required inputs can include credential/billing route, deployment scope and region, exact model snapshot, total input context tier, thinking mode, batch mode, modality, resolution, cache mode and actual hit/write quantities, time-bound promotion eligibility, output quantity, and tool-call count.

Use response usage for immediate post-request list-price correction and a local pricing snapshot for pre-request estimates. Use delayed billing exports/API data to reconcile account-effective cost and calibrate estimation error. Neither the 2–10-minute console aggregation nor the 24-hour billing API is timely or request-granular enough for cost-based hot-path load balancing. Pre-request load balancing can compare normalized public marginal prices, but it must label them as estimates and keep subscription commitments, remaining quota, negotiated discounts, and unsettled billing outside the real-time decision unless the gateway maintains that state itself.

## Third-party audit only

Third-party books are useful drift signals but are neither imported nor used to fill gaps:

- The 2026-08-03 models.dev snapshot had 51 International and 85 Chinese-mainland Alibaba entries. Against the next day's official book, both base input and output components matched an official value for only 30/51 and 34/85 entries respectively; 11 and 29 IDs were absent from the official current book, and many matched models had multiple official tiers or modes that the flat base pair could not express.
- The same snapshot represented all 22 Token Plan models as zero marginal token cost. Each 12-model Coding Plan catalog represented ten as zero and two with non-zero token rates. These values describe plan behavior, not the subscription purchase, commitment, remaining quota, or final account charge, so they cannot be substituted for public pay-as-you-go rates.
- The 2026-08-03 LiteLLM snapshot had 36 direct DashScope entries, 33 with top-level or tiered pricing and only one with cache pricing. For 28 entries, each supplied input/output component occurred somewhere in the current official book; this does not prove that the flattened pair is one valid regional tier. Four IDs were absent. ccusage consumes LiteLLM pricing and therefore does not provide an independent DashScope authority.

The audit explains apparent third-party “coverage”: it often comes from flattening one region/tier, retaining older IDs, or treating subscription marginal usage as zero. First-party extraction preserves the dimensions needed to tell those cases apart.

## Kong AI Gateway

- Kong supports chat generation, embeddings, and image operations only.
- Candidates require active lifecycle, acceptable maturity, and exact endpoint plus host/region evidence. Broad task evidence is insufficient.
- Audio, speech, transcription, translation, video, realtime, rerank, OCR, and classification remain outside its DashScope matrix.
- Historical or absent Kong examples never restore rows. Do not manufacture route tuples while the schema stores endpoint and region separately.
