# Hugging Face

Status: current

## Sources and identity

- Global presence comes only from Hugging Face-operated public catalog surfaces.
  The HF Inference live mapping is the first-party serving catalog for Hugging
  Face's own hosted inference service, while the OpenAI-compatible router is a
  bounded current routed-product catalog. Other partner mapping registries are a
  much broader deployment inventory; they contribute routes only for rows that
  meet the partner product boundary below. All surfaces use the exact
  `namespace/repository` ID. An ordinary Hub repository is never a catalog model
  merely because it can be deployed.
- The mapping collector calls
  `GET /api/partners/{provider}/models?status=live` for the 18 partners linked by
  the official Inference Providers overview: Baseten, Cerebras, Cohere, DeepInfra,
  fal, Featherless AI, Fireworks AI, Groq, HF Inference, Novita, Nscale, OVHcloud,
  Public AI, Replicate, Scaleway, Together, WaveSpeedAI, and Z.ai. The endpoint is
  documented as public, complete, and grouped by task. `huggingface-hf-inference`
  remains the stable historical source key even though it now aggregates every
  partner mapping registry.
- A concrete `hf-inference` `live` mapping is sufficient first-party evidence
  that Hugging Face currently serves the exact model. Do not require a second
  provider, router listing, recommendation, popularity threshold, or public
  model-specific price for those rows. This preserves specialized and traditional
  hosted workloads without an opinionated ranking rule.
- A concrete third-party `live` mapping proves callability but not by itself that
  the Hub artifact belongs in a compact reusable model catalog. Partner
  registration is partly mechanical: it requires a real Hub repository and
  matching pipeline tag, and large providers can consequently expose thousands
  of per-artifact deployments. Treating every partner registry as a product
  catalog made one Featherless inventory dominate Kmodels even though peer
  catalogs intentionally publish much smaller product surfaces.
- Catalog membership is therefore the deterministic union of four positive
  signals: an exact `hf-inference` live mapping; an exact row in the router
  catalog; an exact model with live mappings from at least two distinct integrated
  providers; or an exact live mapping named in an official Inference Providers
  task page as a `Recommended model` or in that page's bounded
  `InferenceSnippet` provider mapping. Router rows are collected independently,
  so the mapping parser emits the first, third, and fourth sets together with all
  their concrete routes. Distinct partners corroborate productization, not
  popularity. Official task-page evidence preserves specialized single-partner
  image, video, audio, retrieval, and traditional-ML candidates.
- Task pages are discovered on every refresh from the official task index and
  exact-joined to the live registries. There is no hard-coded task list, model
  allowlist, model-name heuristic, download/like threshold, modality cutoff, or
  Top-N. A new HF Inference live model, official task page, or featured partner
  model enters mechanically; a new uncorroborated partner deployment does not.
  Generated per-artifact pages, provider IDs copied from the artifact, and the
  generic warm/trending model browser are not additional admission signals.
- The fixed overview and the official `huggingface_hub` provider registry are
  independent inventory drift guards. The SDK registry currently has the same 18
  routed partners plus `openai`; the latter is an SDK integration and has no public
  partner mapping registry, so it is validated but not collected as an HF gateway
  route. A missing or additive partner on either companion is a claim-local finding:
  current router rows and sibling documentation remain usable, while a new provider is
  surfaced as unsupported until its official mapping endpoint is configured. The
  exhaustive mapping transport still requires one bounded response for every configured
  partner before it can claim a complete mapping snapshot.
- The router source bundles fixed first-party documentation for the Hub and mapping
  APIs, provider selection, pricing, Chat Completions, Responses, partner validation
  and billing, the Python inference client, Hub billing, Endpoint and Spaces hardware,
  ZeroGPU, Jobs and its hardware API, storage, and plan and Enterprise pricing. Each
  companion owns only the claims extracted from it inside a complete bundle. Prose
  drift reports an unbound claim, while an unavailable commercial companion retains
  the complete previously accepted HF pricing partition without rejecting current
  router catalog rows. For partner-only rows, only the task-index documents
  described above supply bounded single-partner product evidence, and only by exact
  join to a current live mapping.
- Featherless's unauthenticated native `GET /v1/models?status=active` catalog is a
  provider-operated pricing overlay, not presence evidence. Pagination requests the
  documented maximum of 1,000 rows and follows the returned page count with bounded
  concurrency. Only an exact catalog model that already has a concrete
  `featherless-ai` live mapping is retained from this source. Native Featherless models
  without that HF route are discarded before merge and cannot create catalog rows,
  source references, routes, or price books.
- The paginated Hub query filtered to `hf-inference` overlays the exact repository
  artifact `lastModified` date onto matching current rows. It cannot create presence,
  and repository creation or router `created` timestamps do not become model release
  dates. Partner-only models intentionally lack this overlay rather than inheriting a
  timestamp with different semantics.
- A published concrete mapping preserves provider, provider model ID, task, source,
  and status in `routes`. The 23 currently observed tag-filter entries are dynamic
  LoRA routing contracts, not 23 model identities: validate their `adapterType` and
  exact tag set, then exclude them with an explicit reconciliation record.
- Do not flatten `api/models?inference_provider=all&expand=inferenceProviderMapping`
  into presence. A read-only audit still had a next page after 30,000 Hub models and
  mixed 9,705 concrete routes with more than 50,000 tag-filter expansions. The
  bounded per-partner mapping registries preserve the contract before those filters
  expand over matching Hub artifacts.
- Global collection uses neither an HF token nor a Featherless token. Broken top-level
  envelopes, missing configured mapping responses or task documents, empty admitted inventories,
  and hard safety bounds still fail their source. Expected cardinality is not an
  admission rule; provider-level churn validation protects publication from a partial
  exhaustive response. Additive fields are ignored, while malformed, duplicate,
  credential-like, and dynamic-LoRA rows are handled independently. This keeps refresh
  deterministic and best-effort without allowing one bad row to erase a valid model or
  meter.

## Routes and mapping

- Task is not an admission filter. An HF Inference live mapping is admitted for
  every task; a task page may separately supply exact positive product evidence
  for a partner-only row, but its task label never admits or rejects by workload.
  Once a candidate is admitted, preserve all its concrete live routes, including
  classification, fill-mask, extractive QA, segmentation, object detection, and
  unknown future tasks. This avoids using a coarse pipeline tag to discard prompt
  guards, moderation models, cross-encoder rerankers, turn detectors, or future
  workloads that share a traditional task API.
- An exact `translation` route maps to canonical translation. Fill-mask, extractive
  question-answering, and table-question-answering remain callable raw routes but do not become
  text generation merely because they return text.
- `feature-extraction` is normalized as embeddings. `sentence-similarity` and
  `text-ranking` are normalized as reranking because their callable result is a score,
  not an embedding vector. Classification pipeline tags remain classification;
  image segmentation and object detection retain their exact canonical families.
  Extractive QA, table QA, and fill-mask retain text input/output modalities and raw
  route tasks without being mislabeled as text generation. An unknown future task
  likewise keeps the model and raw route while canonical task and modalities remain
  unknown. In particular, `image-text-to-video` means text plus image input and video
  output.
- Hugging Face tests each live mapping every six hours; failed mappings are retested
  hourly and temporarily removed from the active provider list. Mapping `live` is the
  public offer state, not a guarantee that a transient health probe currently passes;
  collection does not flap durable presence based on latency or temporary route
  health.
- Router rows with at least one live backend are active and carry exact
  `/v1/chat/completions` and `/v1/responses` endpoint evidence. Responses is currently
  beta, but Hugging Face states that all Inference Providers chat-completion models
  should be compatible.
- Each live backend retains a separate `route_provider` price condition. Aggregate
  capability flags are positive if a live route supports them; the published model
  context is the maximum advertised by a live route. A pinned backend must still use
  that route's context and capabilities rather than the aggregate maximum.
- `is_free` means a temporary promotion, while a simultaneous nonzero input/output
  price remains the route's base list rate. Preserve both claims: the promotion makes
  the route effectively free while observed, but it does not replace the base rate or
  imply an end date. A live route with no published price remains an `unbound`
  diagnostic; zero values without `is_free` remain ordinary published zero rates.
- Parse route prices independently by meter. If one price field is malformed, retain
  the valid meter and live route, mark the record ambiguous, and let the volume guard
  detect systemic failure. Invalid optional architecture, context, or capability
  metadata likewise cannot erase an otherwise valid live route.
- Server-side suffixes are routing policies, not aliases or service tiers.
  `:fastest` uses throughput, `:cheapest` uses the lowest output-token price,
  `:preferred` uses account preference order, and `:<provider>` pins a backend.
  Automatic failover can change the realized route, so cost-sensitive requests should
  pin the provider they priced.
- First-token latency and throughput come from the latest validation probe. They are
  useful live routing inputs but too volatile to become durable model facts.

## Commercial topology

Implementation status: current. The collector and canonical price book represent the
router's route-qualified list rates, temporary promotions, unpriced routes, HF versus
custom-key settlement, Endpoint and Spaces capacity, Jobs hardware and exposed ports,
ZeroGPU quotas and overage, public storage add-ons, private-storage raw bands, and Hub
plan prices. Exact route token and compute-duration signals have charge bindings;
provider resources stay standalone unless first-party evidence supplies an exact
model projection or resource edge.

Some audited account facts intentionally remain raw or outside public calculation:
the ZeroGPU xlarge multiplier needs usage aggregation, private storage lacks a shared
TB-month denominator, `hf-inference` lacks the public hardware/time join, and monthly
credits, plan storage allowances, invoices, negotiated terms, and private resource
instances need account evidence. This is partial cost coverage, not missing catalog
presence and not permission to invent a representative rate.

### Public commercial source graph

| Surface                                                                                                                                                                                                                                                                                      | Exact authority and completeness boundary                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The [Inference Providers overview](https://huggingface.co/docs/inference-providers/en/index), [pricing guide](https://huggingface.co/docs/inference-providers/en/pricing), public partner mappings, and router `/v1/models`                                                                  | Current routed product presence, backend variants, task, public token rates, context, tool/structured-output support, temporary `is_free` state, and provider selection policies. A router omission says nothing about non-chat mappings, dedicated deployments, or ordinary Hub repositories. |
| The [Hub billing API guide](https://huggingface.co/docs/inference-providers/en/hub-api) and [provider registration contract](https://huggingface.co/docs/inference-providers/en/register-as-a-provider)                                                                                      | `bill_to` attribution, HF-routed versus custom-key settlement, provider request-ID correlation, immediate placeholders, delayed integer nano-USD resolution, and retry behavior. The cost endpoint is provider-to-HF infrastructure rather than a public customer price API.                   |
| The [function-calling](https://huggingface.co/docs/inference-providers/en/guides/function-calling) and [Responses](https://huggingface.co/docs/inference-providers/en/guides/responses-api) guides                                                                                           | Interface behavior, caller-executed functions, Remote MCP execution, request selectors, and response usage. Capability alone does not establish a Hugging Face tool charge.                                                                                                                    |
| The [Inference Endpoints pricing](https://huggingface.co/docs/inference-endpoints/en/support/pricing), [foundations](https://huggingface.co/docs/inference-endpoints/en/guides/foundations), and [autoscaling](https://huggingface.co/docs/inference-endpoints/en/guides/autoscaling) guides | Exact cloud/region/instance/size capacity rates, per-minute billing, replica and lifecycle semantics, endpoint configuration, and enrollment. These are dedicated resource rates, not token prices for every deployable Hub repository.                                                        |
| The [Spaces hardware and billing](https://huggingface.co/docs/hub/en/spaces-gpus), [Spaces overview](https://huggingface.co/docs/hub/en/spaces-overview), and [ZeroGPU guide](https://huggingface.co/docs/hub/en/spaces-zerogpu)                                                             | Hardware capacity rates, replica billing, charged states, sleep/pause behavior, ZeroGPU daily allowances, size multipliers, and credit overage. A Space may host arbitrary software and therefore supplies no model-catalog presence by itself.                                                |
| The [Jobs overview](https://huggingface.co/docs/hub/en/jobs-overview), [Jobs pricing](https://huggingface.co/docs/hub/en/jobs-pricing), and `GET /api/jobs/hardware`                                                                                                                         | Current hardware inventory and rates, billed lifecycle, arbitrary job workload, and exposed-port pricing. Jobs can train or run a model, but that does not create a per-model offer.                                                                                                           |
| The general [pricing](https://huggingface.co/pricing), [PRO](https://huggingface.co/pro), [Enterprise](https://huggingface.co/enterprise), and [Hub billing](https://huggingface.co/docs/hub/en/billing) pages                                                                               | Plan prices and procurement, monthly inference credits, subscription renewal, compute separation, balance/invoice settlement, and marketplace payment rails. A plan benefit applies only to the exact product named by its terms.                                                              |
| The dedicated [storage limits and billing guide](https://huggingface.co/docs/hub/en/storage-limits)                                                                                                                                                                                          | Public and private repository-storage allowances, paid public tiers, private overage increments, and plan prerequisites. It owns exact storage mechanics over summary marketing rows.                                                                                                          |

Comparator catalogs are audit-only. models.dev, LiteLLM, Portkey, gateway catalogs,
and cloud marketplaces may reveal a missing first-party Hugging Face claim, but they
cannot create a Hub identity, turn deployability into hosted presence, or copy a
seller's amount into the HF-direct book.

### Books, resources, and offer boundaries

- An HF-routed Inference Providers request is one usage offer for an exact
  model/backend/task route. Hugging Face authenticates, meters, applies eligible
  monthly credits, and bills the request at the upstream provider's standard API rate
  without markup. Backend, task, context, and capability remain applicability facts;
  route input/output rates are exact only where the router publishes them.
- Chat Completions and Responses are delivery interfaces over the same routed text
  work when their exact model/backend route is shared. Streaming, structured output,
  caller function calling, and Remote MCP transport do not create another usage offer
  without a separately published amount. Other mapped task families remain live
  offers with `not_published` amounts rather than inheriting the chat token table.
- A custom provider key is a distinct externally billed settlement offer. Hugging
  Face still routes the request and swaps credentials, but does not charge it and does
  not apply HF inference credits. The upstream provider's first-party book and invoice
  own the economic cost; HF's zero charge must never be presented as zero total cost.
- `hf-inference` is a separate Hugging Face-owned serverless offer. Public billing is
  compute time multiplied by the underlying hardware rate, but the mapping and public
  response do not bind the request to a hardware SKU or eventual compute time. Keep
  the offer and its exact delayed settlement while its public amount remains
  `not_published`; do not fabricate a token rate.
- `is_free` is a temporary effective promotion on one exact router backend. Preserve
  its nonzero base rate and current promotional state together. The promotion is not
  a calculator selector, has no invented end date, and does not make the artifact or
  other routes permanently free.
- `:fastest`, `:cheapest`, `:preferred`, a pinned `:<provider>`, and native-client
  `provider="auto"` are routing policies, not commercial offers. Automatic failover
  chooses one realized backend. An unpinned pre-request price is therefore a candidate
  set, range, or unknown rather than a single exact amount; `:cheapest` considers only
  the output-token price.
- A dedicated Inference Endpoint is an account resource backed by a standalone
  capacity offer for an exact cloud, region, instance type, size, and replica. The
  model repository, revision, task, framework, or custom image configures that
  resource but does not turn the capacity row into a global per-model price. Only an
  exact account endpoint can relate its resource to the deployed artifact.
- A Space is likewise an account application resource backed by one hardware-capacity
  offer per replica. CPU Basic is an explicit zero-rate hardware option, although a
  compute Gradio or Docker Space requires an eligible paid plan. Static Spaces and
  the separate ZeroGPU mechanism must not be conflated with paid CPU/GPU capacity.
- ZeroGPU is a provider-service GPU-time offer with plan/account daily allowances.
  After the allowance, eligible paid accounts consume prepaid credits at the
  published `$1 per 10 GPU minutes` rate. Current daily quotas are 2 minutes for an
  unauthenticated visitor, 5 for a Free account, 40 for PRO or a Team member, and 60
  for an Enterprise member. Large hardware consumes 1x quota and xlarge consumes 2x;
  queue priority is an operational benefit, not another price. The allowance resets
  exactly 24 hours after the account's first GPU use, not at a shared calendar boundary.
  The canonical book normalizes each included quantity and rolling reset plus the
  derived `$0.10/GPU-minute` overage for paid tiers. It retains the xlarge multiplier
  as a usage-aggregation term rather than pretending the base duration counter already
  applied it.
- A Job is an arbitrary account compute resource backed by an exact hardware-capacity
  offer. Exposed ports add one flat provider-service offer per active job regardless
  of port count, currently `$0.01/hour` billed per minute. Training, inference, or data
  processing performed by the job does not create a model-specific rate.
- Hub Free enrollment, PRO, Team per-seat, and Enterprise procurement are subscription
  facts. Their prices, seats, credits, storage allowances, and eligibility do not
  rewrite usage rates. PRO is currently `$9/month`; Team is `$20/user/month`;
  Enterprise remains `custom_quote` under the dedicated procurement page despite the
  general pricing page's `$50/month` observation. Monthly Inference Providers credits
  are `$0.10` for Free, `$2` for PRO, and `$2/seat` pooled for Team and Enterprise.
  Private-storage allowances are 100 GB for Free, 1 TB for PRO, and 1 TB/seat for Team
  and Enterprise. Public storage is best effort with no numeric Free allowance; the
  documented thresholds are up to 10 TB for PRO, 12 TB plus 1 TB/seat for Team, and
  200 TB plus 1 TB/seat for Enterprise. Purchased credits are balances usable by
  enumerated HF products, not discounts or public model prices. The current public
  book normalizes PRO and Team subscription rates and the Enterprise custom-quote
  conflict; Free enrollment and plan allowances remain account evidence until their
  exact targets and reset semantics can be represented without broadening them.
- Public Storage add-ons are fixed-capacity monthly subscription tiers that require a
  paid plan: the dedicated guide currently lists 1/5/10/20 TB for `$12/$60/$120/$240`
  per month and 50 TB for `$500/month`. Private storage overage is a separate offer
  billed in 1-TB increments after the plan allowance, starting at `$18/TB/month` and
  decreasing at the documented 50/200/500-TB bands. Neither should be normalized as a
  continuous per-byte model meter when first-party billing defines tier and increment
  semantics. Fixed public tiers are numeric offers. Private bands remain raw exact
  observations because the shared source vocabulary has no TB-month denominator;
  recording `$18/TB/mo` as an ordinary generic `unit_month` would erase the storage
  quantity and falsely make it calculator-ready.
- Ordinary caller-defined functions have no Hugging Face function-call fee. Responses
  Remote MCP can execute an external service, but Hugging Face publishes no generic
  MCP invocation price. Any external MCP seller's charge remains in that seller's
  book until an exact HF commercial term says otherwise.
- An AWS Marketplace subscription can place HF charges on an AWS invoice, but it is a
  settlement rail rather than a second rate. A direct cloud-partner solution is a
  different seller route whose first-party cloud catalog and invoice own the price.

### Commercial relationships

| Source offer or resource      | Relation                    | Target and scope                                                                                  | Cost consequence                                                                                                                   |
| ----------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| HF-routed provider offer      | `exclusive_with`            | Custom-key offer for the same realized provider attempt                                           | One request settles through HF credits/billing or directly with the upstream provider, never both.                                 |
| Realized backend variant      | `exclusive_with` by outcome | Other candidate backend variants for the same router attempt                                      | Failover or policy selection chooses one actual provider rate; candidate variants are not additive.                                |
| Temporary `is_free` promotion | effective override          | Exact backend base-rate offer while the promotion is observed                                     | Effective routed charge is zero, while the underlying published base rate remains visible for provenance and later refresh.        |
| Monthly inference credit      | account-only allowance      | Eligible HF-routed Inference Providers usage for the owning user, organization, or resource group | Keep outside public calculation until exact owner, reset, and offer targets are bound; never change the route's public list price. |
| PRO, Team, or Enterprise plan | includes allowance          | Exact documented inference, ZeroGPU, and storage benefits                                         | Apply only the benefit quantity and period stated for that plan. Shared organization credits remain account-scoped.                |
| Compute Space resource        | `requires` enrollment       | One eligible paid plan, except the separately documented ZeroGPU path                             | Enrollment permits creation; selected hardware/replicas still accrue their own capacity charges.                                   |
| Inference Endpoint resource   | `requires` enrollment       | Active subscription plus payment or credit setup                                                  | Enrollment enables deployment but does not include endpoint capacity unless an exact contract says so.                             |
| Jobs exposed-port service     | `requires_resource`         | The Jobs hardware capacity book                                                                   | Add one port-service charge per job-minute, not per exposed port; hardware remains independently billed.                           |
| Public Storage add-on         | `requires`                  | One paid Hub plan                                                                                 | The selected monthly tier supplements the plan allowance; it is not model usage.                                                   |
| Private storage overage       | `requires` after allowance  | Eligible plan plus retained private storage above its included quantity                           | Bill the documented 1-TB increments; do not create an overage offer for a free account that is not eligible to exceed its limit.   |
| Direct cloud solution         | `exclusive_with` by seller  | HF-routed execution for the same work                                                             | The cloud seller and HF route are alternative settlement paths even when they expose the same underlying model.                    |

Endpoint, Space, Job, ZeroGPU, storage, and routed-inference offers need no global
pairwise exclusivity. They are independently selectable products and can legitimately
accrue together. Add a relation only when an exact account resource or work item proves
the composition.

### Meters, denominators, and observable signals

| Commercial atom            | Public denominator                            | Required signal or reconstruction                                                                          | Phase                     |
| -------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------- |
| Router input               | million input tokens                          | Exact realized backend plus `prompt_tokens` for the compatible chat/Responses route                        | Outcome                   |
| Router output              | million output tokens                         | Exact realized backend plus `completion_tokens`; `total_tokens` is a cross-check, not another component    | Outcome                   |
| Router temporary promotion | same native token meters                      | Current `is_free` observation for the exact backend and request-time validity                              | Request/outcome/account   |
| `hf-inference` compute     | second multiplied by underlying hardware rate | Exact compute duration and bound hardware SKU; the public response currently does not expose both          | Account                   |
| Provider-to-HF settlement  | nano-USD per request                          | Correlated request ID and delayed integer `costNanoUsd`; zero is a valid resolved cost                     | Account                   |
| Endpoint capacity          | instance-replica minute                       | Exact SKU and time integration while each replica is `initializing` or `running`                           | Resource timeline/account |
| Space capacity             | hardware-replica minute                       | Exact hardware and each replica's `Starting` or `Running` interval; build, sleep, and pause are excluded   | Resource timeline/account |
| ZeroGPU allowance          | GPU minute with size multiplier               | Accepted GPU duration, hardware-size multiplier, plan quantity, and reset exactly 24 hours after first use | Outcome/account           |
| ZeroGPU overage            | GPU minute                                    | GPU duration after the eligible allowance is exhausted and prepaid credits are available                   | Account                   |
| Job capacity               | hardware minute                               | Exact Job SKU and `Starting` or `Running` interval                                                         | Job timeline/account      |
| Jobs exposed ports         | active job minute                             | Port exposure enabled during the same charged Job interval; number of ports does not multiply quantity     | Job timeline/account      |
| PRO subscription           | account month                                 | Enrollment period, first-month proration, and renewal                                                      | Account                   |
| Team subscription          | seat-month                                    | Active billed seats, first-month proration, and renewal                                                    | Account                   |
| Public storage add-on      | selected TB tier per month                    | Exact subscribed tier and effective upgrade/downgrade boundary                                             | Account                   |
| Private storage overage    | 1-TB billing increment per month              | Retained eligible private storage above the plan allowance and exact pricing band                          | Account                   |

Standard Chat Completions exposes prompt, completion, and total tokens, including a
final streaming usage chunk when requested. It does not guarantee the realized
backend, cached/reasoning partition, hardware time, or exact billed cost. Request ID
correlation and account settlement are therefore stronger than client-side inference
for those facts. A generic function or MCP event has no Hugging Face charge signal
because no corresponding HF service rate has been published.

### Requested, realized, allowance, enrollment, and settlement facts

- Request facts include exact model, task, provider suffix or policy, optional custom
  key, `bill_to`, endpoint/Space/Job hardware and replica configuration, and resource
  operations. A preferred backend, declared tool, requested replica count, or submitted
  job is not yet a realized billed quantity.
- Realized facts include the actual backend after failover, accepted token usage,
  lifecycle state intervals, active replicas, GPU duration, completed job work, and
  exposed-port interval. The public standard inference response does not always expose
  the realized backend, so exact route costing may remain unresolved until account
  evidence arrives.
- `X-HF-Bill-To` selects the user, organization, or resource group whose credits and
  balance settle an HF-routed request. It is a settlement target, not a rate modifier.
  A custom key changes the biller and credit eligibility, not merely attribution.
- Monthly inference credits, ZeroGPU time, plan storage, and free resource slots are
  allowances with distinct owners, periods, and eligible products. Never pool them or
  convert their face value into a lower public per-token or per-minute amount.
- An active plan, payment method, credit balance, organization seat, quota, or endpoint
  subscription is enrollment/account state. It controls eligibility but does not prove
  global product presence or a public amount.
- Public route/capacity books support estimates. Delayed nano-USD resolution, billing
  dashboards, provider invoices for BYOK, marketplace invoices, negotiated contracts,
  taxes, and adjustments progressively own account-exact settlement.

### Commercial-atom disposition ledger

| Reviewed atom class                                         | Design disposition                                                                                                                                                                                          |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Router backend input/output rows                            | Normalize only for the exact model/backend chat or compatible Responses route and retain route applicability. Never spread them to other tasks.                                                             |
| Router `is_free` plus nonzero rates                         | Preserve base rates and current temporary effective promotion together. This is not an amount conflict and supplies no permanent-free claim.                                                                |
| Backend policies and failover                               | Preserve as selectors and realized outcomes, not prices. Preflight totals remain partial until a backend is pinned or observed.                                                                             |
| Custom provider keys                                        | Normalize a separate `externally_billed` offer and settlement path, exclusive with HF billing for the same attempt. Preserve upstream cost as unknown until joined to that provider's evidence.             |
| `hf-inference`                                              | Preserve a standalone serverless service, its compute-time formula, and exact router-model projection where present; keep public amount `not_published` until hardware and duration are jointly observable. |
| Other partner task mappings                                 | Preserve admitted catalog routes and unknown pricing disposition. Do not manufacture a canonical offer without a task applicability dimension or copy chat, provider-average, or representative rates.      |
| Caller functions and Remote MCP                             | Preserve capabilities and external-service boundary. Emit no generic HF tool-call offer or invocation fee.                                                                                                  |
| Inference Endpoint SKUs                                     | Normalize standalone cloud/instance/size capacity offers with billed-duration bindings and account-scoped enrollment. Keep artifact configuration resource-scoped.                                          |
| Spaces hardware SKUs                                        | Normalize standalone per-replica capacity offers, explicit CPU Basic free state, billed-duration bindings, and account-scoped enrollment. Do not infer hosted-model presence.                               |
| ZeroGPU                                                     | Normalize daily plan allowances, rolling resets, and exact paid-tier overage; retain the xlarge multiplier raw until usage aggregation applies it.                                                          |
| Jobs hardware and exposed ports                             | Normalize hardware capacity plus one port-service offer and a `requires_resource` edge to the hardware book. Keep workload/model identity external to the rate.                                             |
| PRO, Team, Enterprise, and Free                             | Normalize current PRO and Team rates plus Enterprise `custom_quote`; retain the conflicting general Enterprise amount raw, and keep Free/plan allowances account-only.                                      |
| Public and private Hub storage                              | Normalize fixed public subscription tiers; retain exact private TB-month bands raw until a dimensionally complete denominator exists.                                                                       |
| Purchased credits, billing balance, `bill_to`, and invoices | Preserve as allowance, attribution, or settlement evidence. Never turn a balance or invoice average into an unqualified public rate.                                                                        |
| AWS Marketplace payment and direct cloud routes             | Preserve Marketplace as a settlement rail and cloud-direct products in the cloud seller's book. Do not duplicate the HF rate.                                                                               |
| Hub repositories, revisions, licenses, and gating           | Preserve artifact/resource identity and access only. Deployability or public availability creates no global inference offer or catalog admission.                                                           |

### Authority and conflicts

Authority is claim-specific rather than one total source order:

1. The live mapping owns exact task-route presence; the router owns the bounded chat
   backend catalog, route price, context, capability, and current promotion claim. A
   numeric base rate beside `is_free` represents base plus promotion, not inconsistent
   prices.
2. An upstream provider's exact first-party price can derive an HF-routed amount only
   when the provider model, task, meter, and HF route exact-join and HF's no-markup
   term covers the mechanism. Featherless is the current reviewed example. A family,
   model class, or provider-average join is insufficient.
3. Dedicated Endpoint, Spaces, Jobs, and storage pages own their exact SKU, state, and
   billing mechanisms over a general pricing summary. Summary omissions or rounded
   marketing values do not erase a more specific current table.
4. The Endpoint `intel-spr x2` table and hourly example publish `$0.067/hour`, while a
   monthly example implies `$0.064/hour`. The dedicated SKU table owns the normalized
   amount; preserve the example discrepancy as a local warning rather than rejecting
   the Endpoint book.
5. The general pricing page publishes an Enterprise amount while the dedicated
   Enterprise procurement page says custom pricing. The dedicated product page owns
   the representative `custom_quote` state; retain the numeric observation as a
   claim-local conflict. PRO and Team remain independently valid.
6. The dedicated storage guide owns fixed public add-on tiers and private increment
   mechanics. Larger-volume summary amounts remain raw/conflicting observations until
   an exact tier, applicability, and billing rule joins them.
7. The overview and native client guide disagree about whether `provider="auto"`
   means fastest or first preferred provider. Preserve both first-party observations,
   suppress only that automatic-policy binding, and keep documented server-side
   suffixes, routes, and prices.
8. Exact request settlement owns account-effective cost. Credits, custom keys,
   negotiated rates, taxes, adjustments, and invoice timing can change settlement
   without rewriting the public base book.

Refresh remains deterministic and non-LLM. Mapping registries, router catalog,
provider-native overlays, task pages, capacity tables, plan pages, storage terms, and
optional account evidence are independently validated claim groups inside a complete
bundle. Fresh exhaustive
route absence can remove only the route it owns; omission from a recommendation page
or non-exhaustive product surface cannot retire a model. Failure or drift in an
optional native price overlay retains the previous provider pricing partition rather
than erasing the current live route. A malformed meter, one partner's drift,
or an unresolved conflict suppresses only that claim and preserves the model, sibling
route, other meter, resource, raw evidence, and provider snapshot.

Every recognized public atom is normalized, retained raw, or reconciled as
account-only, conflicting, unsupported, ambiguous, or pending an exact relation.
Claim-local parsing keeps valid table rows and plan siblings when prose, another row,
or an optional companion drifts. No row is rejected merely because one optional
amount or attribute is missing.

### Model-detail composition and cost coverage

Model details project routed and custom-key offers only for exact router models:
backend, biller, base rate, temporary promotion, and the capabilities/context of that
route. Mapping-only task routes retain catalog and unknown-pricing evidence but do not
receive a fabricated chat offer while task applicability is absent from the shared
price selector vocabulary. A current Endpoint, Space, Job, ZeroGPU,
storage, plan, or credit offer remains standalone unless an exact account resource
relates it to that artifact. This keeps arbitrary Hub deployability from expanding the
global catalog or falsely attaching shared infrastructure prices to every repository.

Rate details keep selected-backend input/output, HF settlement, custom-key settlement,
dedicated SKU, replica, lifecycle, and add-on meters distinct. They never combine
candidate failover backends, base and temporary-free prices, HF and BYOK billing,
caller functions, or external MCP charges without first-party evidence. Unresolved
routes, hidden `hf-inference` hardware, allowances, and delayed account cost remain
partial context; the UI does not invent or calculate a complete total.

## Public estimate and account-exact cost

- The router publishes input and output USD per million tokens for each backend when
  available. Public list-price cost can be calculated only after selecting a route and
  estimating or observing prompt/output tokens. `:cheapest` compares output price,
  not combined request cost, so it is not a general minimum-total-cost policy.
- Most mapping tasks have no price in the mapping registry. A route is not assigned a
  representative token price merely because the same model or provider appears in the
  chat router. The router price is bound only to its exact model/backend chat offer.
- For `featherless-ai`, the provider's active model API currently embeds exact
  per-model `prompt` and `completion` decimal-string prices. Featherless documents
  these per-token values as the output of the same cascade used at billing time and
  documents request cost as input tokens times input price plus output tokens times
  output price. Kmodels scales those exact decimal strings to USD per million tokens
  and binds them only to `route_provider=featherless-ai`.
- The listing also exposes numeric `input` and `output` projections. They are a
  cross-check, not the chosen authority: when rounding or another discrepancy makes
  them conflict with the documented billing-resolution decimal strings, retain the
  `prompt`/`completion` result and publish the other observation as a visible
  `superseded_value` under
  `featherless_native_price_over_huggingface_route_snapshot`. A malformed or missing
  meter does not erase its valid sibling. `image` and `request` values are not imported
  because this source does not establish a usable billed unit and operation for them.
- Absence from Featherless's native active snapshot does not negate a concurrent HF
  `live` mapping. It is recorded as an unresolved first-party set conflict, while the
  catalog model and route remain. Conversely, native Featherless-only inventory never
  enlarges the HF catalog. Model-class table rates are not spread across IDs because
  the exact model payload is more specific and avoids a heuristic class join.
- `hf-inference` is billed as request compute time multiplied by the underlying
  hardware rate. Its mapping does not bind an invocation to a hardware SKU or publish
  eventual compute time, so those routes remain unknown-priced rather than receiving
  a fabricated token rate.
- Hugging Face charges routed requests at the underlying provider's standard API rate
  with no markup. Eligible monthly credits apply to HF-routed billing; a custom
  provider key bypasses HF billing and is charged by that provider. Organization
  attribution, shared credits, spending limits, disabled providers, private discounts,
  taxes, and invoices are account inputs, not model rates.

## Request, response, and billing freshness

- Chat Completions returns `prompt_tokens`, `completion_tokens`, and `total_tokens`.
  For streaming, `stream_options.include_usage` requests a final usage chunk. The
  public schema does not guarantee cached-token, reasoning-token, realized provider,
  hardware-time, or exact-cost fields. Responses documentation also does not establish
  a client-visible billed-cost field.
- HF immediately records a placeholder for a routed request, then a background job
  asks the provider's private billing API every minute for successful request costs in
  integer nano-USD. HF retries for roughly 30 minutes. Request IDs are correlated by a
  response header such as `Inference-Id`, including for streaming.
- That cost API is provider-to-HF infrastructure, not a documented customer API. The
  settings UI exposes the past month's usage by model and provider; the billing
  dashboard and invoices are also account/UI surfaces. No documented customer
  Usage/Costs API or ingestion SLA was found.
- Exact account cost therefore cannot drive pre-request or immediate post-response
  balancing. Use the route-conditioned public book before execution, returned token
  totals for an immediate list-price correction, and delayed billing data for
  reconciliation. BYOK must use the selected provider's own cost interfaces.
- There is a first-party documentation conflict for native-client `provider="auto"`:
  the overview describes fastest-provider selection, while the Python client guide
  says it selects the first provider in account preference order. Server-side suffix
  semantics are clear; native-client users should pin a provider until this is
  resolved.

## Extraction, reconciliation, and coverage

- Refresh is deterministic and non-LLM. One bounded transport fetches all 18 mapping
  registries, the official task index, and every linked task page with concurrency 6,
  retaining an observation for every dependency. The adapter requires configured
  partners in stable order and a bounded task-page set, then parses all valid routes in
  process before applying the positive admission union. Cardinality bounds are resource
  ceilings (100,000 models and 200,000 routes), not expected-count gates. Required
  envelopes plus at least one parseable recommendation and featured mapping remain
  guarded while individual rows, optional fields, and meters are best-effort.
- A second bounded transport fetches the complete unauthenticated Featherless active
  inventory plus its official model and request-pricing documentation. The API's
  embedded list pricing is a semi-structured first-party surface: official detail
  documentation guarantees billing-resolved per-token prices, while the current list
  payload supplies those same fields at refresh scale. The overlay is optional for the
  catalog but required for a fresh pricing partition. If its API or semantic guard
  fails, catalog collection can still advance and the previous compatible pricebook is
  retained rather than silently collapsing coverage.
- Every admitted concrete mapping receives a price disposition. `hf-inference`
  routes use `hf_inference_compute_price_unbound`, partner routes use
  `partner_route_price_not_published`. A valid single-partner inventory row without
  positive product evidence contributes only the aggregate reason
  `single_partner_inventory_without_product_evidence`; its model ID, routes, and
  prices are discarded. Invalid and non-identity rows are likewise aggregate
  diagnostics. A later exact router or Featherless offer can make an admitted model
  numeric without pretending that the mapping registry itself published a price.
- Every router backend also receives one disposition: published list rates are
  normalized, `is_free` is an explicit temporary promotion, live missing meters are
  retained raw and unbound, and error routes are excluded. Account
  credits, controls, BYOK, provider-side exact-cost retrieval, and dashboard history
  are classified separately.
- Featherless's complete native active inventory is still fetched so every admitted
  Featherless route can exact-join its current price when available. All native-only and
  boundary-excluded rows are discarded even if they contain valid prices. When a matched
  row's billing-resolution decimal conflicts with its numeric projection, refresh keeps
  the documented billing-resolution value and retains the other observation as
  superseded evidence; a one-meter defect does not erase its valid sibling.
- The mapping registries themselves publish no rates. Exact Featherless-native prices extend
  coverage for admitted Featherless candidates; other partner mappings remain explicitly unknown
  unless an exact first-party route price is available.

## Comparator audit

- Comparators remain audit-only. models.dev now has an hourly sync that reads the HF
  router, but it only creates new rows that can resolve to provider-agnostic metadata
  and have a price. It does not delete missing rows, deliberately treats every existing
  row as already synchronized, and flattens route pricing to the fastest backend or the
  fastest priced fallback.
- LiteLLM dynamically queries the official per-model Hub
  `inferenceProviderMapping` when an explicitly prefixed HF route is used and caches the
  result locally. That is a useful request-time lookup, not a global catalog refresh.
  Its committed task lists are broad legacy inventories rather than a current hosted catalog, and
  its price book has no direct Hugging Face provider rows.
- Portkey's audited model-data repository has no direct Hugging Face provider catalog
  or price book; HF-named artifacts occur only under other providers such as Workers
  AI. It therefore supplies no independent HF gateway rate to import.

## Catalog and consumer boundary

- Catalog membership and downstream compatibility are separate questions. Speech
  synthesis, reranking, classification, segmentation, or another published workload
  remains an ordinary Kmodels model fact regardless of whether a particular consumer
  release implements it. No Kong field or current feature appears in this boundary.
- Hugging Face Hub size and generic HTTP callability do not define this catalog. An
  ordinary repository, a `staging` mapping, a single-partner inventory row without
  positive product evidence, a dynamic tag filter without one exact identity, and a
  malformed or credential-like ID remain outside it. A current `hf-inference` live
  row is first-party hosted-service evidence rather than an uncorroborated partner
  row. Excluded rows are not retained as hidden history, routes, source references,
  prices, or raw fallbacks.
- Price availability also does not define membership. An admitted official live route
  may remain unknown-priced, while a provider-native priced model with no admitted HF
  candidate remains outside this catalog. Presence and commercial coverage refresh
  independently; HF-operated live serving, provider corroboration, and bounded
  official task features establish productization, while popularity, task family,
  and pricing coverage do not.
- A downstream cost calculation should retain canonical model ID, selected route
  provider, routing policy, bill-to target, BYOK versus HF-routed billing,
  input/output usage, and request ID. Unknown or mismatched task/endpoint
  combinations remain unclassified.
