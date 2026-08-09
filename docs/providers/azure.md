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
  indirection and fine-tuning-only page, and fetch the Azure OpenAI page as a fixed companion. This
  makes a newly published family reach the extractor without a manifest edit while a removed index,
  path change, or implausible family count fails closed. Read the embedded regional decimal maps
  rather than the client-rendered `$-` placeholders. This source is the production fallback for
  model IDs and version groups that the Retail SKU vocabulary cannot bind.
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
- Every returned Consumption row receives one reconciliation disposition. Fine-tuning, provisioned
  throughput, managed compute, Foundry Local, and free-meter rows are deliberately excluded from
  model base pricing; base rows are normalized, unbound, ambiguous, or unsupported. Interpretation
  is complete only when every row receives one reviewed classification. A separate 70% minimum over
  model-base rows requires a unique binding and normalized rate, while the reconciliation report
  preserves the exact unresolved denominator. This prevents an unmatched or versionless SKU from
  being guessed and prevents a plausible output-model count from hiding input-row loss.
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

- Refresh is deterministic and non-LLM: bounded Markdown-table grammars own catalog and delegated
  Claude prices; bounded same-host HTML-link discovery and an HTML-table grammar own Microsoft
  pricing-page regional maps; the portal transport owns a fixed registry/filter request and opaque
  continuation tokens; fixed OpenAPI operation/path and usage markers own response contracts; the
  Retail Prices transport follows every bounded page; provider metadata and subscription locations
  define the bounded ARM region set; exact direct ARM meter IDs own scoped joins; fixed policy
  phrases fail closed when accounting semantics change. Trailing-slash family links derive distinct
  source keys from their last non-empty path segment, so normal Azure URL style cannot collapse every
  discovered page into one cache key.
- Page totals, continuation, source eligibility, and accepted-row counts are bounded; drift retains
  the prior accepted Azure provider instead of publishing a partial portal overlay. The Retail API
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
