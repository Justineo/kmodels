# Microsoft Foundry

Status: current

## Sources and identity

- The non-exhaustive regional catalog is one atomic bundle of reviewed MicrosoftDocs catalogs, current and retired lifecycle tables, region matrices, and fixed stable and preview Azure OpenAI v1 specifications.
- IDs come only from labeled model cells. Identity is exact `model.name` plus optional `model.version`; never slugify or guess a version.
- Keep internal provider ID `azure`. Join versioned, versionless, and case-only evidence only when exact or unambiguous. Keep ambiguous versionless rows separate.
- Preserve exact, multi-valued service families: Azure OpenAI, Foundry Models sold by Azure, and partner/community models.
- Do not duplicate these rows into an `azure-openai` provider without a separate authoritative standalone catalog.
- Collect current USD consumption rates from the public, unauthenticated Azure Retail Prices API.
  Query the complete `Foundry Models` Consumption inventory and follow pagination; do not maintain a
  product-name allowlist. New Microsoft and Marketplace product families must therefore reach the
  extractor automatically. The inventory covers public Foundry meters across regions and SKUs; it
  does not establish negotiated discounts or subscription-specific availability.
- Collect Claude-in-Foundry rates from Anthropic's official pricing page. Its dedicated Microsoft
  Foundry section says Azure Marketplace CCU conversion uses the same public per-model and
  per-feature rates, with the same 1.1x US Data Zone multiplier. This is a delegated first-party
  price book, not a third-party registry. Keep Azure Marketplace private-offer discounts as raw
  account-specific uncertainty.
- Keep fixed Microsoft commercial-policy companions for Foundry cost attribution, Azure OpenAI
  prompt-cache accounting, Claude CCU billing, and Cost Management freshness. They are drift guards
  for what the numeric books can and cannot establish; they do not create prices by themselves.
- Enable optional ARM inventory with `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_SUBSCRIPTION_ID`, and `AZURE_LOCATION`. Missing credentials must not suppress public retail pricing.

## Mapping

- Tasks are non-exclusive and stay bound to the observed model/version.
- Attach Azure OpenAI endpoints only from Azure OpenAI catalog evidence or its exact batch matrix, validated against fixed operation/path specifications.
- Other Foundry rows do not inherit Azure OpenAI endpoints from a task or type.
- Keep exact `{region, deployment_type}` pairs, lifecycle versions, and replacements. The retired-model archive may mark an existing public tuple retired but never recreates an archive-only catalog row.
- Keep maturity separate from availability: Preview maps to `active` + `preview`, and GA maps to `active` + `stable`. Customer-facing Legacy and Deprecated map to canonical `legacy` and `deprecated`; customer-facing Retired maps to canonical `retired`.
- The Models API uses different lifecycle words: `Deprecating` means canonical `deprecated`, while API `Deprecated` means canonical `retired`. Its `deprecation.inference` value is the inference retirement date, not `deprecated_at`; once that exact date is effective, canonical status is `retired` even if a lifecycle label or public schedule row lags.
- A positive row in the current Assistants availability matrix establishes active support for that exact tuple. The retired-model archive takes precedence when the overview still carries a stale availability column.
- Retail SKU parsing is a reviewed provider grammar, not fuzzy matching. Azure OpenAI product
  families bind only to Azure OpenAI catalog rows. Reviewed partner and sold-by-Azure product
  families first constrain publisher/family scope and then match normalized ordered SKU tokens
  against current IDs, names, and documented aliases, with a small shared abbreviation, release
  suffix, and qualifier vocabulary. Pricing evidence never creates catalog rows.
- Normalize token, request/search, page, image, megapixel, time, and capacity units only when both
  the retail unit and a unique task/meter interpretation agree. In particular, Cohere rerank search
  units, document/OCR pages, and FLUX megapixels retain their provider-native denominator.
- Bind a retail row only to an exact catalog version, an existing versionless tuple, or the sole public version of a model. A versionless SKU shared by several versions remains unmodeled. When a SKU omits a meter dimension, a unique task-to-meter relation may supply it; text generation never guesses input versus output.
- Every returned Consumption row receives one reconciliation disposition. Fine-tuning, provisioned
  throughput, managed compute, Foundry Local, and free-meter rows are deliberately excluded from
  model base pricing; base rows are normalized, unbound, ambiguous, or unsupported. Interpretation
  is complete only when every row receives one reviewed classification. A separate 70% minimum over
  model-base rows requires a unique binding and normalized rate, while the reconciliation report
  preserves the exact unresolved denominator. This prevents an unmatched or versionless SKU from
  being guessed and prevents a plausible output-model count from hiding input-row loss.
- Preserve the retail region, deployment class, service tier, context tier, native unit, and effective-start label. The Retail Prices endpoint establishes that returned consumption rows are the current snapshot, so its effective-start label is retained as raw evidence rather than treated as a historical-only validity constraint.
- When one exact SKU family contains an unequal explicit long-context row, its otherwise identical unqualified row is the standard context tier. This reviewed pair rule does not apply to ambiguous or unmatched retail rows.
- Optional ARM inventory is subscription/region scoped. It may enrich exact model tuples and provides the strongest meter-ID join for that configured scope, but it cannot define the global catalog or the complete public price book.

## Public estimate and account-exact cost

- The Retail Prices API publishes Microsoft retail prices without discount. It is sufficient for a
  list-price estimate only after the gateway knows the exact deployed model/version, region,
  deployment SKU, meter, modality, context tier, cache outcome, batch/priority mode, and native
  quantity. The request's `model` value is normally a customer deployment name, so a deployment-to-
  model/version/SKU inventory join is required before applying the public book.
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
- That response is not always a complete billing event. On `gpt-5.6` and later, cache writes are
  billed but the usage response does not report cache writes separately. Specialized image, video,
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
  Claude prices; fixed OpenAPI operation/path and usage markers own response contracts; the Retail
  Prices transport follows every bounded page; exact meter IDs own authenticated ARM price joins;
  fixed policy phrases fail closed when accounting semantics change.
- The current first-party audit returned 223 public model/version tuples and 29,237 Foundry
  Consumption rows. The reviewed retail grammar normalized 19,110 source rows into 18,934 unique
  facts on 109 model tuples, excluded 4,803 non-base rows, and left 3,864 rows unbound, 1,446
  version-ambiguous, and 14 unsupported. The only unsupported signature is Azure's generic legacy
  `Az-GPT-3.5-turbo Tokens` meter, which does not say input versus output. Across the 177 active
  catalog tuples, the retail and delegated Claude books price 98 and leave 79 unknown. This is
  intentionally not presented as 100% price coverage: the Retail API often leads the public model
  catalog, abbreviates identities, or omits a version shared by several current catalog rows. Such
  rows stay visible in reconciliation instead of becoming guessed prices.
- The missing Claude family was a genuine first-party extraction gap: Microsoft delegates the rate
  to Anthropic, and Anthropic publishes a Microsoft Foundry-specific CCU section. The dedicated
  overlay now normalizes 13 public price rows into 85 facts for 12 offered models, including the
  documented 1.1x US Data Zone variants for the three catalog models that advertise that deployment,
  while preserving promotion validity and private-offer uncertainty.
- ccusage is comparison-only and reads local coding-agent usage through an embedded/refreshed
  LiteLLM price snapshot; it does not read Azure deployments, Retail Prices, Cost Details, or CCU
  billing. LiteLLM currently exposes hundreds of `azure`, `azure_ai`, and `azure_text` aliases,
  including regional and media variants; models.dev exposes two overlapping Azure provider books.
  Both flatten or duplicate deployment/version dimensions and cannot establish an account's meter
  binding or net charge. They may point to a real first-party rate, but that is useful only as a lead
  to the Microsoft/Anthropic source and never as evidence to fill this catalog.

## Kong AI Gateway

Compatibility requires all of:

1. Azure OpenAI service-family evidence.
2. An exact endpoint for the requested operation.
3. Active lifecycle and acceptable maturity.
4. A compatible region/deployment pair.
5. The user's deployment-name binding.

Legacy Completions in the service specification is not model support without an exact positive relation.
