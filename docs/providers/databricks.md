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

- Open-model rows publish only input, output, cache-read, and embedding rates. Capacity columns are
  recognized as out of scope and discarded.
- Proprietary-model rows publish only input, output, cache-write, and cache-read rates. The
  DBU-per-hour Batch column is recognized as out of scope and discarded.
- Standard pay-per-token uses `service_tier=standard`. Priority is a variant of the same invocation
  offer. The request's tier plus any published region or endpoint condition selects the public
  rate. Account-team enablement is an access prerequisite, not a price dimension, so it is not
  encoded. A requested Priority tier is not proof of the billed tier when Databricks documents
  fallback to Standard; response usage is authoritative.
- Promotion percentages, validity dates, launch targets, and referenced Standard-rate families are
  parsed from first-party footnotes. Model IDs, rates, and dates are not hard-coded.
- Blank, `n/a`, and `Coming soon` cells publish no numeric rate. One malformed amount loses only
  that amount. A malformed pricing page loses only that page; catalog identity and the independent
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

Token terms bind to direct response usage:

- input and embedding → `usage.input_tokens`;
- cache read → `usage.token_details.cache_read_input_tokens`;
- cache write → `usage.token_details.cache_creation_input_tokens`; and
- output → `usage.output_tokens`.

The binding documents how a Gateway counts the rate; it does not perform invoice calculation.

## Resilience and refresh

Catalog support tables remain strict where they claim exhaustive identity or invocation contracts.
Open, partner, Priority, and delegated Google pages are optional pricing dependencies: a fetch
failure keeps catalog collection useful but retains the last accepted Databricks pricing partition.
Within a fetched page, parsing is claim-local; malformed rows and cells do not reject valid siblings.
Newly listed callable models may remain with unknown pricing, and pricing coverage is diagnostic
rather than an admission threshold.

Refresh is pure code with no LLM, fuzzy matching, or comparator dependency. First-party pages are
the publication authority; models.dev and LiteLLM may be used only to audit coverage or reveal
possible parser gaps.
