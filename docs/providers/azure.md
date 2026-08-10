# Microsoft Foundry

Status: current

## Sources and identity

- The non-exhaustive regional catalog is one atomic bundle of reviewed MicrosoftDocs catalogs, current and retired lifecycle tables, region matrices, and fixed stable and preview Azure OpenAI v1 specifications.
- IDs come only from labeled model cells. Identity is exact `model.name` plus optional `model.version`; never slugify or guess a version.
- Keep internal provider ID `azure`. Join versioned, versionless, and case-only evidence only when exact or unambiguous. Keep ambiguous versionless rows separate.
- Preserve exact, multi-valued service families: Azure OpenAI, Foundry Models sold by Azure, and partner/community models.
- Do not duplicate these rows into an `azure-openai` provider without a separate authoritative standalone catalog.
- Supplement the documentation bundle from the anonymous first-party Foundry Explorer request used
  by `ai.azure.com`. The reviewed request searches 11 core registries for non-anonymous,
  non-archived, latest `Versioned` model entities whose deployment options contain
  `UnifiedEndpointMaaS`. Follow its opaque continuation token with 50-row pages, require a stable
  declared total of 50–150, reject every partial-registry or shard error, and cap the request at five
  pages/250 rows. This embedded endpoint is official but undocumented, so its request grammar,
  response contract, and fixed portal user-agent headers are explicit failure-closed source
  boundaries. The larger Explorer registry list currently mixes production publishers with dev,
  staging, preview, and private registries and is not copied wholesale into the public catalog.
- Collect current USD consumption rates from the public, unauthenticated Azure Retail Prices API.
  Query the complete `Foundry Models` Consumption inventory and follow pagination; do not maintain a
  product-name allowlist. New Microsoft and Marketplace product families must therefore reach the
  extractor automatically. The inventory covers public Foundry meters across regions and SKUs; it
  does not establish negotiated discounts or subscription-specific availability.
- Collect Microsoft's public Azure OpenAI and Foundry model-family pricing pages as a second
  unauthenticated first-party price book. The Microsoft family page is the bounded discovery index:
  follow 9–20 same-host `/pricing/details/ai-foundry-models/<family>/` links, exclude the AOAI
  indirection and fine-tuning-only page from the **base-model** parser, and fetch the Azure OpenAI
  page as a fixed companion. Model Router remains a real model-family page, although its input rate
  is a router markup rather than the complete routed inference cost. This makes a newly published
  family reach the extractor without a manifest edit while a removed index, path change, or
  implausible family count fails closed. Read the embedded regional decimal maps rather than the
  client-rendered `$-` placeholders. This source is the production fallback for model IDs and
  version groups that the Retail SKU vocabulary cannot bind. The audited target below admits the
  fine-tuning, shared managed-compute, router, and built-in-tool sections through separate commercial
  grammars instead of either discarding them or flattening them into base inference.
- Collect Claude-in-Foundry rates from Anthropic's official pricing page. Its dedicated Microsoft
  Foundry section says Azure Marketplace CCU conversion uses the same public per-model and
  per-feature rates, with the same 1.1x US Data Zone multiplier. This is a delegated first-party
  price book, not a third-party registry. Keep Azure Marketplace private-offer discounts as raw
  account-specific uncertainty.
- Keep fixed Microsoft commercial-policy companions for Foundry cost attribution, Azure OpenAI
  prompt-cache accounting, Claude CCU billing, and Cost Management freshness. They are drift guards
  for what the numeric books can and cannot establish; they do not create prices by themselves.
- Enable optional ARM inventory with `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`,
  `AZURE_CLIENT_SECRET`, and `AZURE_SUBSCRIPTION_ID`. The transport discovers the subscription's
  canonical regions and intersects them with the locations advertised for Cognitive Services
  accounts; `Global` is not a Models API location. It then collects every discovered regional
  Models inventory with bounded concurrency. Missing credentials must not suppress public retail
  pricing.
- Foundry MCP is preview comparison evidence only. Its catalog/details tools may audit model,
  region, and price coverage, but their changing tool contract and user/project authorization do
  not make them a production collector or a fallback price source.
- The Azure Marketplace Catalog Discovery APIs are also official and expose products, plans,
  availability, meters, and prices, but the data-plane APIs require a separately issued
  `X-API-Key` and the ARM variant is tenant scoped. They are useful candidates for a future optional
  overlay after a credentialed response can be reviewed; they are not a hidden unauthenticated
  fallback and must not be guessed into the current public book.
- Microsoft's “11,000+ models” catalog statement includes managed-compute/open-weight discovery and
  is not the denominator for serverless pay-as-you-go models. The anonymous portal search currently
  reports 11,219 latest model entities before the `UnifiedEndpointMaaS` filter but only 95 in the
  reviewed serverless subset. The embedded API is neither documented nor a billing-identity API;
  it cannot make the broad portal total a pricing denominator. Keep the public serverless catalog
  explicitly non-exhaustive and use the authenticated Location Models API for a subscription's
  actual regional inventory.

## Mapping

- Tasks are non-exclusive and stay bound to the observed model/version.
- Attach Azure OpenAI endpoints only from Azure OpenAI catalog evidence or its exact batch matrix, validated against fixed operation/path specifications.
- Other Foundry rows do not inherit Azure OpenAI endpoints from a task or type.
- Keep exact `{region, deployment_type}` pairs, lifecycle versions, and replacements. The retired-model archive may mark an existing public tuple retired but never recreates an archive-only catalog row.
- Keep maturity separate from availability: Preview maps to `active` + `preview`, and GA maps to `active` + `stable`. Customer-facing Legacy and Deprecated map to canonical `legacy` and `deprecated`; customer-facing Retired maps to canonical `retired`.
- Portal identity comes only from the last-colon split of exact `properties.id` (`model:version`),
  cross-checked against `properties.name`. Do not use the numeric artifact `properties.version` or
  substitute `azureOpenAIVersion`: the live portal has two speech rows where that subsidiary value
  names an older Azure OpenAI version. A portal row may enrich an exact documentation tuple. It may
  create a newer version only when the base model already exists and the exact or sibling versioned
  documentation tuples establish one service family. A wholly new base ID or a family conflict is
  excluded, so the broad portal cannot silently widen reviewed provider scope.
- For an existing documented tuple, the undocumented portal is fill-only: it adds missing limits
  and other declared facts but cannot replace a known public or authenticated scalar. A portal-only
  newer tuple still retains its own complete portal facts. This prevents a portal deployment
  default such as a 4,096-token output setting from replacing a documented 128,000-token model
  limit.
- The documented lifecycle remains authoritative for an exact tuple; the undocumented portal never
  reactivates or retires it. For a portal-only newer version, use the portal's lifecycle and exact
  effective legacy/deprecation/retirement dates, plus its tasks, modalities, declared capabilities,
  token limits, and exact deployment-SKU locations. Unknown inference-task values fail closed rather
  than being forced into the nearest task.
- The Models API uses different lifecycle words: `Deprecating` means canonical `deprecated`, while API `Deprecated` means canonical `retired`. Its `deprecation.inference` value is the inference retirement date, not `deprecated_at`; once that exact date is effective, canonical status is `retired` even if a lifecycle label or public schedule row lags.
- Merge repeated ARM identities before applying the subscription-scoped inventory. Tasks,
  modalities, prices, and exact `{region, deployment_type}` pairs are additive. A scalar observed in
  only one region may fill an unknown, but conflicting descriptions, limits, lifecycle stages, or
  capabilities collapse to unknown instead of letting region order choose a global value.
- A positive row in the current Assistants availability matrix establishes active support for that exact tuple. The retired-model archive takes precedence when the overview still carries a stale availability column.
- Retail SKU parsing is a reviewed fallback grammar, not fuzzy matching. Azure OpenAI product
  families bind only to Azure OpenAI catalog rows. Reviewed partner and sold-by-Azure product
  families first constrain publisher/family scope and then match normalized ordered SKU tokens
  against current IDs, names, and documented aliases, with a small shared abbreviation, release
  suffix, and qualifier vocabulary. Pricing evidence never creates catalog rows.
- Normalize token, request/search, page, image, megapixel, time, and capacity units only when both
  the retail unit and a unique task/meter interpretation agree. In particular, Cohere rerank search
  units, document/OCR pages, and FLUX megapixels retain their provider-native denominator.
- Bind a retail row only to an exact catalog version, an existing versionless tuple, or the sole public version of a model. A versionless SKU shared by several versions remains unmodeled. When a SKU omits a meter dimension, a unique task-to-meter relation may supply it; text generation never guesses input versus output.
- Bind Microsoft pricing-page rows at the identity granularity Microsoft publishes. A row that
  prints a version binds only that exact tuple. A row that prints only a base model ID creates one
  shared base-model fallback book whose scope is every matching non-retired catalog tuple without
  exact numeric evidence; it does not manufacture a version-specific claim. A small reviewed alias
  map covers only documented page omissions or spelling differences such as Llama's omitted
  `Instruct` suffix. All other non-unique labels remain unbound.
- A newly discovered family slug is not an identity hint. Until its product-family vocabulary is
  reviewed, its rows search only non-Azure-OpenAI catalog tuples and must still produce one best
  ordered-token identity; an ambiguous label remains unbound and pricing never creates a model.
- Treat the page book as a fallback, not a competing duplicate. If an exact tuple already has a
  numeric Retail, delegated, or direct-meter book, remove it from the page book's scope. Keep the
  remaining shared base-model scope separate from exact books so an exact Retail observation cannot
  accidentally widen to sibling versions.
- Every returned Consumption row receives one reconciliation disposition. The current base parser
  deliberately excludes fine-tuning, provisioned throughput, managed compute, Foundry Local,
  built-in tools, and free-meter rows; base rows are normalized, unbound, ambiguous, or unsupported.
  The audited target below gives those non-base atoms their own books, allowances, settlement facts,
  or explicit exclusions instead of treating the base-parser exclusion as their final disposition.
  Interpretation is complete only when every row receives one reviewed classification. A separate
  70% minimum over model-base rows requires a unique binding and normalized rate, while the
  reconciliation report preserves the exact unresolved denominator. This prevents an unmatched or
  versionless SKU from being guessed and prevents a plausible output-model count from hiding
  input-row loss.
- Preserve the retail region, deployment class, service tier, context tier, native unit, and effective-start label. The Retail Prices endpoint establishes that returned consumption rows are the current snapshot, so its effective-start label is retained as raw evidence rather than treated as a historical-only validity constraint.
- When one exact SKU family contains an unequal explicit long-context row, its otherwise identical unqualified row is the standard context tier. This reviewed pair rule does not apply to ambiguous or unmatched retail rows.
- Optional ARM inventory is subscription scoped and spans every Cognitive Services account region
  advertised to that subscription at observation time. It may enrich exact model tuples, preserves
  every observed `{region, deployment_type}` pair, and provides the strongest meter-ID join for that
  subscription, but it cannot define the global catalog or the complete public price book. Regional
  responses are one failure-closed source bundle: a failed or structurally inconsistent location
  retains the previous accepted inventory instead of publishing a partial current availability map.

## ARM meter binding

- Keep model identity, billing identity, and price observations separate. An ARM/Retail join applies
  to the exact model/version, region, and deployment SKU it observes. ARM SKU names and Retail
  `meterId` values are rate evidence and never become model IDs.
- Normalize both ARM wire spellings at the source boundary. Microsoft documents `skus[].cost`, while
  the observed 2025-06-01 Location Models response uses `skus[].costs`. Accept either spelling, but
  reject the source when both appear with different arrays. Empty `meterId` strings are absence, not
  identifiers.
- The only authenticated pricing join is ARM model/version + region + SKU + cost component + direct
  `meterId`, followed by the matching public Retail Prices meter. A cost without a direct meter stays
  unbound. The collector does not request billing-account or billing-profile access and never uses
  account-eligible Marketplace catalog data to build the public price book.
- Structured ARM cost components provide an independent semantics check. Reviewed mappings include
  uncached context to text input, cached context to cache read, generated tokens to text output,
  batch context to text input, and embedding total/context tokens to embedding usage. A disagreement
  with the Retail meter or unit rejects that cost component. Hosting, provisioned, training,
  fine-tuning, and grader components are deliberately outside base usage pricing.
- Canonical rate observations use the public Retail `meterId` as a source-native `meter` locator.
  Reconciliation retains complete reason counts, including direct-meter, missing-meter,
  missing-Retail-meter, unsupported-component, and semantic-conflict outcomes.

## Commercial topology

Design status: implemented. Microsoft Foundry uses the shared provider-resource price-book wire.
The collector keeps synchronous PAYG, Batch, provisioned capacity, optional services,
account-resource templates, and procurement plans separate instead of flattening them into a model
token row.

The public-pricing source follows the bounded model-family index and a fixed reviewed bundle for
Azure OpenAI, fine-tuning and managed compute, Foundry Agent Service, Content Safety, AI
Evaluations, and Microsoft Foundry plans. Numeric amounts come from each page's embedded regional
decimal map. Known table semantics normalize claim-locally; an unrecognized commercial row is
retained as a source-labelled raw provider-resource term, so sibling rows continue to refresh
without an LLM and without silently losing a separately published price.

### Public commercial source graph

| Surface                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Exact authority and completeness boundary                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reviewed MicrosoftDocs catalogs, lifecycle tables, deployment matrices, Location Models API, and the bounded Foundry Explorer request                                                                                                                                                                                                                                                                                                                            | Model/version identity, model lifecycle, exact deployment-SKU compatibility, regional/account inventory, and direct ARM meter IDs. These surfaces establish callable or deployable resources, not a price merely because a SKU exists.                                                                                       |
| [Azure Retail Prices](https://prices.azure.com/api/retail/prices), [Azure OpenAI pricing](https://azure.microsoft.com/en-us/pricing/details/azure-openai/), and the [Foundry Models family index](https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/microsoft/)                                                                                                                                                                                | Current public USD amounts for exact returned meters and rendered pricing rows. Retail is exhaustive only for the queried service/product/price-type inventory; each page is exhaustive only for its named table. Embedded regional decimal maps, not visible `$-` placeholders, own page amounts.                           |
| [Deployment types](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/deployment-types), [Batch](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/batch), and [Priority processing](https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/priority-processing)                                                                                                                                                       | Distinct API/job mechanisms, deployment geography, requested versus served tier, failure behavior, quota, and billable completion semantics. The documented Batch discount is a consistency check, not authority to synthesize a missing exact row.                                                                          |
| [Provisioned throughput](https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/provisioned-throughput), [PTU billing](https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/provisioned-throughput-billing), [PTU Reservations](https://learn.microsoft.com/en-us/azure/cost-management-billing/reservations/microsoft-foundry), and [spillover](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/spillover-traffic-management) | Capacity units, hourly charging, reservation scope/term/precedence, deployment compatibility, and exact spillover route evidence. Quota and capacity availability remain separate from both purchase and price.                                                                                                              |
| [Model Router concepts](https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/model-router), [usage guide](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/model-router), and [pricing page](https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/model-router/)                                                                                                                                                          | Router versions, mutable supported-model sets, routing modes, realized underlying model, router input markup, and additive underlying-model cost. A supported underlying model is a relationship target, not another identity for `model-router`.                                                                            |
| [Managed compute](https://learn.microsoft.com/en-us/azure/foundry/concepts/managed-compute-overview) and [classic protected-model managed compute](https://learn.microsoft.com/en-us/azure/foundry-classic/how-to/deploy-models-managed-pay-go)                                                                                                                                                                                                                  | The current `GlobalManagedCompute` model-instance/accelerator mechanism and the distinct classic Azure Machine Learning VM plus Marketplace model-surcharge mechanism. Their shared product phrase does not make their meters interchangeable.                                                                               |
| [Fine-tuning](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/fine-tuning), [cost management](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/fine-tuning-cost-management), [deployment](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/fine-tuning-deploy), and [fine-tuning prices](https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/fine-tuning-models/)                                        | Eligible base models/methods, training tier and completed-work rules, RFT grader composition, custom-model lifecycle, hosting, inference, and capacity alternatives. Account-created fine-tuned IDs are not public catalog models.                                                                                           |
| [Foundry Agent Service pricing](https://azure.microsoft.com/en-us/pricing/details/foundry-agent-service/), [hosted agents](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/hosted-agents), and exact tool guides                                                                                                                                                                                                                                 | Prompt/workflow orchestration's no-separate-charge boundary; hosted vCPU/GiB runtime; File Search storage; Code Interpreter sessions; Web/Custom Search transactions; tool resource lifecycles and outcome signals. Ordinary function, OpenAPI, MCP, A2A, and customer service calls have no generic Foundry tool-call rate. |
| [Content Safety pricing](https://azure.microsoft.com/en-us/pricing/details/content-safety/), default guardrails, and deployment-filter guides                                                                                                                                                                                                                                                                                                                    | Text-record/image denominators, free and Standard tiers, explicit validation behavior, and the conditional separately billed safety path. A configured filter or capability alone is not a charge signal.                                                                                                                    |
| [Foundry Observability pricing](https://azure.microsoft.com/en-us/pricing/details/foundryobservability/), evaluator guides, and tracing guides                                                                                                                                                                                                                                                                                                                   | AI Evaluation input/output amounts and the division between safety/red-teaming/playground meters and no-surcharge BYO-judge model inference. Monitoring has no Foundry fee; tracing settles in Application Insights/Azure Monitor Logs.                                                                                      |
| [Claude CCU billing](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/claude-models-billing) and Anthropic's Microsoft Foundry pricing section                                                                                                                                                                                                                                                                                            | New-deployment Marketplace enrollment, CCU conversion/aggregation, upstream public token rates, Data Zone multiplier, private-offer order, and per-model operational usage. CCU is a settlement unit, not a second inference price.                                                                                          |
| [Microsoft Foundry pricing](https://azure.microsoft.com/en-us/pricing/details/microsoft-foundry/) and [Agent Prepurchase Plan](https://learn.microsoft.com/en-us/azure/cost-management-billing/reservations/agent-pre-purchase)                                                                                                                                                                                                                                  | Current ACU tiers, one-year term, eligible-retail-cost drawdown, scope, nonrefundable purchase, renewal, and benefit precedence. The plan covers only the exact eligible service set; the word “Foundry” never implies every Marketplace offer.                                                                              |
| Price Sheet, Cost Details/Exports, Marketplace plan data, Cost Management, and invoices                                                                                                                                                                                                                                                                                                                                                                          | Account-effective rates, quantities, discounts, Marketplace publisher, benefit application, actual/amortized cost, currencies, tax, credits, and final settlement. These surfaces reconcile account cost but never create public model identity.                                                                             |

Foundry is a cloud platform, not a license to copy every Azure product into this provider. A target
book is admitted only when it is a Foundry model mechanism, a Foundry-owned service with an exact
commercial surface, or an exact public procurement/benefit mechanism that targets those charges.
Azure AI Search, Blob Storage, Logic Apps, Fabric, SharePoint, Speech, Language, Translator,
Application Insights, Defender, customer MCP servers, and licensed data remain external component
references unless the Foundry surface itself publishes and owns the exact term being normalized.
This preserves full cost composition without turning the provider price book into the entire Azure
retail catalog.

### Resources, books, and offer boundaries

| Book/resource                                                        | Offers                                                   | Boundary rationale                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public serverless model                                              | Synchronous PAYG inference                               | Regional, Global, and Data Zone Standard are geography/SKU variants. Priority is a served-rate variant of the same request mechanism. Instant access is a deploymentless access route to the same model mechanism unless an exact meter establishes otherwise.                                     |
| Public serverless model                                              | Batch inference                                          | Separate offer because `/batches` is an asynchronous file/job mechanism with separate enqueued-token quota, cancellation, result, and completion semantics. Global/Data Zone are variants.                                                                                                         |
| Public model/capacity                                                | Provisioned inference                                    | Capacity offer billed by deployed PTU-hours. Regional, Data Zone, and Global are variants; model/version compatibility and minimum/throughput facts remain separate from the model-independent PTU rate. Per-request amortization is operator policy, not a token term.                            |
| `model-router` public model                                          | Router execution plus realized underlying model          | The router is a real catalog model. Its own input markup is one exact term, while the selected underlying model contributes its normal input/cache/output terms through a required relationship. Flattening the markup to ordinary `input_text` would falsely present it as the total model price. |
| `azure.fine-tuning` service                                          | SFT/DPO/RFT training job                                 | Provider service parameterized by an exact eligible base model and method. Standard, Global, and Developer training are job/tier variants; a generated checkpoint is an account artifact.                                                                                                          |
| `azure.fine-tuned-hosting` and `azure.fine-tuned-inference` services | Deployed custom-model hosting and inference              | Hosting time and inference usage have distinct meters. Developer inference's fixed 24-hour lifecycle is a separate mechanism. Provisioned custom-model inference uses capacity instead of copying PAYG token/hosting terms.                                                                        |
| `azure.managed-compute` service                                      | Current `GlobalManagedCompute` accelerator capacity      | Dedicated model instances are billed by accelerator family, count per versioned deployment template, instance count, and running time. This capacity does not become a token price or create a custom/open model row.                                                                              |
| Classic managed online deployment                                    | Azure ML compute plus optional protected-model surcharge | Distinct legacy/hub route. VM compute and the publisher's Marketplace GPU-hour surcharge are two independently owned components, prorated by deployment uptime. A NIM plan may cover several models without making them one model.                                                                 |
| `azure.hosted-agents` service                                        | Active-session vCPU and GiB compute                      | Container runtime is independent of model tokens and tool charges. CPU/memory are per active session, not replica. Prompt/workflow agent orchestration has no separate commercial offer.                                                                                                           |
| `azure.file-search-storage` service                                  | Basic managed vector storage                             | Persistent GB-days and the first-GB benefit exist without a model request. Standard File Search instead uses customer Blob Storage and Azure AI Search; those external books must not inherit the Basic storage rate.                                                                              |
| `azure.code-interpreter` service                                     | Built-in Code Interpreter session                        | A session has its own lifetime/concurrency boundary—currently up to one hour with a 30-minute idle timeout—and one per-session amount. It is not a code-execution count and not a generic tool call. Customer-hosted dynamic sessions are a different Azure service.                               |
| Bing-backed search services                                          | Web Search and Custom Search transactions                | Preserve exact entry point, resource, and transaction meter. Responses Web Search and connected Grounding tools share Bing infrastructure, but collapse them to one charge only when the exact meter proves one billable transaction; never charge both labels for the same event.                 |
| `azure.content-safety` service                                       | Direct/integrated text and image validation              | Text records and images are separate terms. Free/Standard tier and disconnected-container commitment are separate acquisition mechanisms; only cloud validation attached to a Foundry execution is projected into model cost.                                                                      |
| `azure.ai-evaluations` service                                       | Safety, red-teaming, and playground evaluation           | Dedicated Foundry Evaluation input/output-token rates. Quality and continuous evaluation do not use this offer: they bill the selected judge model's normal inference with no evaluation surcharge.                                                                                                |
| PTU Reservation                                                      | One-month or one-year PTU benefit                        | A procurement offer that creates hourly PTU coverage. It is not capacity availability, does not pause a deployment, and can coexist with hourly overage.                                                                                                                                           |
| Microsoft Agent Prepurchase Plan                                     | One-year ACU commitment                                  | A separately purchased cross-service settlement benefit. ACUs reduce eligible retail-dollar usage until term end or exhaustion; they are not model tokens, quota, or a model subscription.                                                                                                         |
| Claude Marketplace/CCU enrollment                                    | CCU settlement path                                      | Public token economics remain model-scoped. New deployments convert discounted dollar cost into a fixed-price CCU and meter it hourly; old deployment plans remain account/deployment facts. No duplicate model offer is created.                                                                  |
| Foundry Local                                                        | Distribution/local execution route                       | The public page publishes no Azure-hosted inference amount. Local hardware, energy, and operator costs are external; absence is neither a free Azure model offer nor `not_applicable` to every execution route.                                                                                    |

Sold-by-Azure versus partner/community ownership changes procurement, eligible benefits, and invoice
location, not the model's API mechanism by itself. Public model offers retain the exact seller and
settlement route. A partner Marketplace offer can share the same request API without inheriting
Azure Prepayment, ACU, or first-party meter semantics.

### Relationship matrix

| Source                                     | Target                                                         | Relationship and applicability                                                                                                                                                                                                |
| ------------------------------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Batch model offer                          | Same model's synchronous PAYG offer                            | `exclusive_with` for one submitted billable execution. An account may use both for different work.                                                                                                                            |
| Priority variant                           | Synchronous PAYG offer                                         | No offer edge. Requested `priority` can settle at Standard; the actual served tier selects the term.                                                                                                                          |
| Instant-access route                       | Deployed synchronous route                                     | No offer edge and no inferred price equality. They are access routes to one offer only when exact model/meter evidence agrees.                                                                                                |
| One provisioned serving attempt            | Same model's PAYG serving attempt                              | `exclusive_with` only at the realized serving-attempt scope. A spillover request can contain a failed/limited PTU attempt and a successful PAYG attempt while the account continues paying capacity.                          |
| Spillover configuration                    | Exact same-model/version provisioned and Standard deployments  | Route-graph compatibility, not a request-wide price alternative. The documented response headers and metrics identify the serving deployment; only the spilled Standard execution adds PAYG tokens.                           |
| Model Router offer                         | One exact supported underlying synchronous model offer         | `incurs`, with supported models as alternatives and router-version/routing-subset applicability. The response `model` selects the realized target. Router markup and underlying inference are additive.                       |
| Model Router selecting Claude              | Exact Claude deployment and current Marketplace/CCU enrollment | Additional account/resource requirement. Claude must be predeployed with the matching SKU; its token charge settles through its own Claude plan.                                                                              |
| Model Router used with Agent Service tools | Exact OpenAI underlying-model subset                           | Route-compatibility constraint, not a price edge. Microsoft currently restricts this path to OpenAI underlying models; the router markup remains unchanged.                                                                   |
| RFT training with a model grader           | Exact grader-model inference offer                             | `incurs` only when the selected grader is model-backed. Python/string graders do not inherit a model charge. Training time and grader tokens remain separate components.                                                      |
| Fine-tuned PAYG inference                  | Applicable custom-model hosting offer                          | `requires` where Microsoft publishes both hosting and token inference for the deployment class. Developer and provisioned deployments keep their own exact mechanisms rather than inheriting this edge.                       |
| Fine-tuning job                            | Eligible base model                                            | Resource dependency, not a commercial offer edge. Using a base model for training does not require purchasing its public inference offer, and the resulting custom ID remains account scoped.                                 |
| Managed-compute deployment                 | Exact deployment-template accelerator capacity                 | `requires`. Template identity supplies accelerator family/count; a model capability or approximate size never guesses the template.                                                                                           |
| Protected classic managed deployment       | Azure ML compute and exact Marketplace model surcharge         | Two cumulative `requires` relationships when the plan publishes a surcharge. Open models without a surcharge retain only compute; missing Marketplace evidence is unknown, not zero.                                          |
| Hosted agent runtime                       | Realized model and tool services                               | `compatible_with` globally. A session can execute arbitrary customer code; only observed model/tool invocations add their offers.                                                                                             |
| Code Interpreter session                   | Exact supported model/agent execution                          | `requires` in the built-in tool route. One session may span several model calls, so relationship existence never copies the per-session amount onto every request.                                                            |
| Web/Custom Search transaction              | Exact model/agent execution that dispatched it                 | `requires` for the realized built-in/grounding route. Tool declaration and `tool_choice` establish only possible use.                                                                                                         |
| Basic File Search storage                  | Supported agent/model route                                    | `compatible_with`, not `requires`: stored vector data can persist and accrue cost without a request. Standard File Search has external Storage/Search components instead.                                                     |
| Integrated Content Safety validation       | Exact model/router execution                                   | The configured model/router route conditionally `incurs` the validation offer. Blocked traffic can retain both components; Model Router applies its filter once at the router boundary, not once per listed underlying model. |
| Quality/continuous evaluation              | Selected judge-model inference offer                           | `incurs`; Foundry evaluation adds no surcharge. Safety/red-team/playground evaluation uses the separate AI Evaluations offer instead.                                                                                         |
| PTU Reservation benefit                    | Matching PTU-hour usage                                        | Allowance target with region/deployment type/scope/term, not `exclusive_with`: covered PTUs and PAYG overage can coexist in one hour.                                                                                         |
| Agent ACU benefit                          | Exact plan-eligible Microsoft usage                            | Cross-book allowance target. PTU Reservation and other specific reservations apply first; ACUs apply only to remaining eligible usage and never to purchase costs of reservations/prepurchase plans.                          |
| Azure Prepayment                           | Sold-directly-by-Azure usage                                   | Settlement eligibility only. Marketplace partner/Claude charges do not inherit this benefit.                                                                                                                                  |

Foundry spillover and Vercel fallback prove the shared runtime `attempt` aggregation boundary. Keep
provider, deployment, model/version, seller, credential/settlement path, outcome, and component
usage for each economically relevant attempt; the final serving response cannot prove that earlier
attempts cost zero. An attempt is runtime accounting context, not a static resource or offer.

### Meters, denominators, signals, and resolution phase

| Commercial atom                   | Published denominator                                                                                                                                    | Charge or reconciliation signal                                                                                                                                                                                                                                     | Earliest reliable phase   |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Synchronous inference             | Exact model/version, region/deployment class, service tier, context/cache/modality term's native tokens, images, pages, megapixels, minutes, or requests | Operation-native response usage plus direct ARM meter where available; Cost Details for settlement                                                                                                                                                                  | Outcome / account         |
| Priority                          | Same native dimensions at the actual served Priority or Standard rate                                                                                    | Response `service_tier`; `ServiceTierRequest` is only requested intent, while `ServiceTierResponse`/billing identifies fallback                                                                                                                                     | Outcome / account         |
| Batch                             | Completed result items' exact input/cache/output/native usage                                                                                            | Batch job/item status and job `usage`; canceled work charges only completed processing. Enqueued tokens are quota                                                                                                                                                   | Job outcome / account     |
| Provisioned capacity              | Deployed PTUs × elapsed hours, prorated for partial hours and immediate resize                                                                           | Deployment capacity timeline and provisioned billing meter; billing stops only on deletion                                                                                                                                                                          | Account                   |
| PTU Reservation                   | Matching PTU units covered in each hour over the reservation term                                                                                        | Reservation scope/attributes and benefit-application records; unused hourly coverage does not roll over                                                                                                                                                             | Account settlement        |
| Spillover PAYG                    | Native usage on the serving Standard deployment                                                                                                          | `x-ms-spillover-from-deployment`, `x-ms-deployment-name`, `IsSpillover`, response usage, and Standard meter                                                                                                                                                         | Outcome / account         |
| Model Router markup               | Router-processed input tokens                                                                                                                            | Router request/response input usage at the exact region/deployment rate                                                                                                                                                                                             | Outcome                   |
| Routed underlying inference       | Selected model's native input/cache/output dimensions                                                                                                    | Response `model`, usage partitions, router deployment tag, and exact underlying price/meter. Failed hidden attempts remain unresolved                                                                                                                               | Outcome / account         |
| Current managed compute           | Accelerators per model instance × instances × running hours                                                                                              | Versioned deployment template, capacity timeline, accelerator family, and managed-compute billing meter                                                                                                                                                             | Account                   |
| Classic protected managed compute | VM uptime plus publisher surcharge GPU-hours, prorated per minute                                                                                        | Managed online deployment/VM inventory and the exact project-scoped Marketplace SaaS usage                                                                                                                                                                          | Account                   |
| SFT/DPO training                  | Training-file tokens × completed epochs                                                                                                                  | Fine-tuning job events/checkpoints and billing meter; queue, pre-training cancellation, and safety checks are excluded                                                                                                                                              | Job / account             |
| RFT training                      | Completed training hours plus exact grader-model inference tokens                                                                                        | Job/checkpoints and grader usage; the first `$5,000` cap pauses the job but is not a credit or final lifetime limit                                                                                                                                                 | Job / account             |
| Fine-tuned hosting                | Deployed custom-model hours, including idle time                                                                                                         | Custom deployment lifecycle and hosting meter. Stored undeployed custom models are explicitly no-cost                                                                                                                                                               | Account                   |
| Fine-tuned inference              | Exact custom deployment's input/output tokens or PTU-hours                                                                                               | Custom deployment response usage and meter; base-model token rates never substitute                                                                                                                                                                                 | Outcome / account         |
| Hosted agent compute              | vCPU-hours and GiB-hours across active sessions                                                                                                          | Per-session allocation and active duration; idle timeout/session teardown, not replica count                                                                                                                                                                        | Outcome / account         |
| Basic File Search storage         | GB of vector storage per day                                                                                                                             | Managed vector-store inventory/size and storage meter; the first-1-GB benefit is exact, while its account/resource aggregation scope must come from billing evidence                                                                                                | Account                   |
| Code Interpreter                  | One created built-in session                                                                                                                             | Session identity/lifecycle. Executed code cells and generic tool-call items do not increment the published denominator                                                                                                                                              | Outcome / account         |
| Web/Custom Search                 | One published search transaction                                                                                                                         | Responses `web_search_call` action where exact; connected-resource execution and billing meter otherwise. One model response may issue several transactions                                                                                                         | Outcome / account         |
| Content Safety text               | One text record per started 1,000 Unicode code points submitted for validation                                                                           | Direct API request is exact; integrated filter results prove validation but may not expose the service's exact internal record partition, so meter data remains authoritative. Free tier currently includes 5,000 text records/month and stops rather than overages | Request/outcome / account |
| Content Safety image              | One image submitted for validation                                                                                                                       | Direct Content Safety call or exact integrated safety meter; configured capability alone is insufficient. Free tier currently includes 5,000 images/month and stops rather than overages                                                                            | Outcome / account         |
| AI Evaluations                    | Dedicated service input and output tokens for safety, red-team, and playground evaluation                                                                | Evaluation job usage when exposed and AI Evaluation billing meters                                                                                                                                                                                                  | Job / account             |
| Quality/continuous evaluation     | Selected judge model's normal input/cache/output tokens                                                                                                  | Judge deployment response/job usage; no additional evaluation surcharge                                                                                                                                                                                             | Job / account             |
| Claude CCU                        | Discounted token-dollar amount converted at the fixed CCU price and metered hourly                                                                       | Per-model operational tokens, deployment plan/private offer, Marketplace CCU usage, and invoice                                                                                                                                                                     | Outcome / account         |
| Agent ACU                         | One ACU per eligible USD 1 of retail usage before the plan discount                                                                                      | Eligible service cost, benefit precedence, plan scope/balance/term, and reservation utilization                                                                                                                                                                     | Account settlement        |

TPM, RPM, enqueued-token limits, model-router quota tiers, PTU quota, accelerator quota, safety free-tier
request stops, and capacity availability are admission or quota facts. They never become charge
quantities merely because they share a unit with a billed meter.

### Requested, realized, capacity, allowance, enrollment, and settlement facts

Publication facts select model/version, seller, supported deployment mechanism, deployment geography,
router-version relationship universe, fine-tuning method, template/accelerator, tool/evaluator service,
public rate, allowance, and offer enrollment state. Request or deployment facts select instant versus
named deployment, Standard/Priority, Batch, region/data zone, router mode/subset, content filter,
tools, fine-tuning tier/method/grader, capacity, and account resource. None proves the final billed
route by itself.

Outcome facts select served tier, serving deployment, spillover, routed underlying model, completed
Batch items, token/cache/media quantities, created sessions, executed searches, safety validation,
grader usage, and job/runtime duration. Account facts select active reservations and ACUs, scope,
benefit precedence, Marketplace enrollment, old/new Claude plan, private offer, Azure Prepayment,
Price Sheet, credits, billing currency, tax, and invoice. HTTP status alone remains insufficient:
billable processing and component-specific completion determine charges.

Provisioned capacity accrues independently of requests. A spilled request can add PAYG token cost
while capacity continues to accrue, but a per-request calculator must not assign the whole PTU-hour
to that request unless the operator supplies an amortization policy. Likewise persistent storage,
hosting, managed compute, hosted-agent runtime, reservations, and ACUs resolve at account/workload
scope rather than becoming hidden request surcharges.

The Agent Prepurchase Plan is a one-year, separately invoiced, nonrefundable commitment. Its ACUs
draw down eligible retail usage until exhausted or expired; specific Reservations apply first, and
the plan cannot pay for another reservation/prepurchase purchase. The exact eligible service set is
a source-owned fact and must be refreshed. Do not infer that Claude or another Marketplace partner
is covered merely because it is callable from Foundry. Azure's generic `$200 / 30 days` account
promotion is similarly an account-wide Azure credit, not a Foundry model allowance unless exact
eligibility and application are observed.

### Commercial-atom disposition ledger

| First-party atom                                                                              | Target disposition                                                                                   | Rationale                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Standard regional/global/data-zone model usage, cache, context, media, and native units       | Normalize as synchronous model-offer variants                                                        | Exact mechanism and scoped amount exist; deployment geography is not a separate offer.                                                                                                   |
| Priority rates and fallback                                                                   | Normalize as realized served-tier variants                                                           | Requested priority is not the billing signal and fallback is charged at Standard.                                                                                                        |
| Instant access                                                                                | Preserve as an inference route on the exact model                                                    | No deployment is needed, but no reviewed source creates a distinct commercial amount. A price is attached only through exact meter identity.                                             |
| Batch model rows                                                                              | Normalize as separate model offers                                                                   | Distinct async job, quota, cancellation, completion, and result semantics are first-party facts.                                                                                         |
| PTU hourly capacity                                                                           | Normalize as provisioned capacity offers                                                             | PTUs are deployed capacity, not tokens. Compatibility/minimum/throughput remain exact model/deployment facts.                                                                            |
| PTU Reservations                                                                              | Normalize procurement offers and hourly coverage allowances                                          | Purchase does not reserve technical capacity; coverage, overage, term, and scope are exact.                                                                                              |
| Legacy pre-August-2024 PTU commitment plans                                                   | Preserve account-scoped legacy procurement facts                                                     | Existing deployments can retain the old commitment model, but it is unavailable for new purchase and must not be rewritten as a current Reservation.                                     |
| Spillover                                                                                     | Preserve exact route graph and attempt evidence                                                      | Capacity and PAYG may both contribute to workload cost, while only the serving Standard attempt gets token charges.                                                                      |
| Model Router input row                                                                        | Normalize as `model_router_input` markup, not ordinary model input                                   | Official cost guidance adds router markup to the realized underlying model's input/output price.                                                                                         |
| Model Router supported-model/version tables                                                   | Normalize version-qualified `requires` targets                                                       | The latest version mutates in place; relationship refresh must not create aliases or silently widen frozen versions.                                                                     |
| Router mode, subset, policy, quota, and failover configuration                                | Route/control/account facts                                                                          | They change selection and availability, not the public amount. Hidden failed-attempt billing remains unresolved.                                                                         |
| Fine-tuning SFT/DPO training                                                                  | Normalize training service terms                                                                     | Training tokens/epochs and completed-work exclusions are exact; the generated custom model is account scoped.                                                                            |
| RFT training and model graders                                                                | Normalize training-hours plus exact grader inference composition                                     | A model grader is separately billed inference; nonmodel graders do not inherit that rate. The pause cap is a control, not an allowance.                                                  |
| Fine-tuned hosting, PAYG inference, Developer inference, and provisioned inference            | Normalize account-resource service offers                                                            | Different meters and lifecycle rules must not be copied to the public base-model row.                                                                                                    |
| Current `GlobalManagedCompute`                                                                | Normalize accelerator capacity offers                                                                | Template accelerator count × instances × running hours is exact. Repeated family-page sections are one shared service book.                                                              |
| Managed Compute H200 marketing mention without a current template/rate row                    | Preserve bounded raw evidence; normalize neither availability nor amount                             | The detailed current accelerator list and numeric table establish A100, H100, and MI300X only; a broad overview mention cannot manufacture H200 availability or copy a neighboring rate. |
| Classic managed compute for protected models                                                  | Normalize exact compute and Marketplace surcharge components                                         | The route has two billing owners and a project-scoped SaaS enrollment; new managed-compute rates cannot replace it.                                                                      |
| Foundry-native prompt/workflow orchestration                                                  | Preserve an explicit no-separate-charge policy; create no zero-rate offer                            | Models, tools, knowledge, and external connections remain charged. A free pseudo-offer would add no commercial decision.                                                                 |
| Hosted-agent vCPU/GiB runtime                                                                 | Normalize provider-service capacity terms                                                            | Active session compute is independent of model/tool usage.                                                                                                                               |
| Basic File Search storage and first-GB benefit                                                | Normalize persistent storage plus allowance                                                          | Storage survives requests; Standard File Search's Blob/Search costs remain external.                                                                                                     |
| Code Interpreter session                                                                      | Normalize a provider-service offer                                                                   | Session creation/lifetime, not code executions or generic tool calls, owns the meter.                                                                                                    |
| Responses Web Search and connected Bing Search/Custom Search                                  | Normalize exact transaction services without duplicate entry-point charges                           | Executed search actions are separately billed; configuration and citations are not transaction counts. Exact meter identity resolves shared infrastructure.                              |
| Function, OpenAPI, MCP, A2A, toolbox search, and customer tool calls                          | No generic Foundry service offer; retain downstream component references                             | Model tokens still apply, while the invoked provider, license, or infrastructure owns any additional cost.                                                                               |
| Direct or integrated Content Safety validation                                                | Normalize text/image services, tier, and allowance; leave ambiguous integrated quantity binding raw  | Official sources say validation can be separately billed and blocked traffic can retain both components. Capability alone does not prove quantity.                                       |
| Content Safety disconnected-container commitments                                             | Preserve separate provider capacity/procurement offers outside model projection                      | Their annual limits and container lifecycle are real, but they are not the cloud validation route attached to a Foundry model request.                                                   |
| Safety, red-team, and playground evaluations                                                  | Normalize AI Evaluation input/output service terms                                                   | The dedicated meter and applicable evaluation classes are exact.                                                                                                                         |
| Quality and continuous evaluations                                                            | Normalize only selected judge-model inference                                                        | Microsoft explicitly publishes no evaluation surcharge. Missing judge identity must not become free.                                                                                     |
| Monitoring and Foundry tracing                                                                | No Foundry monitoring/tracing offer; preserve Azure Monitor/Application Insights external settlement | Foundry adds no fee, but connected log ingestion/retention can still cost money.                                                                                                         |
| Claude public token rates, Data Zone multiplier, and private-offer order                      | Normalize model terms plus settlement conditions                                                     | Anthropic owns the public economics; Microsoft owns deployment/Marketplace conversion.                                                                                                   |
| CCU fixed unit and hourly Marketplace rollup                                                  | Normalize settlement conversion/enrollment, not a second inference charge                            | Operational tokens remain the usage dimension and one CCU line can cover several models.                                                                                                 |
| Agent ACU tiers, price, term, scope, and precedence                                           | Normalize a cross-book commitment offer and retail-dollar allowance                                  | ACUs are neither tokens nor quota, and only exact eligible Microsoft usage draws down.                                                                                                   |
| Azure Prepayment, MACC, Marketplace, private offers, credits, currencies, taxes, and invoices | Settlement facts                                                                                     | Public routes are in scope; account-effective amounts remain account evidence.                                                                                                           |
| Foundry Local and customer-owned compute                                                      | Distribution/execution route with external or unpublished economic cost                              | Do not emit an Azure free model or discard the route as globally inapplicable.                                                                                                           |
| Explicit free Retail/Content Safety rows and included quantities                              | Normalize exact free offers or allowances in their owning book                                       | The base parser's exclusion is not a final commercial disposition. Numeric zero, free, and included remain distinct.                                                                     |
| Quota, capacity availability, rate limits, budgets, policy, and the RFT pause cap             | Control/account facts                                                                                | They affect admission or continuation but do not publish a marginal price or purchased benefit.                                                                                          |
| Pricing calculator estimates, percentage savings claims, and examples                         | Consistency/estimate evidence only                                                                   | They cannot synthesize a missing exact row or account charge.                                                                                                                            |
| Cost Analysis, Cost Details, Marketplace usage, and invoice lines                             | Reconciliation/settlement evidence                                                                   | They can make account cost exact but never change catalog identity or retroactively manufacture a public rate.                                                                           |

### Authority, conflicts, and claim-local refresh

Authority is claim-specific:

1. The exact catalog/Location Models tuple owns model identity and deployment compatibility. Pricing
   evidence never admits a model. A direct ARM `meterId` joined to Retail is the strongest exact
   public observation for that model/version/region/SKU; a uniquely bound Retail SKU outranks a
   versionless family-page fallback. An exact version row can still control the exact tuple where a
   Retail label is ambiguous.
2. Pricing pages own their exact model/service amounts and embedded region maps. Feature guides own
   mechanism, dependency, billed-event, failure, and phase semantics. A prose discount or “pay only
   for what you use” phrase cannot fill a missing numeric row.
3. Microsoft explicitly delegates Claude public token economics to Anthropic while retaining the
   Azure deployment, Marketplace, CCU, and invoice contract. That scoped delegation is stronger than
   a third-party catalog and does not authorize importing another provider's aliases.
4. Price Sheet owns the account's contract rate; Cost Details/Exports own accrued quantity and
   effective cost; Marketplace data owns plan/enrollment; the invoice owns final credits/tax. These
   scoped facts do not conflict with a public list price merely because the amounts differ.
5. If equally specific current sources still disagree, resolve a winner only through direct-meter
   identity, exact route containment, source purpose, effective interval, or account scope. Retain
   the losing observation and surface a conflict warning. Without a reviewed rule, withhold only the
   disputed amount, unit, signal binding, relationship, or condition—not the model, sibling terms,
   service, or provider snapshot.

The Foundry family pages repeat one shared Managed Compute section. Deduplicate identical
observations by exact service/GPU/scope/validity; a divergent copy is one localized source conflict,
not several additive capacity charges. Likewise, Web Search, Grounding with Bing Search, and Agent
Service labels may reach the same first-party transaction, but a shared numeric amount alone is not
proof of shared billing identity. Preserve entry points in the resource graph and merge commercial
events only through exact meter or billing evidence. The broad pricing-page copy currently names
H200 while the detailed managed-compute guide and numeric table expose no H200 accelerator/template
rate. The detailed mechanism plus exact table controls publication; H200 remains a visible bounded
candidate rather than inheriting an H100 rate.

Model Router is a deliberate source-purpose exception to the generic base-table grammar: its
published input amount is an additive routing markup, while the response-selected model owns normal
inference. Fine-tuning tables describe provider services and account artifacts. Managed Compute,
PTU, built-in-tool, free-tier, reservation, ACU, evaluation, and Content Safety rows similarly need
their own grammars. None may be silently dropped merely because it is not model-base pricing.

Refresh is deterministic and non-LLM. It enumerates every catalog/model tuple, Retail row, family
page table/embedded amount, exact service page row, benefit tier, recognized policy companion, and
commercial atom. New official service keys or unmatched terms remain bounded raw evidence and are
surfaced for review. Exact IDs, direct meter IDs, documented aliases, and reviewed product
vocabularies are the only joins; fuzzy matching, family inheritance, amount similarity, and an LLM
are never fallbacks.

Collection and reconciliation are claim-local. A malformed Agent price cell suppresses only that
service amount; an ambiguous router target suppresses only that edge; a missing Content Safety
counter leaves only its quantity binding unresolved; a failed optional account API cannot erase the
public book. Source removal retires a fact only when that source is exhaustive for the exact claim;
temporary partial failure may retain the prior accepted claim with visible staleness. Publication
remains crash-atomic after all claim-local dispositions and conflicts are validated.

### Model-detail composition and cost coverage

Model details project exact public model mechanisms: synchronous PAYG, Batch, provisioned capacity,
and exact managed-compute compatibility. Model Router additionally projects its markup and
version-qualified underlying choices. Fine-tuned IDs, deployments, hosted agents, vector stores,
sessions, Marketplace SaaS resources, reservations, and ACU balances remain account resources and
never become public model rows.

Provider services appear on a model only when exact applicability is known. Code Interpreter and
search are supplemental only after the exact tool route is selected or realized. File storage,
hosted-agent compute, Content Safety, and evaluation remain separately owned services; an ordinary
tool capability or filter badge cannot cause a charge. Connected Azure/customer services stay
external component references instead of borrowing the nearest Foundry rate.

A calculator sums independently charged realized components once:

- Model Router is router-input markup plus the selected underlying model's input/cache/output and
  any exact tool service. The same prompt-token quantity may legitimately feed both markup and
  underlying-input terms.
- Spillover keeps provisioned capacity at workload scope and adds PAYG usage only for the serving
  Standard attempt. It does not double-charge the rejected PTU attempt as a token request.
- Fine-tuning cost is completed training plus optional grader inference, then hosting or provisioned
  capacity, plus fine-tuned inference. Base-model inference is not copied into the custom artifact.
- An agent run can compose hosted-session compute, one or more model route attempts, Code
  Interpreter sessions, search transactions, persistent storage, safety validation, evaluation, and
  external services. Prompt/workflow orchestration itself contributes no separate fee.
- Reservations, ACUs, Azure Prepayment, private offers, and CCU conversion apply only in the
  settlement phase and in documented precedence. They change payable net cost or settlement unit,
  not the public usage topology.

Cost coverage is `complete` only when every realized component has exact identity, native quantity,
public/account rate, relationship, and settlement path. It remains partial when, for example, a
router failover attempt, integrated safety record count, Bing transaction attribution, managed
template, grader model, Marketplace surcharge, external connected service, capacity amortization,
or account benefit is unknown. An exact Cost Details or invoice total may reconcile the aggregate
without pretending that missing line-item allocation became exact.

## Public estimate and account-exact cost

- The Retail Prices API and Microsoft pricing pages publish prices without account discounts.
  Kmodels exposes rates for either the exact base model/version or an explicitly shared base-model
  scope, plus region, Azure pricing scope/SKU, meter, modality, context tier, batch/priority mode,
  and native quantity. Deployment names and deployment resource IDs are deliberately outside this
  catalog. A consumer must already know the base model selected for the request; when the selected
  deployment also fixes a version, exact-version books take precedence over a shared base-model
  fallback. Kmodels does not infer either identity from a customer-defined alias.
- Azure's authenticated Price Sheet API is the first-party source for contract-specific meter
  prices. Cost Details exposes `PayGPrice`, negotiated `UnitPrice`, actual `EffectivePrice`, quantity,
  pricing model, marketplace publisher, billing/pricing currency, and actual or amortized cost.
  Use Cost Details/Exports for accrued charge reconciliation and the invoice for credits and taxes.
- Account-level adjustments include EA/MCA/MPA negotiated rates, Marketplace private offers,
  reservations or savings-plan allocation where applicable, included quantity, partner credits,
  billing-currency conversion, credits, and tax. They are not inferable from a public model price
  book. Claude is especially explicit: different per-model private-offer discounts are applied
  before token cost becomes hourly CCU metering.
- HTTP success or failure alone does not determine billing. Microsoft says the invoice and meter
  records are the source of truth when billable processing and HTTP outcome disagree.

## Request, response, and freshness

- Azure OpenAI chat and Responses results expose input/prompt, output/completion, total, reasoning,
  audio, and cached-input token breakdowns on the applicable operation. Cache hits appear as
  `cached_tokens`. Prompt caching is automatic and has no opt-out on supported models.
- That response is not always a complete billing event. On `gpt-5.6` and later, cache writes can be
  billed and Standard pay-as-you-go responses report them as `cache_write_tokens`; older families
  do not have a separate write charge. Prompt caching defaults to implicit mode, while explicit mode
  without a breakpoint performs no cache read or write. Specialized image, video,
  speech, page, search, provisioned-capacity, and add-on meters also require their operation-native
  outcome or Azure meter telemetry; a generic token total cannot reconstruct them.
- Claude's native Messages response is stronger for cache accounting: it reports uncached input,
  cache-creation input, cache-read input, and output tokens. The exact public rate still depends on
  the deployment geography, and the net account charge still depends on a private offer.
- Cost Management data refreshes about every four hours, and Microsoft recommends querying a given
  scope/date range at most once per day because more frequent reports can be identical. Cost Details
  is asynchronous and cost rows are daily-rated aggregates. It is reconciliation evidence, not a
  hot-path cost oracle and must not drive per-request load balancing.
- Cost-aware routing should use the local first-party list/contract price sheet, the deployment
  inventory, and request parameters before dispatch; update later decisions from response usage and
  operational meter observations. Reconcile accumulated estimates against Cost Details and invoices.
  Output length, runtime cache behavior, fallback, and account benefits remain unknown before the
  request completes.

## Extraction and reconciliation

- The current implementation refreshes deterministically without an LLM: bounded Markdown-table
  grammars own catalog and delegated Claude prices; bounded same-host HTML-link discovery, fixed
  reviewed commercial pages, and an HTML-table grammar own Microsoft pricing-page regional maps;
  the portal transport owns a fixed registry/filter request and opaque
  continuation tokens; fixed OpenAPI operation/path and usage markers own response contracts; the
  Retail Prices transport follows every bounded page; provider metadata and subscription locations
  define the bounded ARM region set; exact direct ARM meter IDs own scoped joins; fixed policy
  phrases fail closed when accounting semantics change. Trailing-slash family links derive distinct
  source keys from their last non-empty path segment, so normal Azure URL style cannot collapse every
  discovered page into one cache key. Public rows currently normalize model usage, Batch/Priority
  variants, PTU capacity and reservations, Model Router markup, Responses and Agent tools, hosted
  agent runtime, managed compute, partner fine-tuning lifecycle terms, Content Safety, AI
  Evaluation, and Agent Prepurchase tiers. Their offers carry provider-native charge signals and
  Microsoft settlement; plans remain account-scoped enrollment.
- Page totals, continuation, source eligibility, and accepted-row counts are bounded. The current
  whole-source guard retains the prior accepted Azure provider instead of publishing a partial
  portal overlay; commercial extraction is claim-local inside that crash-atomic provider snapshot.
  A provisioned hourly page row remains raw when it cannot be joined uniquely to the exact catalog
  model/version; exact ARM/Retail capacity evidence is normalized instead. Model Router supported
  targets, spillover, integrated safety quantity, and private/account settlement similarly remain
  raw until an exact bounded target or signal is observed. The Retail API
  often leads the public catalog, abbreviates identities, or omits a version shared by several
  current rows. Those observations remain unbound or ambiguous instead of becoming guessed prices.
- Unknown-priced tuples are not necessarily parser failures. Portal-newer versions do not
  inherit a sibling's price merely because the family is shared. The unresolved set partitions into
  catalog-only partner/community versions, new Microsoft image/media and speech versions,
  legacy/deprecated tuples retained by lifecycle sources, and versioned or versionless Azure OpenAI
  rows for which neither Retail nor the public page publishes a unique exact binding. It includes
  exact IDs from Cohere, FLUX, Fireworks, Grok, Llama, MAI, Mistral, OpenAI audio/embedding, Sora,
  TimeGEN, and Tsuzumi. Upstream-provider prices and versionless third-party aliases are not Azure
  commercial evidence, so these remain unknown until Microsoft publishes an exact row or
  authenticated ARM exposes a matching meter ID.
- The missing Claude family was a genuine first-party extraction gap: Microsoft delegates the rate
  to Anthropic, and Anthropic publishes a Microsoft Foundry-specific CCU section. The dedicated
  overlay now normalizes 12 public price rows into 80 facts for 11 offered models, including the
  documented 1.1x US Data Zone variants for the three catalog models that advertise that deployment,
  while preserving promotion validity and private-offer uncertainty.
- ccusage is comparison-only and reads local coding-agent usage through an embedded/refreshed
  LiteLLM price snapshot; it does not read Azure deployments, Retail Prices, Cost Details, or CCU
  billing. LiteLLM currently exposes 319 `azure`, `azure_ai`, and `azure_text` aliases (219, 97, and
  3 respectively) from its community-maintained monolithic map; its hosted catalog rereads the
  GitHub map frequently, but that is publication freshness rather than upstream Azure discovery.
  models.dev exposes two manually curated overlapping books (`azure`: 82 and
  `azure-cognitive-services`: 68); its hourly sync workflow has no Azure provider adapter, so the
  Azure TOML files are not produced from Retail Prices or Location Models. Portkey's open books are
  broader (`azure-openai`: 167 and `azure-ai`: 258) and its gateways refresh the central JSON every
  24 hours, but the repository files are community-maintained, contain no per-row Azure source
  locator, and similarly flatten deployment/version/region scope. None can establish an account's
  meter binding or net charge. They may point to a real first-party rate, but that is useful only as
  a lead to the Microsoft/Anthropic source and never as evidence to fill this catalog.
