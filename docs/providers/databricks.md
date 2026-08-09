# Databricks

Status: current

## Reviewed official surface

- The public AWS regional catalog is one atomic bundle: the supported-model details page plus 17
  fixed official companions for task/route support, regional availability, lifecycle, limits,
  Standard and Priority pricing, delegated Google image pricing, releases, direct response usage,
  both generations of AI Gateway usage, billable usage, list prices, model-serving SKUs, system-table
  freshness, and cost attribution. A refresh fetches and validates the complete bundle without an
  LLM.
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
  no numeric rate is published; any other non-decimal value, malformed span, non-rectangular table,
  or conflicting amount for the same commercial scope rejects the refresh.
- Promotion percentages, validity dates, launch targets, and referenced Standard-rate families are
  parsed from the footnotes. Calendar-invalid dates reject the source. Every matched starred row
  must be explained by a parsed note; no model IDs or promotion dates are hard-coded.
- Standard pay-per-token uses `service_tier=standard`. Priority support comes from the exact
  endpoint-ID table. Qwen 3.5's published Priority row is the sole exact numeric Priority price and
  retains its `ap-south-1` plus account-enablement conditions. Fifteen other supported rows carry an
  `unknown_amount` Priority fact because Databricks publishes only that Priority costs more.
  Priority capacity can fall back to Standard and is then billed at Standard rates, so a requested
  or echoed Priority tier does not prove the billed tier.
- At least 80% of non-retired catalog rows must retain a numeric price after all joins. The lower
  bound tolerates explicitly listed new models before their price-book row appears while rejecting
  broad table or identity drift.

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
