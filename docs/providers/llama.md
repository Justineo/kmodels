# Meta Llama

Status: current

## Sources and identity

- The exhaustive public catalog statically parses Meta's official
  [`llama-models`](https://github.com/meta-llama/llama-models) registry used by
  `llama-model list --show-all`; never import or execute remote Python.
- Every core ID must have one descriptor. The exact CLI descriptor, including
  variants, is `model_id`; the exact Hugging Face repository is an alias. Never
  slugify.
- Parse the complete `CoreModelId` → `ModelFamily` mapping and the closed numeric
  forms used by `Model.max_seq_length`. Unknown expressions, incomplete family
  classification, or descriptors without a context rule fail closed.
- The README launch table, exact model cards, and official Meta release announcements
  establish release dates. Model-specific dates win when a family table and card
  differ; repository commits are not model update dates.
- The official [`llama-api-python`](https://github.com/meta-llama/llama-api-python)
  SDK establishes the first-party API origin, exact relative resources, request and
  response schemas, and model IDs shown in reviewed examples. It is not a public
  hosted-model catalog or price book.
- The generated Models resource is part of the reviewed contract: its unpaginated
  `GET /models` method unwraps one top-level `data` array whose items contain exactly
  `id`, `created`, `object: "model"`, and `owned_by`. The collector validates the
  resource, model type, and list type before trusting the optional runtime response;
  a new page parameter, cursor/container, or item field is a review signal rather
  than silently discarded JSON.
- Optional `/v1/models` is account-scoped and non-creating. API `created` is not an
  artifact release date, and absence from one account does not retire a global model.
  Enable it with `LLAMA_API_KEY`.

## Mapping

- Generative weights are text generation, Llama Guard is moderation, and Prompt
  Guard is classification.
- Until the commercial-topology migration, downloadable-only weights retain the flat
  `not_applicable` pricing projection. The audited target separates Meta artifact
  distribution from self-hosted execution: exact royalty-free access is not free
  inference, and operator or deployment-provider compute is `externally_billed` rather
  than copied into the Meta Llama price book.
- A Meta-hosted API identity with no current public amount is `not_published`, never
  free or not applicable. The dated 2025 launch statement that Llama API was a
  “limited free preview” does not establish an indefinitely current zero rate.
- Registry presence is active artifact evidence, including entries shown only by
  `--show-all`; it is not release-stage or deprecation evidence.
- Hosted aliases, routes, streaming, tool use, structured output, and multimodality
  apply only to the exact identity or release family supported by official evidence.
  Never copy them to siblings.
- The current SDK examples prove two exact Chat identities:
  `Llama-3.3-70B-Instruct` and
  `Llama-4-Maverick-17B-128E-Instruct-FP8`. The former is an API alias of registry
  descriptor `Llama3.3-70B-Instruct`; the asynchronous example proves streaming but
  not structured output or tools for that identity. The Llama Guard 4 announcement
  and generated Moderations route separately prove `Llama-Guard-4-12B` as the exact
  hosted moderation identity. No sibling is promoted merely because a comparator or
  private account might list it.
- Cerebras- and Groq-powered Llama API names are partner routes. The launch
  announcement establishes their experimental existence, but not exact public IDs,
  availability, or a transferable rate. Their standalone provider prices belong to
  the Cerebras/Groq commercial surfaces.

## Commercial topology audit

Design status: audited; implementation pending. This is Meta Llama's disposition for
the provider-wide commercial-topology review. It describes the intended resources,
books, offers, relationships, meters, and evidence boundaries; it does not claim that
the current collector, schema, generated data, or UI already represents them.

### Public commercial source graph

| Surface                                                                                                                                                                                                                               | Exact authority and completeness boundary                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Official [`llama-models`](https://github.com/meta-llama/llama-models) registry, README, exact model cards, family licenses, and Acceptable Use Policies                                                                               | Artifact identities, variants, download routes, release metadata, local inference examples, exact family license grant, attribution, eligibility, and use restrictions. Registry presence is exhaustive only for reviewed Meta-distributed artifacts; it does not establish a hosted route, current API inventory, or inference price. |
| Official Python and TypeScript Llama API SDKs, generated `api.md`, resources, types, and examples                                                                                                                                     | Public REST origin, exact Chat/Models/Uploads/Moderations resources, request and response contracts, and exact example IDs. The SDKs expose neither a price book nor Usage, Costs, Billing, fine-tuning-job, or evaluation-job resources; an upload purpose is not a job API or a commercial amount.                                   |
| Optional authenticated `GET /v1/models`                                                                                                                                                                                               | Exact model IDs callable for one account at one observation. The current unpaginated `data` list is account inventory only; `created` is service metadata, absence is not global retirement, and an account-only or custom ID cannot create a public artifact row.                                                                     |
| Meta's dated [LlamaCon launch announcement](https://ai.meta.com/blog/llamacon-llama-news/)                                                                                                                                            | The April 29, 2025 limited-free-preview state, named Llama 4 preview models, custom-model/fine-tuning/evaluation preview, Cerebras/Groq experimental routing, and the claim that routed usage is tracked in one location. It publishes no current validity end, numeric rate, allowance, invoice rule, or billing API.                 |
| Meta release announcements for [Llama 3](https://ai.meta.com/blog/meta-llama-3/), [Llama 3.1](https://ai.meta.com/blog/meta-llama-3-1/), and [Llama 3.2](https://ai.meta.com/blog/llama-3-2-connect-2024-vision-edge-mobile-devices/) | Dated availability, partner distribution/deployment, on-device and local execution, and Llama Stack integration claims. A partner mention proves an ecosystem route only at the stated date; it cannot establish the partner's current inventory, seller, amount, or settlement.                                                       |
| Llama Stack, Cookbook, local inference, fine-tuning, and deployment repositories                                                                                                                                                      | Runnable local/provider integrations and developer-operated customization paths. They prove that external execution is intended, not that Meta operates the runtime or pays its GPU, storage, network, or support cost.                                                                                                                |
| Meta AI consumer experiences and the July 2026 [Meta Model API / Muse Spark announcement](https://ai.meta.com/blog/introducing-muse-spark-meta-model-api/)                                                                            | Separate application and closed-model API resources. Meta AI being free to a consumer and Meta Model API launch credits or Muse rates never apply to Llama artifacts or the Llama API.                                                                                                                                                 |

Comparator catalogs are audit-only. LiteLLM, models.dev, gateway catalogs, Hugging
Face community metadata, and cloud marketplaces may expose a missing first-party
claim, but cannot create a Meta identity, convert a partner rate into a Meta rate, or
resolve a Llama API amount.

### Books, resources, and offer boundaries

- Every admitted artifact keeps an exact distribution resource with its registry ID,
  approved Meta and Hugging Face download routes, model-family license, and use-policy
  applicability. For a family whose first-party terms explicitly grant royalty-free or
  free access, the distribution offer may be `free` only for artifact/license
  acquisition. It must render as “artifact access,” never as zero-cost inference.
- Artifact access and self-hosted inference are different mechanisms. The self-hosted
  offer is `externally_billed`: the operator chooses and pays hardware, energy,
  storage, networking, deployment software, and operations. Local token counts can
  measure work, but Meta publishes no operator cost conversion. The current flat
  `not_applicable` model price is therefore not the target disposition for a documented
  self-host route.
- License conditions are not price terms. License acceptance, attribution, use-policy
  compliance, the release-date-specific 700-million-MAU threshold, and the EU
  multimodal developer restriction are applicability or enrollment facts attached to
  the exact family. An organization above the threshold must obtain a separate Meta
  grant whose amount is `not_published`; “request a license” does not establish a
  `custom_quote` price or permission before Meta grants it.
- Meta-hosted Llama API Chat is one synchronous usage offer for each exact hosted ID.
  Streaming, structured output, image input, and function calling are delivery or
  request behavior of that offer unless first-party price evidence later separates
  them. Current public amount is `not_published`, not free, because the only zero-price
  language is a dated limited preview without a current validity boundary.
- Llama API Moderations is a distinct hosted inference mechanism because it has a
  different route, response contract, model role, and accounting visibility. The
  exact hosted Llama Guard identity receives a `not_published` offer; the existence of
  an artifact sibling or safety recommendation does not project a moderation offer to
  every Guard or Prompt Guard model.
- The Chat API supports only caller-defined `function` tools in the reviewed contract.
  The model emits arguments, the caller executes the function, and the caller submits
  a tool-result message in another model request. There is no Meta provider-tool
  service, generic tool-call surcharge, or charge signal for the external function.
  Structured output likewise creates no independent offer.
- Uploads are account resources with accepted bytes, MIME type, purpose, offset, and
  optional completed file ID. `attachment`, `messages_finetune`, `messages_eval`, and
  other purpose labels prove intended resource use but not retained storage duration,
  a fine-tuning/evaluation job, a billable byte meter, or a free allowance. Keep the
  resource out of model pricing until a commercial mechanism is published.
- The 2025 announcement proves a limited-preview custom-model service for select
  customers, but the reviewed SDK has no current fine-tuning or evaluation job
  resource and Meta publishes no amount, trained-token counter, minimum, storage rate,
  or derived-model inference rule. Preserve that atom as dated private-preview
  evidence. Its “Llama 3.3 8B” tuning template cannot create a global artifact row when
  the registry does not publish the same identity.
- Developer-operated fine-tuning of downloaded weights is part of the external
  execution route. Training compute and later serving remain operator- or
  deployment-provider-billed. A resulting derivative or account-created ID is not a
  Meta global catalog identity merely because the license permits customization.
- Cerebras- and Groq-powered Llama API access is a partner-backed inference route, not
  a portable price attribute of Llama 4. The announcement gives no exhaustive current
  IDs, seller, amount, or settlement rule, so the public topology retains bounded
  experimental route evidence without projecting an offer. If an authenticated
  account later exposes an exact route, it remains account-scoped and
  `not_published`; standalone Cerebras/Groq prices stay in their provider books.
- Llama Stack distributions and named AWS, Azure, Databricks, Google Cloud, Groq,
  Cerebras, NVIDIA, and other integrations prove deployment portability. Meta does not
  own those managed inference, capacity, marketplace, or invoice offers. Preserve
  exact route compatibility, while each seller's first-party catalog and price book
  own its IDs, rates, regions, lifecycle, and settlement.
- Meta AI applications are not API offers. Muse Spark and Meta Model API form a
  separate closed-model provider surface with their own public-preview credits and
  services. Shared corporate ownership, OpenAI compatibility, or a Meta domain does
  not compose those commercial facts with Llama.

### Commercial relationships

| Source offer or resource                   | Relation               | Target and scope                                               | Cost consequence                                                                                                                                                   |
| ------------------------------------------ | ---------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Exact royalty-free artifact distribution   | `compatible_with`      | Exact self-hosted execution route                              | Artifact acquisition can be free while all execution cost is external. Compatibility does not waive license applicability or auto-select a runtime.                |
| Self-hosted execution                      | `exclusive_with`       | Meta-hosted or partner-hosted execution for the same work item | One realized inference uses one execution/settlement route; never add local GPU cost to a hosted token charge for the same request.                                |
| Meta-hosted Chat                           | `exclusive_with`       | Partner-backed Llama API route for the same work item          | The selected route is one inference mechanism. Experimental partner routing is not an additive acceleration service.                                               |
| Client-defined function calling            | no commercial relation | Caller-executed function and Meta-hosted Chat                  | Function schemas and returned tool content may increase model work, but external execution has no Meta tool-call fee and stays outside the Meta price book.        |
| Structured output and streaming            | no commercial relation | Exact eligible Chat offer                                      | These are request/delivery modes. No reviewed source publishes an amount change or separate charge.                                                                |
| Upload/file resource                       | bounded raw            | Exact attachment, evaluation, or fine-tuning workflow          | File creation and bytes do not become charged storage or a free inclusion. No offer edge is emitted until the dependent commercial workflow is publicly stable.    |
| Llama API custom-model preview             | bounded raw            | Select-customer preview template and account-derived models    | The launch proves a dated service relationship but no current acquisition, rate, storage, inference, or settlement rule.                                           |
| Llama Guard/Prompt Guard self-host route   | bounded raw            | Generative Llama system with exact safety integration evidence | A safety model may run alongside generation and incur separate external compute. A general recommendation is insufficient to auto-select or sum every Guard model. |
| Family license acceptance and restrictions | no offer relation      | Artifact distribution and downstream use                       | These are eligibility/applicability constraints, not a pseudo-priced prerequisite. The 700M-MAU grant remains account-specific and amount-unpublished.             |

Do not encode a generic `tool_call`, “Llama Stack,” or “partner hosting” offer.
Those labels respectively collapse caller execution, deployment middleware, and
commercial surfaces owned by different sellers.

### Meters, charge signals, and resolution phase

| Commercial atom                       | Published denominator                | Strongest first-party quantity evidence                                                                                                                             | Resolution phase      |
| ------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Artifact/license acquisition          | No recurring usage denominator       | Approved download plus exact family license; one download or signed-URL refresh is not a published charge counter                                                   | Publication / account |
| Self-hosted inference                 | Operator-defined                     | Local tokenizer/runtime telemetry; Meta publishes no price or canonical infrastructure-to-token conversion                                                          | Outcome / account     |
| Meta-hosted Chat input                | No current public priced denominator | Optional open `{metric, value, unit}` response entries; metric names and units are not enumerated, so no canonical input-token charge signal can be bound           | Outcome               |
| Meta-hosted Chat output               | No current public priced denominator | The same generic metrics object; `max_completion_tokens` is a request limit, not realized or billed output                                                          | Outcome               |
| Chat streaming                        | Same unresolved Chat work            | `metrics` events use the same unconstrained metric shape; event replay or chunk count is not billable usage                                                         | Outcome               |
| Caller-defined function execution     | None                                 | Tool-call delta/message identifies requested external work but Meta publishes no function-call price or execution counter                                           | Outcome / account     |
| Hosted Moderations                    | No current public priced denominator | Response returns model and result categories but no usage object; accepted request, text length, and locally estimated tokens are not documented invoice quantities | Outcome / account     |
| Uploads                               | No published commercial denominator  | Declared bytes, uploaded offset, and file ID are resource state only; no byte, byte-hour, file, or retention charge is published                                    | Request / outcome     |
| Hosted fine-tuning/evaluation preview | Unpublished                          | Upload purposes and the dated launch announcement; no job resource, trained/evaluated quantity, completion counter, or amount                                       | Account               |
| Partner/cloud execution               | Seller-specific                      | Exact partner response or billing telemetry belongs to that seller's provider surface                                                                               | Outcome / account     |

No current Meta-hosted amount means these unresolved denominators do not become
placeholder rates. If a future first-party price book publishes token, request, job,
or storage units, a binding still requires an exact stable API/account counter with a
dimensionally matching unit. Local tokenizer estimates can support planning but never
masquerade as Meta invoice quantities.

### Requested, realized, allowance, enrollment, and settlement facts

- Request facts include exact model ID, route, messages and image content,
  `max_completion_tokens`, streaming, response format, tool declarations and choice,
  and moderation input. The native contract publishes no cache, Batch, service-tier,
  priority, or hosted-backend selector that can safely become a price variant.
- Realized Chat facts include response ID, stop reason, text or emitted function call,
  and generic metrics observed at runtime. A tool workflow normally contains at least
  two independently realized Chat calls around caller execution; each model response
  retains its own usage evidence rather than converting the function event into one
  surcharge.
- Runtime metric names and units are account observations. A reviewed adapter may bind
  an exact name only after Meta documents stable semantics or account billing confirms
  it; unknown names remain raw. The current open-string schema cannot promise
  input/output, cached/reasoning, or billable-versus-total partitions.
- The announcement's “limited free preview” is a publication-time promotion with no
  public end date or numeric grant. It is not a current allowance, calculator selector,
  or evidence that every hosted call settles to zero. The current public offer remains
  `not_published` until a current first-party source states otherwise.
- API-key issuance, preview admission, experimental partner access, custom-model
  eligibility, family-license acceptance, the 700M-MAU threshold, and the EU
  multimodal restriction are independent enrollment/applicability facts. None changes
  artifact or API model lifecycle.
- Rate limits and API 429 responses are access controls, not price or quota allowance.
  The public contract does not state whether failed, canceled, retried, moderated, or
  partially streamed work is billed, so no such event is assumed charged or free.
- The SDK exposes no public Costs, Usage, Billing, credit-balance, or invoice resource.
  “Usage tracked in one location” proves a portal aggregation experience only. Account
  contracts, balances, partner invoices, taxes, refunds, and negotiated terms can
  reconcile settlement outside the static public catalog but never become global
  list prices.

### Commercial-atom disposition ledger

| Reviewed atom class                                                        | Design disposition                                                                                                                                                         |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact registry artifact and approved Meta/Hugging Face download route      | Normalize as distribution resources. Add a free acquisition offer only where the exact family terms explicitly prove royalty-free/free access; never label inference free. |
| Family license, attribution, acceptable-use policy, and derivative rights  | Normalize as exact-family distribution applicability and evidence. Do not flatten one generation's terms onto another.                                                     |
| 700-million-MAU separate-license threshold                                 | Preserve exact release-date/account eligibility and `not_published` separate-grant state. It is not a token rate, quote, or model lifecycle field.                         |
| EU multimodal developer restriction for Llama 3.2 and Llama 4              | Normalize as exact-family, exact-modality applicability exclusion with the stated end-user exception; do not retire the models or generalize it to text-only families.     |
| Local/on-device/private execution                                          | Normalize as self-host routes with `externally_billed` cost. Preserve exact artifact compatibility and no Meta rate.                                                       |
| Llama API exact Chat examples and current SDK route                        | Normalize exact hosted identities and `not_published` synchronous offers. Examples establish only their named models and behaviors.                                        |
| Llama API exact Moderations route and Llama Guard 4 identity               | Normalize one route-qualified `not_published` moderation offer; do not project to all safety artifacts.                                                                    |
| 2025 limited-free-preview statement                                        | Preserve as dated promotion evidence, not current free price or allowance.                                                                                                 |
| Function calling, streaming, structured output, and image input            | Normalize exact capability/route facts only. No separate offer, amount, or generic tool-call meter.                                                                        |
| Upload routes, byte/offset fields, and purpose labels                      | Normalize account resource facts; retain commercial amount and storage/retention semantics as unknown, not free.                                                           |
| Preview custom-model, fine-tuning, evaluation, and “Llama 3.3 8B” template | Preserve bounded dated private-preview service evidence. No current public job offer, rate, usage signal, or global model row.                                             |
| Cerebras/Groq experimental Llama API routing                               | Preserve bounded partner-route evidence. Exact account routes remain account-scoped and `not_published`; never import standalone partner rates.                            |
| Cloud, hardware, Llama Stack, and deployment partners                      | Normalize exact distribution/deployment compatibility only. Each provider owns its hosted/capacity amount, route lifecycle, and settlement.                                |
| Generic Chat metrics and absent Moderations metrics                        | Preserve response/account observations. Bind no public charge signal until exact names, units, aggregation, and billing semantics are stable.                              |
| Meta AI consumer application                                               | Exclude from the Llama API price book and catalog route graph. A free consumer experience is not a developer API price.                                                    |
| Meta Model API, Muse models, launch credits, and built-in services         | Exclude from this provider surface. Audit them as a separate Meta closed-model/API provider if admitted later.                                                             |

### Authority, conflicts, and claim-local refresh

Authority is fact-local:

1. `llama-models` constructors and exact registry descriptors own artifact identity;
   exact model cards own release-family capability and release metadata.
2. Each family's license and Acceptable Use Policy own only that family's grant,
   restrictions, attribution, and eligibility. A newer Llama 4 clause cannot rewrite
   Llama 3.1, a safety artifact, or an API contract.
3. Generated SDK resources and types own public Llama API paths and request/response
   shape. Exact reviewed examples own only their named hosted identity and behavior.
4. Authenticated `/v1/models` owns callable inventory for that account and observation.
   It neither creates a global artifact nor retires a registry model.
5. Dated Meta announcements own launch-time preview, partner, and program facts. Their
   wording cannot establish indefinite price validity or a current callable inventory.
6. A deployment partner's first-party model catalog, price book, usage API, and invoice
   own that partner route. Meta ecosystem prose cannot substitute for them.

The main apparent conflicts are separate claims:

- “limited free preview” in 2025 and a still-authenticated API endpoint in 2026 do not
  conflict. The first is a dated promotion; the second proves endpoint existence.
  Without a current amount or validity statement, hosted price is `not_published`.
- “royalty-free” weights and nonzero self-host costs do not conflict. One is artifact
  licensing; the other is external execution economics.
- Registry presence, including `--show-all`, proves artifact availability, not Llama
  API lifecycle. Conversely, account `/models` presence proves one hosted route, not a
  new global artifact or release date.
- The preview announcement's custom “Llama 3.3 8B” wording and the registry's global
  artifact set describe different resource scopes. Keep the preview template bounded
  rather than inventing an artifact identity or rewriting Llama 3.3 70B.
- Meta AI, Llama API, partner-hosted Llama, and Meta Model API are distinct routes and
  commercial surfaces even when they share models, compatibility style, or corporate
  ownership.

Refresh remains deterministic and claim-local:

- Fetch the artifact registry, family cards, family licenses/use policies, each SDK
  contract partition, dated announcements, and optional account inventory
  independently. One unavailable partner or commercial document cannot erase fresh
  artifact identity.
- A malformed family license blocks only that family's refreshed license/applicability
  claims; it does not reject sibling families. A drifted Chat metric schema blocks the
  corresponding accounting binding, not Models inventory or artifact rows.
- Additive SDK resources, metric labels, upload purposes, model fields, and partner
  routes become diagnostics or bounded raw facts until reviewed. They do not cause
  recognized siblings to disappear or acquire guessed prices.
- Fresh absence removes a claim only from a source exhaustive for that exact scope.
  Account absence cannot remove a global row; registry absence can remove an artifact
  route but not independently prove retirement of a separately observed hosted route.
- A future first-party Llama API price page, Costs/Usage/Billing resource, or stable
  token metric is collected as a new commercial/accounting partition. Its failure can
  leave a retained prior claim visibly stale without suppressing current inventory.
- No LLM, comparator catalog, fuzzy family rule, or majority vote participates in
  refresh, matching, conflict resolution, or retention.

### Model-detail composition and cost coverage

- An artifact-only model detail shows exact distribution/license state and a separate
  externally billed self-host mechanism. It does not display a generic “free model” or
  a zero token price.
- An exact Llama API Chat or Moderations identity additionally shows the hosted
  `not_published` mechanism. Hosted, self-hosted, and exact partner-backed mechanisms
  are alternatives for one work item, not summed components.
- Function calling and structured output remain capabilities within Chat. The UI does
  not render a tool surcharge; it may explain that caller execution is external and
  subsequent model turns can add independently measured model work.
- License and enrollment restrictions render as precise notes on the affected artifact
  or route. They are not calculator switches, amounts, deprecation badges, or reasons
  to hide an otherwise valid catalog row.
- Public-price coverage is unavailable for current Meta-hosted inference and external
  for self-hosting. Post-request charge coverage remains unavailable until exact metric
  names/units and a public rate exist; Moderations has no request-level usage counter.
  These gaps make cost coverage partial or unavailable without rejecting the model.
- An operator may configure an account price, allowance, or infrastructure cost model
  outside the public catalog. Such configuration can support routing and reconciliation
  locally but never rewrites Meta's first-party public observations.

## Public estimate and account-exact cost

- Meta publishes no current numeric first-party Llama API price book. Public sources
  therefore cannot calculate a current hosted request cost. The only public
  commercial statement found is the April 29, 2025
  [limited free preview announcement](https://ai.meta.com/blog/llamacon-llama-news/),
  which has no current validity boundary or exact per-model rate table.
- The official SDK currently exposes Chat, Models, Uploads, and Moderations resources;
  it exposes no programmatic Usage, Costs, or Billing resource. The launch page says
  usage is tracked in one location, but does not publish a billing-data API or
  freshness SLA.
- The public Python SDK's latest release remains 0.6.0 from December 18, 2025. Its generated
  contract is still the strongest anonymously refreshable API source: the old
  documentation URLs now redirect to a login-gated Meta developer surface, while an
  anonymous live request to `/v1/models` still reaches the service and returns 401.
  This proves endpoint existence, not inventory or commercial availability.
- Account access, preview entitlement, experimental partner access, custom-model
  availability, and any later private commercial terms are account-level facts. A
  gateway must take them from account configuration or the Meta portal/contract, not
  infer them from the artifact registry.
- Llama 4 weights are distributed under a royalty-free limited license, but the
  [community license](https://github.com/meta-llama/llama-models/blob/main/models/llama4/LICENSE)
  requires organizations above its 700-million-MAU threshold to request a separate
  Meta license. That is a commercial eligibility boundary, not a token rate.
- Self-hosted cost is GPU/capacity/energy/operations cost. Bedrock, Azure, Databricks,
  Cloudflare, Groq, Cerebras, and other hosted Llama offers must use their own
  first-party price books and account billing APIs.

## Request, response, and freshness

- The native Chat request names the model and may set `max_completion_tokens`; prompt
  content, image inputs, generated length, and tool iterations determine realized
  work. There is no documented cache or service-tier selector in the current native
  request schema.
- Non-streaming Chat returns an optional list of generic `{metric, value, unit}`
  values. Streaming emits the same open metric shape in `metrics` events. Metric names
  and units are unconstrained strings: the public schema does not guarantee separate
  billed input/output token fields or a cache-hit breakdown.
- Moderation responses contain the selected model and results but no documented
  metrics object. A gateway can count requests and, for known tokenizer artifacts,
  estimate tokens itself, but it cannot treat those estimates as Meta invoice units.
- Because no public current rate or cost endpoint exists, Meta Llama API cannot
  participate safely in public-price cost-based load balancing. An operator may route
  it using an explicitly configured account price/allowance; post-response generic
  metrics can refine usage only after their runtime names and units are validated.

## Extraction and reconciliation

- Refresh is deterministic and non-LLM. Python constructors and enums own artifact
  identity and limits; exact SDK resources own routes and accounting schemas; dated
  Meta announcements and repository licenses own commercial boundary evidence.
- The SDK list resource and response types are fetched atomically with the artifact
  registry. Runtime JSON uses strict schemas, so additive pagination or metadata does
  not become an accidental partial parse. The generated list contract is intentionally
  unpaginated today; if Meta adds pagination, refresh stops for review instead of
  publishing only the first page.
- Every catalog identity receives an explicit pricing disposition. The dated free
  preview and artifact license are reconciled as out-of-scope historical/eligibility
  terms rather than silently converted into current model rates.
- A newly generated SDK Billing/Costs/Usage resource is surfaced as an unsupported
  pricing diagnostic instead of failing the artifact catalog. Structural drift in an
  already reviewed request/response contract still fails closed because existing
  gateway accounting assumptions would no longer be proven.
- LiteLLM and models.dev keep native Meta rows manually; their automated updates use routed catalogs
  rather than Meta's SDK registry. Portkey's Llama prices belong to hosting providers, not the model
  publisher. Hugging Face namespace contents are useful drift evidence but cannot add or rewrite a
  Meta identity. None is imported as production model or price evidence.
- Meta's July 2026
  [Meta Model API/Muse Spark announcement](https://ai.meta.com/blog/introducing-muse-spark-meta-model-api/)
  is a separate closed-model
  surface. Its public-preview credits and Muse terms do not apply to Llama API or Llama
  artifacts and remain outside this provider.
