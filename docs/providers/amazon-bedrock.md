# Amazon Bedrock

Status: current

## Sources and identity

- The exhaustive public bundle contains the official model-card index, every bounded publisher
  sub-index linked from it, reviewed same-host cards, Mantle service regions, four AWS Price List
  offers, the Bedrock and AgentCore pricing pages, and the exact AWS Marketplace product page for
  Cohere Embed 4. It also pins 16 official API, usage, cache, service-tier, logging, CUR, Price List, and
  billing-latency contracts that justify the catalog and gateway accounting rules below. Refresh
  requires the complete companion set and validates its reviewed semantic invariants; these facts
  are no longer documentation-only assumptions. Publisher sub-indexes are necessary because AWS can
  publish a card there before adding it to the top-level table; this was observed for GPT-5.6 Sol,
  Terra, and Luna. The structured `current/index.json` inventories remain the primary billing
  denominator; the public pricing page is the current exact overlay for reviewed model/rate tables
  that can lead the structured feeds.
- Callable base IDs and inference-profile aliases come only from Programmatic Access tables. Never derive an ID from a display name.
- Runtime and Mantle IDs remain distinct unless their exact ID is identical. When both publish one identical endpoint label/path, emit that public fact once while retaining endpoint-specific price and availability conditions.
- Preserve an explicit per-card API path. GPT-5.6 uses `openai/v1/responses`, which must not be
  collapsed into the otherwise common Mantle `v1/responses` route.
- Optional `ListFoundationModels` in `us-east-1` is regional authenticated validation. It may enrich
  exact public IDs but cannot create rows, define global availability, or retain raw data. Require
  the documented foundation-model ARN and its exact `modelId` suffix. The live first-party API can
  lead the reference page's enum list: reviewed live values such as `AUDIO`, `SPEECH`, `VIDEO`,
  `PREFERENCE_FINE_TUNING`, and `INFERENCE_PROFILE` are normalized alongside the documented base
  values. A new string enum is accepted with a contract signal and leaves only the affected fact
  unknown; it does not discard the model or the other recognized fields.
- Enable it with `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN` for temporary credentials. The identity needs `bedrock:ListFoundationModels` on `Resource: "*"`.

## Mapping

- Bind API, lifecycle, capability, and availability facts to the matching programmatic ID. Unknown modality/API/endpoint labels reject the provider; negative API rows add no positive evidence.
- Keep exact `{region, deployment_type}` pairs. Runtime geo/global evidence requires its exact inference-profile alias. Mantle remains in-region and must intersect with the service-region table. Never form cross-products.
- `Legacy` is callable-but-restricted, not deprecated. An exact EOL date becomes canonical `retired` when effective even if a stale model card still says `Legacy`; “No sooner than” is not an exact retirement date and never triggers that transition.
- `publicExtendedAccessTime` is an official API lifecycle timestamp for the higher-priced portion of
  a legacy period. Validate its shape but do not map it to canonical deprecation or retirement; a
  rate is publishable only when an official commercial source supplies the corresponding price.
- RAG is service-level. `Invoke` does not imply response streaming. Native Rerank additionally requires its model-specific sample.
- Price joins require one unique official identity or exact ID occurrence. If an inference product omits an identity attribute, match its usage-type tokens against the official card name only when that normalized family identifies one model; an explicit but different version/name never falls back to family matching. Repeated cards are equivalent only when their exact Programmatic Access IDs, endpoints, and deployment types agree.
- Preserve region, endpoint, routing class, tier, cache TTL, context threshold, media conditions, capacity direction, unit, and effective date. Preserve provider image subtypes such as standard and document images as operations when they select different rates.
- Keep `performanceConfig.latency=optimized` in canonical `speed=optimized`, independent of
  `service_tier`. Standard latency is completed only when an optimized alternative establishes that
  dimension. AWS can fall an optimized request back to standard latency and exposes the served
  configuration in the response, so gateways must price the resolved value. Recognize both
  `long-context` and Price List's `long-ctx` spelling as the `context_tokens >= 200001` tier.
- Execution topology removes the `batch` tier only after moving it into the dedicated Batch offer.
  On-demand tiers such as standard, priority, and flex remain applicability conditions inside the
  On-demand offer. They can carry unequal rates and must not be collapsed into an artificial
  same-scope conflict.
- The four AWS Price List sources use `current/index.json`, which AWS defines as the latest service
  price-list version. Treat their returned terms as the current snapshot and retain each term's
  `effectiveDate` as raw audit evidence, not as a historical-only applicability qualifier. Unequal
  same-scope Price List values remain an explicit conflicting claim; a narrower reviewed pricing
  page may resolve them under the authority rule below.
- Parse only reviewed model sections and exact region groups from the public pricing page. Page rows
  bind through current Programmatic Access identities and never create a model. They fill missing
  current structured rates and replace an unequal same-scope Price List value because AWS explicitly
  says the service pricing page is charged when it differs from an informational Price List file;
  that replacement receives its own reconciliation reason. Page-only identities remain visible as
  unbound reconciliation findings until a current model card supplies the callable ID.
- The reviewed Bedrock page overlay currently owns exact OpenAI Frontier token/cache tables,
  Stability AI Image Services per-generation tables, and Model Evaluation human-task/included-score
  claims. The AgentCore page supplies the page-only services and allowances listed below. OpenAI's
  two-row table header is interpreted structurally:
  the short group (`Short Context Window (272K)`) applies through 272,000 tokens and the long group
  (`Long Context Window (1M)`) applies from 272,001 through 1,000,000. Duplicate meter labels stay distinct
  through those exact applicability ranges. Stability service rates retain their three published
  US regions and geo deployment scope; no model-name or region defaults are inferred outside that
  table.
- The Cohere Embed 4 Marketplace product page is an exact product/ID companion. Its current usage
  term contains 46 dynamically parsed rate cards: in-region and global input-token prices for 23
  regions. Duplicate hydrated copies are accepted only when their complete card sets are identical;
  changed identity, vendor, unit, region pairing, card count, or unequal copies reject refresh.
  These product-specific cards carry the reviewed
  `bedrock_marketplace_product_page_over_price_list` fact policy. They may supersede only a weaker
  overlapping bulk-feed value whose entire scope they cover; the bulk value remains informational
  audit evidence.
- `AmazonBedrockFoundationModels` is the Marketplace billing representation and omits the callable endpoint. AWS documents identical per-token pricing across Runtime and Mantle, so endpoint is not a commercial condition for its on-demand per-token facts; bind them to each exact Programmatic Access ID and supported deployment type without duplicating endpoint variants. Service per-token facts without an explicit Mantle SKU use the exact Runtime ID but likewise omit endpoint as a price condition, allowing Marketplace base prices and service-only context tiers to resolve together. Preserve explicit Mantle, batch, reserved, provisioned, and TPM endpoint distinctions from their SKU.
- Compare overlapping AWS decimal prices numerically rather than by source formatting, so `3.0000000000` and a converted `0.003` per 1K tokens agree without weakening unequal-price conflict detection.
- AWS unit labels are interpreted only with exact billing evidence. This includes `Search Units`, `Input Images`, `Text Requests`, and an `Embeddings` unit whose dimension explicitly says `InputTokenCount`; generic `Units` still requires its SKU/description to identify tokens, searches, seconds, images, requests, or capacity.
- Classify embedding prices by the commercial input being metered: token rates are `input_text`, processed images are `input_image`, and explicit audio/video duration rates are `input_audio`/`input_video`. Use the generic `embedding` meter for request-priced embedding operations and retain their explicit input modality. Product/model wording alone is not a modality condition, and a modality encoded by a directional meter is not duplicated as applicability.
- Keep reviewed TPM-hour and model-capacity hours as provider-qualified atomic capacity units. The Marketplace field `1M TPM Hour` is treated as a 1K-TPM-hour unit only when its own dimension description explicitly says “per 1K … TPM”; this resolves the source-field disagreement without converting the price.
- Every price-list product, term, dimension, and reviewed pricing-page claim is interpreted
  independently. A malformed or unknown product, unit, target, table, row, or page section produces
  a bounded reconciliation finding while valid siblings continue to publish. Unknown commercial
  units remain raw; unequal same-scope values remain conflicting raw claims unless a reviewed
  authority rule resolves them. An identity inferred only from usage text remains unbound. An explicit
  Price List product absent from the current callable card catalog is recorded as
  `price_product_absent_from_current_catalog` and excluded: AWS's current feeds contain both
  billing-leading and retained stale products, and neither supplies a callable ID. A reviewed public
  page row absent the card catalog remains unbound because it is a narrower current signal.
- Bedrock's provider-wide applicability budget is 128 MiB, matching the provider partition budget.
  This leaves room for the complete price book while the independent partition, selector-work,
  variant, and observation limits remain enforced.
- A catalog model remains `unknown` when no current price product binds uniquely. Do not transfer prices from a similarly named generation, preview, or Stability utility operation.
- The current refresh deliberately leaves one callable row unresolved.
  `amazon.titan-embed-g1-text-02` has an exact model card but no exact current pricing-page or Price
  List identity; do not copy the price from Titan Embeddings G1 Text or Titan Text Embeddings V2.
  The official Bedrock pricing page now resolves `openai.gpt-5.5` and `openai.gpt-5.6-sol`, including
  the latter's short/long-context split. OpenAI's direct-platform rates remain a different commercial
  surface and cannot fill Bedrock gaps.
- Map inventory enums only through reviewed semantics. Unknown additions are review signals rather
  than row-level failures; recognized siblings remain usable, and regional streaming evidence
  remains scoped.
- Model-card dates are calendar-validated. A present but malformed launch, legacy, or exact EOL date
  rejects the provider candidate instead of disappearing as an unknown date.

## Commercial topology

Design status: implemented. The collector and provider adapter implement the following topology in
the shared pricing contract.

### Public commercial source graph

The model-card and Programmatic Access graph above remains the only public catalog identity source.
Commercial discovery starts independently from the current
[`AmazonBedrock`](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/current/index.json),
[`AmazonBedrockFoundationModels`](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrockFoundationModels/current/index.json),
[`AmazonBedrockService`](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrockService/current/index.json),
and
[`AmazonBedrockAgentCore`](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrockAgentCore/current/index.json)
Price List offers. All four feeds are collected. A billing product never creates or retains a catalog
model.

The reviewed commercial graph is:

- The current [Bedrock pricing page](https://aws.amazon.com/bedrock/pricing/) owns its model and
  provider-service price cards: Model Pricing, Custom Model Import, Knowledge Bases, Guardrails,
  Model Evaluation, Data Automation, Intelligent Prompt Routing, Prompt Optimization, Web Search,
  and Flows. Exact Marketplace product pages can own narrower product-specific terms. Price List
  feeds exhaustively discover current billing SKUs and supply exact dynamic values where the page
  delegates to a metered price.
- The [service-tier](https://docs.aws.amazon.com/bedrock/latest/userguide/service-tiers-inference.html),
  [latency-optimized](https://docs.aws.amazon.com/bedrock/latest/userguide/latency-optimized-inference.html),
  and [Batch](https://docs.aws.amazon.com/bedrock/latest/userguide/batch-inference.html) guides own
  their selectors, fallback behavior, capacity, compatibility, and execution mechanisms. Batch
  [results](https://docs.aws.amazon.com/bedrock/latest/userguide/batch-inference-results.html) own
  item and manifest usage semantics.
- Current Runtime, Mantle, Converse, model-native response, prompt-caching, invocation-logging,
  Guardrail, router-trace, and built-in-tool API contracts own realized usage and routing signals.
  [`CountTokens`](https://docs.aws.amazon.com/bedrock/latest/userguide/count-tokens.html) is an
  explicitly no-charge preflight whose estimate matches the charged input only when the eventual
  request is identical.
- The [AgentCore pricing page](https://aws.amazon.com/bedrock/agentcore/pricing/) owns Runtime,
  Browser, Code Interpreter, Web Search, Gateway, Identity, Memory, Evaluations, Optimization,
  Policy, Agent Registry, and Payments terms. AgentCore services remain in the Amazon Bedrock
  provider partition but never become pseudo-models.
- Cost Explorer, CUR, CUR 2.0, response usage, invocation logs, and service-specific telemetry own
  settlement or reconciliation at their documented grains. They do not replace current public rate
  publications.

Every normalized claim keeps its exact source, product, SKU when present, and effective evidence.
Third-party catalogs and calculators are excluded from this graph.

The implemented projection separates on-demand and Batch model offers, moves Reserved and
Provisioned commitments into exact model-capacity books with covered execution, and moves Nova Web
Grounding into its own service book. Recognized Bedrock and AgentCore Price List products become
provider-resource books with exact SKU, Region, selector, unit, and CUR `UsageType` evidence;
unknown units remain bounded raw terms. Page-only Identity, Optimization, Agent Registry, Payments,
CountTokens, and Model Evaluation claims use the same books without manufacturing SKUs. Registry
rates target exact monthly allowances, Identity's included offer requires Runtime or Gateway as
alternatives, and page-only numeric rates bind only to their documented outcome, job, or account
quantity. The evidence stored for bulk rows is compact and exact rather than a copy of the complete
Price List product.

### Resources, books, and offer boundaries

| Resource or book                        | Target offers                                                                                                                     | Boundary                                                                                                                                                                                                                                                                                               |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Exact callable model                    | Synchronous on-demand inference and asynchronous Batch inference                                                                  | Batch is a separate offer because it is a distinct S3 job mechanism. Standard, Priority, Flex, served latency, region/routing, context threshold, cache class, modality, image quality/size, and video duration are amount or applicability variants of the on-demand offer.                           |
| Reserved service-tier capacity          | Exact-model input- and output-TPM capacity with a one- or three-month commitment                                                  | The fixed capacity payment is not a per-request token rate. Requests served inside the reservation are covered; resolved overflow to Standard is ordinary usage-priced inference.                                                                                                                      |
| Provisioned Throughput                  | Exact-model model-unit-hour capacity with its published commitment                                                                | Inference through the provisioned-model ARN is covered by the capacity. Allocation or amortization to a request needs an operator policy and is not a public list-price fact.                                                                                                                          |
| Model customization                     | Technique- and model-qualified training, custom-model storage, custom on-demand inference, and custom Provisioned Throughput      | Fine-tuning, continued pretraining, preference optimization, distillation, and reinforcement fine-tuning keep their exact token, hour, or image denominator. Resulting custom models are account resources, not catalog rows. Base rates are reused only where AWS explicitly says they are identical. |
| Custom Model Import                     | Free import operation, active-copy runtime, and storage                                                                           | Import is free. Runtime is CMU-minute priced in five-minute active windows; storage is CMU-month priced. Architecture, model size, context, version, Region, and the CMU quantity determined at import remain exact conditions. Imported copies are account resources.                                 |
| `amazon-bedrock.guardrails`             | Policy- and API-qualified text/image safeguarding                                                                                 | Classic Guardrails and `InvokeGuardrailChecks` have different rates. Each configured policy and image/text unit is independently billable; model inference is separate when a guardrail is attached to a model call.                                                                                   |
| `amazon-bedrock.knowledge-bases`        | Managed storage/retrieval, agentic retrieval, structured-data retrieval, reranking, parsing, embedding, and generation components | Managed parser, embedding, and reranker can be included in a Managed Knowledge Base. Customer-selected embeddings, reranking, generation, vector stores, and external AWS services remain separate exact components.                                                                                   |
| Agents and Flows                        | Included Agent orchestration and usage-priced Flow node transitions                                                               | `InvokeAgent` has no separate orchestration charge, but every realized model, Knowledge Base, Guardrail, action, and external service still applies. Flows charge executed node transitions plus each downstream resource.                                                                             |
| Prompt routing and optimization         | Router requests, simple optimizer tokens, and advanced optimizer orchestration                                                    | A router fee composes with the exact model actually invoked. Simple optimization has its own token denominator. Advanced optimization is the realized target/optimizer/judge model usage described by the current formula, not a fixed invented fee.                                                   |
| Model Evaluation and Data Automation    | Human tasks, judge/generator usage, and modality-qualified document/audio/image/video processing                                  | Algorithmic or orchestration steps marked no-extra-charge are `included`, while every exact generator, judge, Knowledge Base, page, minute, image, and extra blueprint field remains separate.                                                                                                         |
| Core Web Search and Nova built-in tools | Generic Web Search queries, Nova Web Grounding requests, and Nova Code Interpreter with no published separate rate                | These are three different service identities. The two published search prices are never merged. Missing Code Interpreter price evidence is `not_published`, not `free`.                                                                                                                                |
| `amazon-bedrock.token-counting`         | Free model-compatible preflight                                                                                                   | Compatibility projects the service to a model; it does not require buying inference and its result is not final outcome usage.                                                                                                                                                                         |
| AgentCore                               | Feature-specific provider-service offers from the AgentCore book                                                                  | Runtime, tools, Gateway, Identity, Memory, Evaluation, Optimization, Policy, Registry, and Payments keep distinct meters and composition. AgentCore can host or call many models, but that does not make those models AgentCore catalog identities.                                                    |

AWS Marketplace model enrollment, EULA acceptance, first-use subscription, and a valid payment method
are access facts. They do not create another public-price offer unless an exact Marketplace product
publishes a distinct term. AWS bills Bedrock usage; private offers remain account settlement facts.
S3, ECR, EC2 data transfer, CloudWatch, Lambda, vector stores, and third-party wallet fees belong to
their owning service or provider books and are not copied into Bedrock.

### Relationship matrix

| Source                                     | Relationship      | Exact target or rule                                                                                                                                                                            |
| ------------------------------------------ | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Synchronous on-demand model inference      | `exclusive_with`  | Batch, Reserved-covered execution, and Provisioned-covered execution for the same realization.                                                                                                  |
| Reserved-covered inference                 | `requires`        | Exact matching model capacity. Resolved overflow instead realizes Standard on-demand inference.                                                                                                 |
| Provisioned-covered inference              | `requires`        | Exact provisioned-model capacity and route.                                                                                                                                                     |
| Customization training or imported runtime | resource graph    | `requires_resource` for the exact supported base model/technique or imported account artifact; storage and later inference are separate offers.                                                 |
| Guardrails                                 | `compatible_with` | Exact supported model route when attached; standalone `ApplyGuardrail`/check calls have no model requirement. A blocked input avoids inference, while a blocked output has already incurred it. |
| Managed Knowledge Base agentic retrieval   | `incurs`          | Agentic Retrieve plus its published underlying Retrieve calls; a customer-selected model, embedding, reranker, or external store adds that component only when used.                            |
| Retrieve-and-generate                      | `incurs`          | Exact retrieval component and every exact model inference actually performed.                                                                                                                   |
| Intelligent Prompt Routing                 | `incurs`          | One router request plus the exact model selected at outcome from the router's exactly two configured same-family models. A router ARN is not a model alias.                                     |
| Agents                                     | `incurs`          | Every actual model inference and optional Knowledge Base, Guardrail, action, or external service realized during orchestration.                                                                 |
| Flows                                      | `incurs`          | Executed node transitions and every priced model/service represented by those executed nodes.                                                                                                   |
| Human or LLM-judge evaluation              | `incurs`          | Generator inference when requested, completed human tasks or exact judge-model usage, and optional Knowledge Base retrieval. Precomputed external responses omit generator inference.           |
| AgentCore Web Search                       | `incurs`          | Submitted search queries and the documented Gateway `InvokeTool` calls. It is unrelated to core Bedrock Web Search and Nova Web Grounding.                                                      |
| AgentCore Identity included variant        | `requires`        | Exact AgentCore Runtime or Gateway usage. Direct successful OAuth/API-key retrieval remains separately priced.                                                                                  |
| AgentCore optimization/evaluation/policy   | `incurs`          | Every exact Runtime, Gateway, Evaluation, model, or Bedrock Guardrail component actually used.                                                                                                  |

Region, endpoint, Runtime versus Mantle, inference profile, service tier, served latency, context band,
cache TTL, modality, image dimensions/quality, and video duration qualify a model offer; they do not
create relationship edges. Reserved overflow, routing, Agents, Flows, and evaluations are outcome-time
composition and must support repeated exact model/service requirements rather than one static target.

### Meters, denominators, signals, and resolution phase

#### Models, capacity, and core Bedrock services

| Commercial atom               | Published denominator                                               | Charge or reconciliation signal                                                                                                             | Earliest reliable phase |
| ----------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| On-demand input/output        | Model-qualified tokens, images, requests, or media duration         | Converse/Mantle/model-native response usage plus resolved tier/latency; invocation logs where supported                                     | Outcome                 |
| Prompt-cache write/read       | Cache-write and cache-read input tokens, with exact TTL             | Response cache-write/read counters; cache-aware `inputTokens` excludes both                                                                 | Outcome                 |
| Batch inference               | Model-qualified input/output usage                                  | Successful result-item usage where emitted; aggregate manifest token counts are reconciliation evidence, not proof of failed-record billing | Result item / job       |
| Reserved capacity             | Exact-model input- and output-TPM commitment                        | Account reservation and `ResolvedServiceTier`; fixed cost allocation is account policy                                                      | Account / outcome       |
| Provisioned Throughput        | Model-unit-hours                                                    | Provisioned resource and billing usage; request allocation is account policy                                                                | Account                 |
| Customization training        | Trained tokens multiplied by epochs, training hours, or images seen | Training job metrics and billing records                                                                                                    | Job / account           |
| Custom/imported storage       | Model-months or CMU-months                                          | Active account resources and billing records                                                                                                | Account                 |
| Imported-model runtime        | CMU-minutes in five-minute active windows                           | Successful invocation activates the window; imported CMU count is an account-artifact fact                                                  | Outcome / account       |
| Guardrails                    | 1,000-character text units, images, and policy multiplicity         | Exact `GuardrailUsage` policy/image counters                                                                                                | Outcome                 |
| Managed Knowledge Bases       | GB-months, API calls, agentic calls plus underlying retrievals      | Resource storage and service request counters; selected model usage remains separate                                                        | Outcome / account       |
| Self-managed retrieval/rerank | Queries or Search Units, with documented chunk limits               | Service result/request and billing usage; embedding/generation usage remains separate                                                       | Outcome                 |
| Prompt router                 | Router requests plus selected-model usage                           | Router request and `PromptRouterTrace.invokedModelId`, then that model's response usage                                                     | Outcome                 |
| Flows                         | Node transitions                                                    | Executed flow trace or billing usage; downstream components bind independently                                                              | Outcome / account       |
| Model Evaluation              | Completed human tasks or actual generator/judge model usage         | Evaluation result/job plus every model response/billing record                                                                              | Job / account           |
| Data Automation               | Pages, images, audio/video minutes, and extra blueprint fields      | Job output counts and billing usage                                                                                                         | Job / account           |
| Simple Prompt Optimization    | Input plus optimized-output tokens                                  | No current exact token counter binds the request; reconcile from billing                                                                    | Account reconciliation  |
| Core Bedrock Web Search       | Search queries                                                      | Provider request/billing count; no reviewed response counter currently binds cost                                                           | Outcome / account       |
| Nova Web Grounding            | Tool requests plus Nova model usage                                 | Tool realization/citations identify use; exact charged request count needs billing reconciliation                                           | Outcome / account       |
| Token counting                | Estimated input tokens                                              | `CountTokens` response; explicitly no service charge                                                                                        | Preflight               |

Quota is not a billing signal. In particular, on-demand quota can burn down as input tokens plus
cache-write tokens plus weighted output tokens while cache reads are excluded. Public billing uses
the actual published token categories; never apply quota burndown weights as price multipliers.

#### AgentCore

| Commercial atom                    | Published denominator                                                                   | Charge or reconciliation signal                                       | Earliest reliable phase |
| ---------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------- |
| Runtime, Browser, Code Interpreter | Consumed vCPU-seconds and peak GB-seconds, one-second minimum and 128 MB memory minimum | Feature telemetry and AgentCore billing usage                         | Outcome / account       |
| Web Search                         | Submitted queries                                                                       | Search request count plus separate Gateway calls                      | Outcome                 |
| Gateway                            | API/Search calls, indexed tools-month, and VPC GB                                       | Exact operation counts, indexed inventory, network/billing usage      | Outcome / account       |
| Identity                           | Successful OAuth-token or API-key retrievals for non-AWS resources                      | Successful direct requests; covered when used through Runtime/Gateway | Outcome                 |
| Memory                             | New events, stored record-months, and retrieval calls                                   | Memory event/record/retrieval telemetry and billing usage             | Outcome / account       |
| Built-in evaluation                | Input/output tokens; Batch has its published discount                                   | Evaluation usage; the evaluator model is included                     | Job / account           |
| Custom evaluation                  | Evaluations plus separately billed model usage                                          | Completed evaluations and exact model usage                           | Job / account           |
| Policy                             | Authorization requests and natural-language authoring tokens                            | Policy API usage; Bedrock Guardrail safeguards remain separate        | Outcome / account       |
| Agent Registry                     | Net records and Search/List/Get calls after shared monthly allowances                   | Account-wide registry inventory and operation totals                  | Account                 |
| Payments                           | External wallet-provider operations or no-charge Bedrock APIs                           | Third-party settlement; no Bedrock numeric wallet rate                | Account                 |

### Requested, realized, capacity, allowance, and settlement facts

Publication facts select current model/service validity, Region, route, exact compatibility, promotion,
commitment option, preview state, and account-wide allowance definition. Request facts select callable
ID or ARN, Region, endpoint, inference profile, operation, service tier, latency configuration, cache
TTL, context/media conditions, tools, Guardrails, Knowledge Base, router, Flow, Agent, and AgentCore
feature. Outcome facts select the model actually invoked, resolved tier and latency, cache categories,
Batch item state, guardrail policies executed, router choice, node/tool/search counts, multi-step model
usage, runtime duration/resources, and blocking behavior. Account facts supply capacity holdings,
private Marketplace terms, free-tier or Registry allowance consumption, discounts, credits, tax,
currency, and invoice reconciliation.

The submitted selector never substitutes for a documented realization. Priority or Reserved requests
can resolve to Standard, optimized latency can fall back to Standard latency, a router can choose either
configured model, and an Agent or Flow can execute a variable graph. Fixed Reserved/Provisioned costs
cannot be assigned to one call without an explicit operator allocation policy.

### Commercial-atom disposition ledger

| First-party atom                                                                                                         | Target disposition                                                                   | Rationale                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Standard/Priority/Flex, served latency, cache, context, routing, Region, and media-qualified model usage                 | Normalize as exact offer variants                                                    | The mechanism, rate, applicability, and outcome selectors are first-party facts. Unknown siblings remain local findings.                  |
| Batch inference                                                                                                          | Separate model offer                                                                 | It is an asynchronous job mechanism with distinct prices and result semantics.                                                            |
| Reserved service tier and Provisioned Throughput                                                                         | Normalize capacity offers plus covered model execution                               | Capacity and commitments are exact; per-request amortization remains account policy. Overflow is ordinary Standard usage.                 |
| Customization training, storage, and explicitly priced inference                                                         | Normalize provider-service/capacity offers                                           | Exact public denominators exist. Resulting artifacts never become catalog rows.                                                           |
| Custom Model Import                                                                                                      | Normalize free import, CMU runtime, and CMU storage                                  | Public rates and five-minute activation semantics exist; required CMU quantity is an account-artifact fact.                               |
| Guardrails, Knowledge Bases, Flows, Evaluation, Data Automation, prompt routing, and simple optimization                 | Normalize provider services                                                          | Each has an exact first-party denominator. Missing response binding makes only request cost partial, not the rate invalid.                |
| Agents                                                                                                                   | Normalize as `included` orchestration with realized dependencies                     | `InvokeAgent` has no separate fee; its model and optional services remain billable.                                                       |
| Advanced Prompt Optimization                                                                                             | Normalize realized model usage; preserve orchestration formula as bounded raw        | Output quantities and participating iterations are outcome-dependent. Do not invent a fixed optimizer charge.                             |
| Core Web Search                                                                                                          | Normalize numeric provider service; keep operation compatibility/binding bounded     | The price is exact, but the current public contracts do not establish a complete model projection or response counter.                    |
| Nova Web Grounding                                                                                                       | Normalize as a distinct numeric provider service                                     | It is a Nova system tool with its own published per-request price and composes with Nova model usage.                                     |
| Nova Code Interpreter                                                                                                    | Preserve as `not_published` service candidate                                        | Provider execution is real, but price omission does not prove `free` or `included`.                                                       |
| CountTokens                                                                                                              | Normalize as `free` provider service                                                 | AWS explicitly states there is no charge; the result is preflight estimation.                                                             |
| AgentCore feature terms                                                                                                  | Normalize as independently owned provider-service books                              | Exact meters and composition exist; they are not model prices or catalog identity.                                                        |
| AgentCore Optimization Insights during preview                                                                           | Normalize as preview-qualified `free`                                                | The current page explicitly says it is free during preview; later pricing is not inferred.                                                |
| Agent Registry preview rates and monthly allowances                                                                      | Normalize current rates plus three exact monthly quantity allowances                 | Preview is a maturity label: the current page says consumption pricing is active above its record, Search, and List/Get free tiers.       |
| AgentCore Payments wallet operations                                                                                     | Preserve as `externally_billed`; normalize explicitly no-charge operations as `free` | Coinbase operations and Privy `ProcessPayment` settle externally; Privy `CreateInstrument` and the remaining APIs have no Bedrock charge. |
| Managed parser/embedding/reranker, algorithmic evaluation, evaluator model, and feature harnesses marked no-extra-charge | Normalize as `included`, with exact covering offer                                   | These benefits require the paid parent workflow; numeric zero would erase that dependency.                                                |
| Marketplace enrollment/EULA and client function calls                                                                    | Access/non-price fact                                                                | They do not create an independently priced Bedrock service.                                                                               |
| S3, ECR, EC2, CloudWatch, Lambda, vector-store, and third-party fees                                                     | Explicit external boundary                                                           | The owning AWS service or provider controls the rate.                                                                                     |
| Private offers, EDP/private discounts, credits, taxes, currency conversion, refunds, and invoices                        | Account settlement only                                                              | They cannot be derived from the public price book.                                                                                        |

### Authority and conflicts

Authority is claim-specific:

1. The current Bedrock or AgentCore pricing page controls an overlapping public amount when it
   differs from informational Price List data. A narrower exact Marketplace product page controls
   its own product term. Price List feeds remain exhaustive SKU discovery and own dynamic values not
   replaced by a current page.
2. Service guides own mechanisms, compatibility, capacity, fallback, and preview semantics. API
   references own request, response, trace, and usage-field meanings. Model cards and Programmatic
   Access tables remain the only catalog identity authority.
3. CUR/Cost Explorer own delayed account settlement. Response usage and logs own request detail at
   their documented scope; neither may invent a missing commercial rate.
4. If equally authoritative exact facts conflict without a reviewed containment or currentness rule,
   withhold only that claim and surface both observations. Do not reject a model, provider service,
   sibling rate, or provider partition.

The current CUR documentation contains a claim-local contradiction: its broad introduction describes
request-level line-item detail, while the explicit CUR/CUR 2.0 granularity and cost-management
contracts say usage is grouped by usage type, operation, pricing, and resource over an hour or day and
contains no `requestId`. The explicit schema/granularity boundary controls. Request logs retain detail;
CUR supports only aggregate reconciliation.

Refresh discovers every product in all four Price List feeds and every reviewed pricing-page section.
A new product, feature, attribute, unit, or meter is retained as bounded evidence and surfaced for
review while recognized siblings continue to publish. Commercial matching uses an exact callable ID,
ARN/product/SKU, or one uniquely documented alias; never a family guess, fuzzy name, LLM, or comparator.
An unrecognized service identity stays raw and unprojected. An unrecognized model price loses only
that term. Only an unsafe identity join or an internally inconsistent graph blocks the affected
publishable claim.

Source absence retires a fact only when the source is exhaustive for that exact claim. A temporary or
demonstrably partial page/feed failure may retain the prior fact with visible staleness. Crash-atomic
provider publication remains independent of claim-local parsing and reconciliation.

### Model-detail composition and cost coverage

Model details project only exact model-qualified Bedrock services. The UI derives supplemental
services from exact compatibility and `requires` closure; it never infers them from a broad
capability, shared tool label, or Marketplace subscription. Provider-wide services, capacity,
custom/imported account artifacts, and AgentCore features remain discoverable without masquerading as
model rows.

A calculator adds every independently charged component once: realized model usage, provider tools,
Guardrails, retrieval, router, Agent/Flow outcomes, evaluation, automation, and AgentCore usage.
`included`, `free`, `externally_billed`, and `not_published` remain distinct non-numeric states.
Coverage is `complete` only when every realized priced component has both an exact rate and quantity;
otherwise it is `partial` with the missing rate, binding, account allowance, capacity allocation, or
settlement fact identified. CUR or an invoice can reconcile account cost but cannot retroactively make
an unidentifiable request exact.

## Current public estimate and billed cost

- A gateway can produce a near-real-time public-list estimate from request and response facts. Keep
  the exact callable model or inference-profile ID, caller Region, endpoint, deployment scope,
  operation/batch mode, requested and resolved service tier, requested and served latency
  configuration, cache TTL, and all modality-specific usage. Do not choose a rate from the display
  name alone.
- `Converse` and `ConverseStream` return input, output, cache-read, and cache-write token counts;
  cache-aware `inputTokens` excludes cache reads and writes. They also return the served service
  tier. Latency-optimized inference returns the served latency configuration. `CountTokens` is a
  model-specific, no-charge preflight for input tokens, not a final billed-cost response.
- `InvokeModel` usage fields remain model-native rather than one uniform response schema. For
  `bedrock-runtime`, optional model invocation logging supplies per-request model ID, operation,
  Region, identity, and input/output token counts; logging is disabled by default and does not cover
  `bedrock-mantle`. Do not claim cache counters from the current invocation-log schema. Mantle APIs
  instead expose their OpenAI- or Anthropic-compatible response usage, while Mantle CloudWatch token
  metrics are aggregate observations.
- The public pricing page and Price List APIs establish public commercial rates, not an account's
  net invoice. Private Marketplace offers, enterprise/private discounts, credits, free-tier
  eligibility, tax, refund timing, and the allocation or amortization of Reserved/Provisioned
  commitments require the account's AWS billing data or an operator policy. Reserved overflow must
  be priced from the resolved tier; a fixed reservation cannot be truthfully allocated to one call
  without a chosen cost-allocation rule.
- Cost Explorer is not a request-path signal: current-month data appears in about 24 hours and is
  refreshed at least daily, with some upstream data later. CUR aggregates Bedrock by usage type over
  an hour or day and carries no per-request ID. Use response/log usage plus the public book for hot
  path estimation and cost-aware routing; reconcile later against CUR/Cost Explorer. Never use a
  billing API as the load-balancer's per-request cost oracle.

## First-party conflicts

- AWS's per-request metadata page contains a stale consideration that says to join invocation logs
  to CUR on `requestId`. The same page's reconciliation section and the dedicated CUR guide state
  that neither classic CUR nor CUR 2.0 contains a per-request identifier. Follow the latter explicit
  schema boundary: join only at model, usage-type, and time grain, with logs retaining request detail.
- AWS Price List documentation calls its Query/Bulk data informational and says the service pricing
  page controls when they differ. The normalizer therefore records a reviewed page-over-Price-List
  replacement instead of silently accepting both values or rejecting fresh data.
- The Cohere Embed 4 product page publishes USD 0.12 per million input tokens consistently across
  its 46 regional/global cards. Three bulk-feed `Embeddings` dimensions instead decode to USD
  0.0000000200 per input token for narrower Runtime regions. The exact product page wins through the
  same fact-local containment rule; the three unequal bulk values are retained as
  `superseded_value`, so this upstream disagreement no longer makes the model commercially
  incomplete and is still auditable.

## External comparison

- ccusage is not a Bedrock billing catalog or Bedrock invocation-log reader. Its calculated costs use
  an embedded/refreshed LiteLLM snapshot and optional user overrides, so it adds no independent AWS
  evidence.
- LiteLLM flattens much of AWS's region, endpoint, routing, context, and capacity surface. models.dev
  has no Bedrock implementation in its hourly sync registry, so its TOML rows are reviewed repository
  data rather than an automatic official crawl. Neither represents Bedrock provider services,
  AgentCore, cross-offer requirements, capacity coverage, or realized multi-step charging. Neither
  can fill an unbound first-party identity or replace applicability-qualified AWS prices.
- HashiCorp's official AWS Terraform provider now exposes an
  `aws_bedrock_foundation_models` data source that directly calls regional `ListFoundationModels`.
  It is a useful independent check on the API inventory and its current enums, but its flattened
  schema omits lifecycle and all pricing, cards, aliases, deployment pairs, and billing conditions.
- AWS Labs' official AWS Pricing MCP server calls the Price List Query/Bulk APIs (`get_products`,
  `list_price_lists`, and price-list file URLs) and is useful for interactive drift investigation.
  It uses the same informational billing denominator already collected here, does not join products
  to model-card callable IDs, and its natural-language MCP workflow is not needed for unattended
  refresh. The underlying AWS APIs remain fully automatable without an LLM.
- These sources remain read-only drift checks. No third-party identity, price, alias, date, or
  fallback enters collection.
