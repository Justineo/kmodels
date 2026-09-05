# Databricks

Status: current

## Product boundary

Kmodels publishes Databricks-hosted Foundation Model API rates that an AI Gateway can attribute to
one upstream invocation. It is not a Databricks product catalog or account invoice model.

Admitted facts are:

- pay-per-token input, output, embedding, cache-read, and cache-write rates;
- request-visible endpoint geography, context tier, service tier, promotion, and effective dates;
- Priority rates when the official model-qualified row publishes an amount; and
- exact Google pass-through image/text rates only where a Databricks model section explicitly
  delegates to a uniquely anchored first-party Google pricing section.

The following are outside the rate-book boundary and are not preserved as raw or unknown pricing:

- provisioned throughput and CPU/GPU capacity;
- `ai_query` Batch DBU-per-hour compute, because the billable duration is a Databricks job/account
  quantity rather than a proxied request or completed asynchronous inference-item quantity;
- training, AI Runtime, storage, ingestion, subscriptions, commitments, and credits;
- Unity AI Gateway logging/observability, Agent Bricks, Agent Evaluation, Genie, and other platform
  orchestration products;
- account DBU-to-currency settlement, discounts, invoices, and private prices; and
- AI Search compute/storage and its reranker surcharge. Reranking is request-selected, but the
  official price is part of an index query whose base compute/storage cost cannot be reconstructed
  from that request alone, so publishing only the surcharge would understate the operation.

DBU remains the denomination exactly as Databricks publishes it. Kmodels does not apply a universal
DBU-to-USD multiplier. A Gateway can accumulate DBU usage from request results; currency settlement
remains account-specific and outside this public rate book.

## Official source bundle

The deterministic public collector uses the supported-model page plus these fixed official
companions:

- Foundation Model overview and regional support;
- lifecycle policy;
- open and proprietary Foundation Model Serving pricing pages;
- Priority-mode support;
- Foundation Model limits and REST API reference;
- model-type/route matrix;
- exact Google pricing sections used by the two delegated image endpoints; and
- the release feed.

Commercial product cards, system billing tables, account list-price tables, and unrelated AI
product pages are not fetched. They cannot establish an admitted request rate and previously made
the provider refresh depend on dynamic commercial content outside the product boundary.

The optional documented `GET /api/2.0/serving-endpoints` source is workspace-scoped inventory. It
may observe task and modality facts but cannot add or remove public catalog rows, publish private
workspace data, or establish public prices. Enable it with `DATABRICKS_HOST` and
`DATABRICKS_TOKEN`. The undocumented `serving-endpoints:foundation-models` route is not a refresh
dependency.

## Identity and model facts

- Callable identity comes only from a labeled `Endpoint name:` in the official supported-model
  page. Pricing cannot create model rows.
- General-purpose and Embeddings route rows retain the exact
  `POST /serving-endpoints/{name}/invocations` API contract. Repeated IDs, ambiguous joins, or an
  unknown ID in an exhaustive catalog-support table reject that catalog claim.
- Lifecycle affects this catalog only when the official row publishes a pay-per-token date. A
  provisioned-throughput-only retirement does not retire the callable pay-per-token endpoint.
  Documented redirects keep the old ID deprecated through the redirect interval.
- Release-feed links may supply exact dates. Missing dates remain unknown.
- Databricks delegates partner-model limits to their originating providers, but Kmodels does not
  copy values through fuzzy cross-provider name matching.

## Pricing parsing and conflict rules

- Current pricing pages separate Standard and Priority DBU-per-million-token tables from hourly
  Provisioned Throughput and Batch Inference tables. Read the reviewed token headers and their
  column order, including the optional row qualifier and one-hour cache-write column; discard
  hourly compute tables. Comma-separated version labels expand to exact catalog matches.
- Unqualified token cells normalize to numeric rates. New regional-uplift and promotion markers,
  context/modality row qualifiers, and cache-write duration alternatives retain their published
  amounts, column labels, tier, qualifiers, and pricing notes as raw facts until their complete
  applicability can be normalized. Never strip a footnote marker and publish an unconditional
  rate. An observed Priority amount, including a raw conditional amount, suppresses the fallback
  claim that no Priority amount was published. Stage a complete tiered page before applying it so
  a changed table cannot leave a partially interpreted page behind.
- The reviewed combined-table layout remains supported by deterministic fixtures. Its open-model
  rows publish only input, output, cache-read, and embedding rates. Capacity columns are
  recognized as out of scope and discarded. Its proprietary-model rows publish only input,
  output, cache-write, and cache-read rates. The
  DBU-per-hour Batch column is recognized as out of scope and discarded. The reviewed provider
  groups are OpenAI, Anthropic, Google, and the optional `SpacexAI` group used for Grok rows.
- Standard pay-per-token uses `service_tier=standard`. Priority is a variant of the same invocation
  offer. Numeric variants are keyed by the tier actually served plus any published region or
  endpoint condition. Account-team enablement is an access prerequisite, not a price dimension, so
  it is not encoded. A requested Priority tier is not proof of the billed tier when Databricks
  documents fallback to Standard, and the documented response tier echoes the request rather than
  proving the billed fallback outcome.
- The Priority support page publishes exact eligible Databricks endpoint IDs and says that the tier
  has a per-token premium, but it publishes no amounts for partner models. Its OpenAI and Google
  links are additional product-behavior resources, not a statement that Databricks invoices those
  providers' USD prices. Kmodels therefore keeps those Priority variants as `unknown_amount` until
  a Databricks model-qualified DBU row appears. It does not infer a multiplier from Qwen's separate
  two-times row, copy upstream USD rates, or assume a universal DBU-to-USD conversion.
- An exact model-qualified Priority DBU row is sufficient price evidence even when the support page
  has not yet listed that endpoint. In that case Kmodels retains only the published
  `service_tier=priority` condition; it does not invent region, routing, or fallback conditions.
- Reviewed combined-table promotion percentages, validity dates, launch targets, and referenced
  Standard-rate families are parsed from first-party footnotes. New tiered-table annotations use
  the raw fallback above. Model IDs, rates, and dates are not hard-coded.
- Blank, `-`, `n/a`, and `Coming soon` cells publish no numeric rate. One malformed amount loses only
  that numeric amount; tiered tables retain its raw evidence. A malformed pricing page loses only that page; catalog identity and the independent
  pricing page survive.
- Rows bind through a unique reviewed label. Zero-match rows are out-of-catalog observations;
  ambiguous matches are never guessed.
- Same-scope conflicting numeric observations are retained for canonical conflict resolution. They
  do not erase valid sibling meters.

## Canonical projection

Every priced model has one `pay-per-token` offer. Endpoint geography, context band, Priority,
promotion, and validity remain applicability dimensions rather than separate offers. There are no
Databricks provider-resource books, capacity books, settlement facts, allowances, resource edges,
or offer relations.

The API reference publishes five calculation-input contracts from the non-streaming response:

- `usage.prompt_tokens` and `usage.completion_tokens` for aggregate input and generated tokens;
- `usage.reasoning_tokens` as the reasoning subset, even though Databricks publishes no separate
  reasoning-token rate;
- top-level `usage.cache_read_input_tokens` and `usage.cache_creation_input_tokens` for
  Databricks-hosted Claude endpoints.

Embedding input binds directly to `usage.prompt_tokens`. Ordinary text output binds directly to
`usage.completion_tokens`. An input rate with no separately priced cache partition also binds
directly to `usage.prompt_tokens`. For Claude rows with cache-read or cache-write rates, uncached
input uses the closed calculation
`max(0, max(0, prompt_tokens - cache_read_input_tokens) - cache_creation_input_tokens)`; the cache
rates bind to their corresponding fields. The two optional cache fields use absent-as-zero only
because the reference limits them to responses where caching is active.

The same fields do not become cache acquisition paths for OpenAI, Google, Grok, or open-model rows:
the official reference qualifies the top-level cache fields specifically to hosted Claude
endpoints. Their cache rates retain quantity semantics but remain without an acquisition method.
Likewise, the aggregate usage object does not split text and image tokens. A model with separate
text/image input or output rates therefore keeps those modality quantities unbound instead of
charging the aggregate count more than once.

`usage.prompt_tokens` also resolves context-length conditions. Numeric Standard and Priority
variants use `served_service_tier`. The documented response `service_tier` only echoes whether
Priority was requested, while Priority can fall back and be billed as Standard, so it is not
published as the billed-tier selector. The caller must supply that outcome until Databricks
publishes a billing-grade field. Region and endpoint-type conditions likewise remain caller-supplied
because the response exposes no matching field.

The API documents optional token usage in streams but does not define a stable terminal event or
cumulative reduction. Kmodels therefore publishes no stream acquisition path and does not claim to
detect interrupted streams. These bindings describe how a consumer can supply quantities to the
price book; they do not make Kmodels responsible for observing the runtime lifecycle or reconciling
an invoice.

## Resilience and refresh

Catalog support tables remain strict where they claim exhaustive identity or invocation contracts.
Individual response usage fields are field-local contracts: drift removes only the affected
`pricing_input` and quantity method while preserving independent catalog and rate facts.
Open, partner, Priority, and delegated Google pages are optional pricing dependencies: a fetch
failure keeps catalog collection useful but retains the last accepted Databricks pricing partition.
Within a fetched page, parsing is claim-local; malformed rows and cells do not reject valid siblings.
Newly listed callable models may remain with unknown pricing, and pricing coverage is diagnostic
rather than an admission threshold.

Refresh is pure code with no LLM, fuzzy matching, or comparator dependency. First-party pages are
the publication authority; models.dev and LiteLLM may be used only to audit coverage or reveal
possible parser gaps.
