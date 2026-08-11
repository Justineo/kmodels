# Databricks

Status: current

## Reviewed official surface

- The public AWS regional catalog is one atomic bundle: the supported-model details page plus 27
  fixed official companions. The bundle covers task/route support, regional availability,
  lifecycle, limits, model pricing, delegated Google image pricing, releases, response and system
  usage, account list prices, `cards.json`, and the reviewed AI pricing-page data. A refresh is
  deterministic and uses no LLM.
- Callable identity comes only from the labeled `Endpoint name:` in a model section. Repeated IDs,
  missing labeled inputs, an unknown ID in the task/region/Priority tables, or a task matrix that
  does not exactly cover the detailed catalog rejects the provider.
- General purpose and Embeddings task rows must agree across responsive copies and retain the exact
  `POST /serving-endpoints/{name}/invocations` route. Image-output rows may also remain text
  generation when Databricks lists them as General purpose.
- The public catalog is exhaustive only for the reviewed AWS regional page. The optional documented
  `GET /api/2.0/serving-endpoints` source is workspace-scoped inventory: it may observe tasks and
  modalities, but cannot add/remove public catalog rows or retain raw workspace data. Enable it with
  `DATABRICKS_HOST` and `DATABRICKS_TOKEN`.
- Databricks' authenticated `GET /api/2.0/serving-endpoints:foundation-models` endpoint can expose a
  richer workspace inventory, and models.dev currently consumes it, but it is not in Databricks'
  public REST API reference. Kmodels does not make that undocumented route a refresh dependency.

## Model mapping

- Lifecycle is 47 active and 3 deprecated: `databricks-claude-sonnet-4`,
  `databricks-gemini-2-5-flash`, and `databricks-gemini-2-5-pro`. A lifecycle row affects this
  pay-per-token catalog only when it publishes an explicit `Pay-per-token:` date; a
  provisioned-throughput-only retirement must not retire the callable pay-per-token endpoint.
  Redirect intervals keep an old ID deprecated through the redirect end, after which it becomes
  retired.
- Release-feed links can supply exact dates. Missing dates remain unknown; article metadata and
  unmatched release links are not model release dates.
- Databricks says OpenAI, Gemini, and Anthropic limits match the respective
  model providers; that delegation statement is validated, but values are not copied through a
  fuzzy cross-provider name join. The remaining limits stay unknown until an exact reviewed
  official identity binding is available.
- Display-name joins for lifecycle, release, limit, and price rows resolve per alternative and must
  be unique. Zero matches may be an out-of-catalog row; multiple matches are a contract error, never
  an exclusion.

## Public pricing

- Keep the Databricks price books in DBU. Preserve input, output, cache-read, cache-write, embedding,
  batch, capacity, endpoint geography, context tier, promotion, and effective-date conditions. Do
  not invent a universal DBU-to-USD conversion.
- The only denomination exception is a Databricks model section that explicitly says Google
  pass-through pricing, links an exact section of Google's official Gemini price book, and limits
  the endpoint to global pay-per-token. Only Standard paid input-text, input-image, output-text, and
  output-image token rates from those two anchored sections are normalized in USD. Google's free,
  Batch, Flex, Priority, grounding, and caching terms are not imported.
- Pricing rows bind only to unique normalized catalog labels. Rows outside the reviewed regional
  catalog are explicitly excluded and cannot create identity. Blank, `n/a`, and `Coming soon` mean
  no numeric rate is published. An unsupported amount loses only that amount; a malformed price
  table loses only that page; unequal same-scope observations are retained for canonical conflict
  resolution. Valid models, sibling prices, and independent service pages continue to publish.
- Promotion percentages, validity dates, launch targets, and referenced Standard-rate families are
  parsed from the footnotes. Calendar-invalid dates reject the source. Every matched starred row
  must be explained by a parsed note; no model IDs or promotion dates are hard-coded.
- Standard pay-per-token uses `service_tier=standard`. Priority support comes from the exact
  endpoint-ID table. Qwen 3.5's published Priority row is the sole exact numeric Priority price and
  retains its `ap-south-1` plus account-enablement conditions. Fifteen other supported rows carry an
  `unknown_amount` Priority fact because Databricks publishes only that Priority costs more.
  Priority capacity can fall back to Standard and is then billed at Standard rates, so a requested
  or echoed Priority tier does not prove the billed tier.
- Pricing coverage is diagnostic, not an admission or provider-rejection threshold. A newly listed
  callable model can remain with unknown pricing, while pricing cannot create a model row.

## Commercial topology

Implementation status: current. Model pay-per-token, `ai_query` Batch, and provisioned capacity are
separate offers. The structured pricing application publishes provider-service books, exact
allowances and promotions where available, bounded estimates, and an account settlement template.
Databricks is the first migrated provider where a public model rate can be expressed in DBU while
account list cost requires a second, time- and account-qualified USD-per-DBU fact. The topology
preserves both quantities instead of flattening them into a universal conversion.

### Public commercial source graph

- The supported-model, model-detail, lifecycle, region, Foundation Model API, Priority, Batch, and
  provisioned-throughput guides own callable IDs, route mechanisms, exact support, fallback, and
  capacity semantics. The public open-model and proprietary-model pricing pages own model-qualified
  DBU rates and their context, cache, geography, promotion, and capacity conditions.
- Databricks' pricing application is an official embedded structured source. The collector fetches
  each reviewed `page-data.json` together with `cards.json` and encodes the reviewed renderer's
  per-page meaning. Page data owns card identity, labels, descriptions, disclaimers, visibility,
  and ordering; card data owns plan/cloud/region values. A field key or pipe-delimited value does not
  establish a unit by itself.
- The reviewed pricing navigation covers Unity AI Gateway, Agent Bricks, AI Functions, CPU/GPU Model
  Serving, open and proprietary Foundation Model Serving, AI Search, Agent Evaluation, Foundation
  Model Training, AI Runtime, and Genie. These are one first-party commercial source family, but
  remain distinct provider-service books and never create model rows.
- Foundation Model REST responses, `ai_query` query profiles, the legacy
  `system.serving.endpoint_usage` tables, the current `system.ai_gateway.usage` table, and
  service-specific response contracts own request and outcome signals. `system.billing.usage` owns
  billable account quantities and correction semantics. `system.billing.list_prices` owns the
  account's historical public SKU list price, including effective promotional price intervals.
- System-provided `system.ai.<model>` services are governed routes to exact hosted models. User-created
  model services, provider services, traffic splits, fallbacks, external endpoints, provisioned
  endpoints, custom models, fine-tunes, agents, indexes, and training artifacts are account
  resources. Their inventory can reconcile usage but cannot add public catalog identity or static
  cross-model relationships.
- The public page source is sufficient for a no-LLM refresh. Comparators, an undocumented
  `serving-endpoints:foundation-models` route, guessed display-name families, and a universal
  `DBU × 0.07` rule are excluded from the authority graph.

### Resources, books, and offer boundaries

| Resource or book                              | Target offers                                                                                | Boundary                                                                                                                                                                                                                                                                                       |
| --------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact hosted model                            | Pay-per-token inference                                                                      | Standard is the normal variant. Priority is a requested service-tier variant of the same mechanism, with the realized billed tier controlling the amount when fallback is possible. Cache class, context band, geography, and promotion are also term variants, not offers.                    |
| Exact Batch-supported model                   | `ai_query` Batch inference                                                                   | Batch is a separate model offer because AI Functions runs a distinct SQL/Python data-processing mechanism, manages its own scaling and retries, publishes DBU/hour rates, and records `BATCH_INFERENCE` billing usage. It is not a token discount column.                                      |
| Provisioned model endpoint                    | Entry/scaling model-unit-hour capacity or the documented legacy throughput band              | Capacity is a separate offer, billed in per-minute increments. Covered request cost cannot be reconstructed as a token rate. Base, fine-tuned, and custom deployments are account resources; only an exact public base architecture may project compatibility to a catalog model.              |
| CPU/GPU Model Serving                         | Node- or GPU-instance-hour capacity                                                          | Custom models, features, and agents are account resources. CPU/GPU rate cards describe serving capacity, not a public model identity or a Foundation Model API token price.                                                                                                                    |
| External model/provider service               | Governed BYOK route                                                                          | The upstream provider bills the customer. Databricks' estimated external-model spend is informational reconciliation, not a Databricks price offer and not an invoice substitute. Any separately priced Gateway feature remains an independent Databricks component.                           |
| Current AI Gateway                            | Usage Tracking and Inference Tables/payload logging                                          | The two features have distinct payload-byte and token meters. Rate limits, budgets, routing, fallbacks, and service policies are control-plane resources; a generic Gateway label must not make them share a rate. An orphan legacy card key without current page identity is not projected.   |
| Agent Bricks                                  | Knowledge Assistant answers and Supervisor Agent steps                                       | A Knowledge Assistant answer is charged only when it accesses the knowledge base, while ingestion, parsing, embedding, and AI Search remain native components. Supervisor charges its own steps plus every sub-agent at that sub-agent's native price. Generated agents are account resources. |
| AI Search                                     | Standard and Storage Optimized compute, storage, ingestion, and selected embedding inference | Compute-hour units, GB-month storage, Jobs ingestion, and model embeddings are distinct components. The first 30 GB allowance applies only to the documented storage term. Self-managed sync with no additional Search ingestion charge does not make its custom compute free.                 |
| Agent Evaluation                              | Judge input/output usage and synthetic questions                                             | The evaluation service and synthetic-data generator remain distinct. Evaluated application/model execution is separate when Databricks actually runs it; precomputed outputs do not create generator inference.                                                                                |
| Task-specific AI Functions                    | `ai_parse_document`, `ai_extract`, and `ai_classify`                                         | These are provider services recorded under `AI_FUNCTIONS`. Published complexity examples are estimates, not exact per-page or per-input rates. Other task-specific functions without an exact public price remain service candidates, not inferred model offers.                               |
| Foundation Model Training and AI Runtime      | Fine-tuning/training DBU consumption and A10/H100 GPU-hour runtime                           | The public examples and GPU cards describe training services. Resulting weights and fine-tunes are account artifacts and never public catalog rows. Approximate training examples are not exact model price terms.                                                                             |
| Genie                                         | Genie One, Agents, Code, and future Ontology service                                         | Genie LLM usage, per-user allowance/promotion, and underlying SQL or other compute are separate accounting components. Genie can be a Supervisor sub-agent but is not a model. `Price coming soon` is `not_published`, not zero.                                                               |
| Databricks-provided or registered MCP service | Governed tool route                                                                          | A `system.ai` MCP service is a provider route, not a model or model add-on by capability inference. No reviewed Gateway card establishes an MCP-call rate; missing Databricks price is `not_published`, while SaaS or self-hosted costs stay with their owner.                                 |

SQL warehouses, Jobs, Lakeflow, storage, data transfer, external SaaS, and cloud infrastructure remain
external books unless a reviewed Databricks AI page establishes an exact composed component. The
catalog does not copy their entire price books merely because an AI workflow can use them.

### Relationship matrix

| Source                             | Relationship      | Exact target or rule                                                                                                                                                                                                                                                             |
| ---------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pay-per-token inference            | `exclusive_with`  | Batch execution and capacity-covered execution for the same realized inference. Standard/Priority, cache, context, region, and promotion remain variants within pay-per-token.                                                                                                   |
| Batch inference                    | resource/route    | The exact `ai_query` mechanism and supported hosted-model ID are route applicability. A required custom, external, or fine-tuned endpoint remains an account-resource prerequisite, not a public commercial edge. AI Functions does not consume referenced provisioned capacity. |
| Capacity-covered inference         | `requires`        | The exact provisioned endpoint, architecture, and active entry/scaling capacity. Fixed capacity allocation to an individual request remains operator policy.                                                                                                                     |
| Usage Tracking or Inference Tables | `compatible_with` | Only the documented endpoint classes. Foundation endpoints use token meters; CPU/GPU endpoints use payload-byte meters. Enabling one feature does not enable or price the other.                                                                                                 |
| Knowledge Assistant                | `incurs`          | One realized knowledge-base-backed answer plus every ingestion, parse, embedding, AI Search compute/storage, and other native component actually used. Trivial answers explicitly avoid the answer charge.                                                                       |
| Supervisor Agent                   | `incurs`          | Realized Supervisor steps plus each Knowledge Assistant, Genie, model endpoint, tool, or other sub-agent actually called at its native price. A configured but unused sub-agent creates no charge.                                                                               |
| Managed AI Search embedding        | `incurs`          | AI Search compute/storage/ingestion plus the exact selected embedding endpoint usage. A managed index does not make the embedding model included.                                                                                                                                |
| Agent Evaluation                   | `incurs`          | Exact judge usage and, when requested, synthetic questions or application/model execution. The evaluator service does not make the evaluated model call included.                                                                                                                |
| Genie                              | `incurs`          | Genie LLM usage plus underlying compute actually executed. Its monthly LLM allowance does not cover compute and is shared across the documented Genie surfaces.                                                                                                                  |

User-authored model services can contain up to the documented number of destinations, traffic
splits, and sequential fallbacks. Those are account-defined route graphs, not public catalog
relationships. The realized destination in usage/billing records owns attribution. Failed attempts
may still incur an upstream cost; absence from the final-destination field never proves a zero-cost
attempt.

### Meters, denominators, signals, and resolution phase

| Commercial atom            | Published denominator                                                                                           | Charge or reconciliation signal                                                                                        | Earliest reliable phase |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Pay-per-token input/output | Model-, context-, geography-, and tier-qualified million tokens                                                 | Direct response usage; `system.ai_gateway.usage`; `system.billing.usage` for settlement                                | Outcome / account       |
| Cache read/write           | Model-qualified million cache tokens                                                                            | Direct cache counters and current Gateway `token_details`                                                              | Outcome                 |
| Priority                   | Same token dimensions at the realized tier                                                                      | Requested `service_tier` is preflight only; resolved response/billing evidence controls fallback                       | Outcome / account       |
| Batch model inference      | DBU per execution hour                                                                                          | Query profile for progress; `MODEL_SERVING` plus `offering_type=BATCH_INFERENCE` for billable DBUs                     | Job / account           |
| Provisioned throughput     | Entry/scaling model-unit-hours, charged per minute, or exact legacy band                                        | Endpoint capacity configuration and billing usage                                                                      | Account                 |
| CPU/GPU serving            | Node-hours or GPU-instance-hours and published DBU consumption                                                  | Active serving resource and billing usage; scale-to-zero state where documented                                        | Account                 |
| Gateway Usage Tracking     | GB logged for CPU/GPU endpoints or million tokens logged for Foundation endpoints, with 1 KB payload increments | Exact feature billing usage; `system.ai_gateway.usage` describes what was logged but is not always the billed quantity | Account                 |
| Gateway Inference Tables   | GB logged for CPU/GPU endpoints or million tokens logged for Foundation endpoints, with 1 KB payload increments | Inference-table logging plus exact feature billing usage                                                               | Account                 |
| Knowledge Assistant        | Knowledge-base-backed answers                                                                                   | Agent result classification and `AGENT_BRICKS` billing usage                                                           | Outcome / account       |
| Supervisor Agent           | Supervisor steps                                                                                                | Supervisor trace/continuation step is operational evidence; billing usage is authoritative for charged steps           | Outcome / account       |
| AI Search                  | Provisioned compute unit-hours, storage GB-months, ingestion compute, and embedding tokens                      | Index/endpoint inventory, Jobs usage, exact model response usage, and billing usage                                    | Account                 |
| Agent Evaluation           | Input/output judge tokens; synthetic-data questions                                                             | Evaluation job/trace and billing usage                                                                                 | Job / account           |
| Task-specific AI Functions | Workload-dependent DBUs                                                                                         | Function identity in `product_features.ai_functions`; published ranges remain estimates                                | Job / account           |
| Foundation Model Training  | Training DBUs                                                                                                   | Training job and billing usage                                                                                         | Job / account           |
| AI Runtime                 | GPU-hours by GPU type, settled as Model Training DBUs                                                           | Runtime workload/GPU telemetry and billing usage                                                                       | Job / account           |
| Genie                      | LLM DBUs plus separately billed native compute                                                                  | Genie billing usage and the corresponding native compute records                                                       | Outcome / account       |

The pricing application's `cards.json` is intentionally polymorphic. For example, an Agent
Evaluation plan/region scalar is a current SKU list-price factor, while the more specific
`regionModels.agent_evaluation` object contains input/output service amounts. AI Search and Gateway
cards use ordered compound values for different denominators. The reviewed page schema and renderer
labels resolve these meanings; splitting a string or reusing a field key without that contract is
unsafe.

Published `1k`, million-token, GB, GB-month, and GPU-hour denominators are exact source scales. The
canonical rate divides the published amount by that scale while charge bindings use the resulting
request, token, byte, byte-month, or accelerator-second unit. The first-30-GB AI Search benefit is
therefore a monthly byte-month allowance, not 30 unscaled bytes. Within an ordered compound card, an
invalid amount leaves that term raw while valid sibling amounts continue to normalize.

### Requested, realized, capacity, allowance, and settlement facts

Publication facts select callable model identity, mechanism support, plan/cloud/region, geography,
context band, cache category, promotion interval, service availability, and current public rate.
Request facts select model service, model/endpoint, Standard or Priority, Batch versus real-time,
Gateway features, index/agent/function, and other exact options. Outcome facts select destination,
invocation, actual token categories, routing attempts, successful knowledge-backed answers,
Supervisor steps, completed functions, and job/resource duration. Account facts supply active
capacity, plan, region, SKU, allowance consumption, negotiated discounts, credits, tax, currency,
and final invoice reconciliation.

Priority request or echo is not proof of the billed tier when fallback is documented. A model service
request can produce multiple `invocation_id` values for guardrails or multi-turn work, and fallback
attempts can repeat model/service components. Cost composition therefore operates on realized
invocations, not one request-level boolean.

The 14-day trial, committed-use discount, and custom-requirements language does not publish a
universal zero rate or allowance amount. Genie publishes a precise per-user monthly LLM allowance and
scope, but excludes service principals and underlying compute. Gateway budgets are controls based on
near-real-time estimates, not allowances or settlement: they omit provisioned and external-model
inference and can block above or below eventual billable cost.

Model pages publish DBU consumption rates. Exact account list cost is a second multiplication:
billable DBUs times the matching `system.billing.list_prices.pricing.effective_list` value for the
same SKU, cloud, usage unit, and effective interval. That produces public account list cost, not net
invoice cost. Direct USD pass-through model terms and direct USD provider-service rates must not be
multiplied by a DBU factor again.

### Commercial-atom disposition ledger

| First-party atom                                                                   | Target disposition                                                                                   | Rationale                                                                                                                                                              |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Standard/Priority, cache, context, geography, and promotion-qualified model tokens | Normalize as exact pay-per-token variants                                                            | The mechanism and dimensions are exact. A missing Priority amount affects only that variant.                                                                           |
| `ai_query` Batch rows                                                              | Normalize as separate model offers                                                                   | The distinct mechanism, DBU/hour denominator, support matrix, and billing discriminator are first-party facts.                                                         |
| Provisioned throughput                                                             | Normalize capacity offers                                                                            | Entry/scaling capacity and per-minute charging are exact; request amortization remains account policy.                                                                 |
| CPU/GPU Model Serving                                                              | Normalize provider capacity offers                                                                   | The public capacity rates are exact and do not create custom-model catalog identity.                                                                                   |
| Usage Tracking and Inference Tables                                                | Normalize separate provider-service offers                                                           | Each has exact endpoint-class denominators and published plan/cloud/region amounts.                                                                                    |
| Orphan legacy content-filtering card                                               | Withhold from the current topology                                                                   | `cards.json` still contains a key, but the reviewed current Gateway page does not supply the card identity and applicability needed to publish it.                     |
| Rate limits, traffic splits, fallbacks, budgets, grants, and service policies      | Preserve as control/access facts                                                                     | No reviewed exact independent charge applies to these generic controls. They still affect route or eligibility.                                                        |
| Current guardrail evaluator/model calls                                            | Normalize only the exact evaluator model usage; preserve orchestration semantics as bounded evidence | No-separate-fee orchestration and separately billed evaluator inference are different claims. Missing model binding must not become free.                              |
| Knowledge Assistant answers and Supervisor steps                                   | Normalize provider-service offers with realized dependencies                                         | Their denominators and native-component composition are explicit.                                                                                                      |
| AI Search compute, storage, and documented allowance                               | Normalize; retain ingestion and embedding as separate requirements                                   | Compute, storage, ingestion, and embeddings have different meters and owners.                                                                                          |
| Agent Evaluation composite input/output amounts                                    | Normalize from the more specific rendered composite contract                                         | The service-specific input/output object is more specific than the shared SKU list-price scalar; the scalar remains settlement evidence, not a conflicting judge rate. |
| Synthetic evaluation questions                                                     | Normalize as a separate provider service                                                             | The per-question meter is exact and includes the stated cloud-instance component.                                                                                      |
| `ai_parse_document`, `ai_extract`, and `ai_classify` examples                      | Preserve ranges and formulas as bounded estimates                                                    | Complexity-dependent DBU ranges are not exact rates. Billing observations can reconcile jobs but cannot turn an estimate into a public deterministic price.            |
| Training examples                                                                  | Preserve as bounded estimates; normalize only exact DBU settlement terms                             | Model/word-count examples are approximate. Generated artifacts remain account resources.                                                                               |
| AI Runtime A10/H100                                                                | Normalize provider capacity offers                                                                   | GPU type and GPU-hour denominator are exact; billing settles through Model Training DBUs.                                                                              |
| Genie LLM rate, promotion, and per-user allowance                                  | Normalize with exact time, identity, and scope conditions                                            | The allowance is shared across named-user surfaces and excludes compute and service principals.                                                                        |
| Genie Ontology `Price coming soon`                                                 | Preserve as a `not_published` service offer                                                          | A real service with no amount is not free or included.                                                                                                                 |
| Unpriced MCP/tool routes                                                           | Keep outside the static price books until an exact public service identity is joined                 | A route or capability does not establish a commercial offer. Missing Databricks price is not zero.                                                                     |
| `system.ai` model/MCP routes and user-created route graphs                         | Resource/access facts                                                                                | Routes govern execution but do not create price offers, aliases, or model identity.                                                                                    |
| External provider spend estimate                                                   | Exclude from Databricks public price authority; retain as reconciliation evidence                    | It uses third-party published prices, aggregates hourly, and can differ from the invoice.                                                                              |
| Quotas, ITPM/OTPM/QPH limits, budget thresholds, and concurrency                   | Capacity/control facts                                                                               | They are not charges or allowances unless an exact commercial term says so.                                                                                            |
| Private prices, committed-use discounts, credits, taxes, refunds, and invoices     | Account settlement only                                                                              | Public refresh cannot derive them.                                                                                                                                     |

### Authority and conflicts

Authority is claim-specific:

1. The exact model pricing page controls model DBU rates. A Databricks-delegated exact Google section
   controls only the stated pass-through model dimensions. Provider-service page data, card data,
   and renderer labels jointly control provider-service public amounts.
2. The more specific service/model composite controls its own amount; a shared plan/SKU scalar is a
   settlement factor, not an alternative service rate. `system.billing.list_prices` controls the
   account's historical effective SKU list factor, while `system.billing.usage` controls billable
   quantity. Neither changes public catalog identity.
3. Current feature docs own mechanism, compatibility, fallback, and billed-event meaning. API and
   system-table schemas own usage fields. A generic product overview cannot override a newer exact
   pricing card or feature-specific billed statement.
4. If equally specific current sources still conflict, select a winner only through a reviewed
   containment, effective-date, or source-purpose rule. Retain the losing observation as a visible
   warning. Without such a rule, withhold only that amount, unit, condition, or relationship; keep
   sibling terms, services, models, and the provider snapshot.

The current specific Unity AI Gateway pricing page and Usage Tracking guide establish named billable
features. Any broader Beta-era no-charge statement is insufficient to turn those exact features into
zero-price offers. Conversely, a named feature absent from the current rate cards is not assigned the
nearest Gateway rate.

Refresh enumerates every card identity and value in each reviewed pricing page and every reviewed
model table row. Card regions qualify prices but do not claim service availability; the page itself
warns that displayed pricing does not guarantee availability. New fields, units, compound value
shapes, services, model labels, and unmatched rates are retained as bounded evidence and surfaced for
review while understood siblings continue to publish. Matching uses an exact callable ID, exact
field/service key with reviewed page semantics, or one uniquely documented alias. It never uses fuzzy
matching, model family inference, comparator inheritance, or an LLM.

Unsafe catalog identity and required operational-contract drift remain provider-level failures because
publishing a wrongly bound callable ID or charge signal would corrupt every dependent claim.
Commercial parsing is claim-local: an unrecognized model price cannot admit a model and loses only
that price; a malformed price table does not erase other price pages; an unrecognized provider card
remains raw in an unreviewed service book and separate from same-name normalized resources in
provider presentation. Missing source data retires a fact only when the source is exhaustive for
that exact claim; temporary/partial failure may retain the prior fact with visible staleness.
Provider publication remains crash-atomic after reconciliation.

### Model-detail composition and cost coverage

Model details project only exact model-qualified pay-per-token, Batch, and capacity offers plus
provider services with exact model applicability. `system.ai` routes, user-created model services,
custom/fine-tuned artifacts, agents, indexes, AI Functions, Genie, MCP services, and broad serving or
training capacity never masquerade as model rows. A capability flag or the fact that an agent can
call a model does not create a commercial relationship.

A calculator adds every independently charged realized component once: model inference, Gateway
logging/tracking, Batch or capacity, Agent Bricks, Search, evaluation, AI Functions,
Genie, and native compute where applicable. It distinguishes DBU consumption from the account's
USD-per-DBU settlement factor and from direct USD rates. Coverage is `complete` only when every
realized component has an exact rate, quantity, and required account settlement fact; otherwise it
is `partial` with the missing rate, usage binding, allowance state, capacity allocation, or account
factor named. Delayed billing can reconcile cost, but cannot retroactively make an unidentifiable
request exact.

## Request usage, observability, and account cost

- Direct Foundation Model responses have one exact reviewed usage field set:
  `completion_tokens`, `prompt_tokens`, `total_tokens`, `reasoning_tokens`,
  `cache_read_input_tokens`, and `cache_creation_input_tokens`. The cache fields are top-level usage
  fields for Databricks-hosted Claude endpoints when caching is active. Additions, removals, or
  renames require review so a billing dimension is not silently dropped.
- The legacy model-serving AI Gateway writes `system.serving.endpoint_usage` and
  `system.serving.served_entities` when usage tracking is enabled. It exposes input/output token
  counts, and documents a `(text_length + 1) / 4` estimate when a model does not return token counts;
  it does not provide the cache/reasoning breakdown of the newer table.
- The newer Unity AI Gateway Beta writes `system.ai_gateway.usage`. Its `token_details` struct
  includes cache-read, cache-creation, and output-reasoning tokens, and the row also identifies the
  destination model and routing outcome. It does not track token usage for non-streaming,
  non-embedding responses larger than 1 MiB.
- `system.billing.usage` is the global account billable-usage ledger. For Model Serving it carries
  DBU quantity, SKU, workspace/endpoint attribution, product features, and ORIGINAL/RETRACTION/
  RESTATEMENT correction semantics. Batch inference is distinguished by
  `billing_origin_product=MODEL_SERVING` plus `offering_type=BATCH_INFERENCE`.
- `system.billing.list_prices` is the global historical SKU price table. Its effective intervals,
  cloud, currency, usage unit, and `default`, `promotional`, and `effective_list` values are
  published list-price evidence. Joining it to billing usage produces account list cost, not a
  negotiated net rate or invoice-exact amount.
- The newer AI Gateway cost surface attributes hosted-model DBUs through `system.billing.usage`.
  `system.ai_gateway.external_model_spend` is different: it estimates external-provider USD spend
  from published upstream prices, aggregates hourly, and explicitly may differ from the provider
  invoice. It is not a Databricks-hosted model price source.
- System tables are additive schemas: new columns/struct fields are allowed, while disappearance of
  reviewed semantic fields rejects the contract. They update throughout the day and do not support
  real-time monitoring. A gateway should therefore route from a local first-party rate book and
  reconcile asynchronously against response usage, gateway usage, and billing records.

## Extraction and reconciliation

- Fixed companions must appear exactly once by canonical pathname. The parser rejects duplicate
  documents, duplicate endpoint IDs, unknown regional/task/Priority IDs, ambiguous label joins,
  invalid calendar dates, malformed row/column spans, and missing operational billing semantics.
- Semantic system-table checks intentionally require reviewed field subsets rather than exact full
  schemas because Databricks documents additive evolution. Pricing tables and the direct response
  usage block remain exact where an added column can change monetary meaning.
- Each open-model row, partner-model row, promotion note, Priority support entry, delegated image
  section, and account-specific-discount boundary receives a source-item disposition. Rows outside
  the reviewed callable catalog are excluded; missing exact Priority amounts are raw; numeric rows
  are normalized. Unbound, ambiguous, unsupported, or unresolved pricing items fail publication.
- The live reconciliation is 13 open-model rows, 65 partner rows, 2 delegated image rows, 1 launch
  note, 1 promotion note, 1 exact Priority row, 15 raw Priority facts, 7 out-of-catalog exclusions,
  and 2 account-specific discount exclusions, with no unresolved item.

## Comparison-only ecosystems

- models.dev currently has 30 Databricks files, only 28 of the 50 live official IDs. Its generator
  calls the authenticated, undocumented `serving-endpoints:foundation-models` route, filters for AI
  Gateway v2 chat support, deliberately ignores several Llama/Qwen/Gemma prefixes, and writes
  `base_model` links that inherit upstream provider metadata and cost. It is useful inventory
  evidence, but not an independent Databricks price book.
- LiteLLM currently has 28 Databricks entries, 19 matching the live official IDs and 9 retired/old
  extras. Its entries cite the two public Databricks price pages, store DBU values, and deliberately
  compute USD as `DBU × 0.07`; a repository test enforces that assumption. Its Databricks cost helper
  multiplies only prompt/completion tokens and does not model the reviewed endpoint, context,
  cache, Batch, promotion, Priority, or account-list-price dimensions.
- ccusage is no longer simply a frozen LiteLLM consumer. Its hourly automation updates both a
  LiteLLM snapshot and a models.dev snapshot; runtime lookup prefers LiteLLM and uses models.dev as
  an embedded/live fallback. It is therefore a downstream composition of the same two comparison
  sources, not independent Databricks evidence.
- Portkey's open model-price repository has no native Databricks provider entries in the reviewed
  tree. Databricks SDKs/CLI provide generated serving API shapes, while Databricks Labs cost tools
  focus on compute/SKU estimation; neither supplies an independent public Foundation Model API
  model-and-price catalog.
