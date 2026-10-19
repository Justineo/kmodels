# Anthropic

Status: current

## Boundary

The Anthropic partition describes rates that an AI Gateway can attribute to direct Claude API
generation requests. It uses the shared canonical price model; Anthropic-specific behavior is
expressed only through dimensions, applicability, and usage signals.

Included:

- Messages model input, prompt-cache write/read, and output rates;
- Message Batches as an alternative execution mechanism;
- request-selected Fast mode and inference geography;
- Web Search as a separately metered server-side request service;
- standalone Code Execution runtime, its minimum duration and public organization allowance, plus
  the included state when a qualifying web tool is present.

Excluded:

- training, storage, capacity commitments, subscriptions, credits, invoices, marketplace
  settlement, private discounts, and other account administration;
- free management or preflight APIs such as Files and token counting, because they do not add a
  generation-request charge;
- Managed Agents session runtime, because it is a separate agent/session product rather than a
  direct model generation request.

Web Fetch has no marginal service rate beyond returned model tokens, so it does not need a separate
price book. Client tools and remote MCP servers likewise have no Anthropic price unless Anthropic
publishes a separately metered provider service.

## Official sources

The public catalog root is the official [model overview](https://platform.claude.com/docs/en/about-claude/models/overview).
The collector follows a fixed set of first-party documents rather than discovering commercial pages
from `llms.txt` or scraping the dynamic `claude.com/pricing` application.
Model-specific launch announcements are not refresh dependencies: maintained overview and release
notes own current identity, descriptions, and release dates.

The main pricing and accounting sources are:

- [detailed pricing](https://platform.claude.com/docs/en/about-claude/pricing) for model, Batch,
  Fast, cache, geography, and published tool rates;
- [prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) for nested
  five-minute/one-hour cache-write counters and mixed-TTL iteration accounting;
- [Web Search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool) for the
  successful-search rate and `usage.server_tool_use.web_search_requests`;
- [Code Execution](https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool)
  for compatible model IDs, container-hour rate, minimum duration, allowance, and the qualifying
  web-tool condition;
- [Messages](https://platform.claude.com/docs/en/api/messages/create),
  [Advisor](https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool),
  [compaction](https://platform.claude.com/docs/en/build-with-claude/compaction), its
  [threshold accounting guide](https://platform.claude.com/docs/en/build-with-claude/compaction-threshold), and
  [fallback credit](https://platform.claude.com/docs/en/build-with-claude/fallback-credit) for
  request outcome accounting. These contracts are extracted as pricing-input facts independently
  from the rates, not encoded as informational raw prices;
- [model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations), model
  ID/version guidance, release notes, and feature guides for identity, lifecycle, and capability
  facts.

Every companion is optional at transport time. A missing companion does not reject the root model
catalog. When any companion is omitted, the collector retains the last verified facts owned by this
source and marks the pricing refresh incomplete rather than publishing unknown regressions or a
partially rebuilt price book. Duplicate documents remain invalid because their provenance is
ambiguous. Malformed rows and individual claims are skipped or reported without rejecting
independent catalog rows. A price whose model/offer scope can be bound keeps its readable cells and
raw evidence for unreadable cells. A missing commercial matrix or an unbound model/service scope
signals a pricing dependency failure: catalog facts survive, while collection retains the accepted
complete pricing partition and replay input instead of publishing a partial replacement.

Provider services, pricing-input facts and vocabulary belong to the source independently of model
observations. An unreadable model-price matrix cannot discard established service prices or
accounting contracts. Explicit resource model references establish compatibility; independent
accounting evidence does not establish a model price.

The optional authenticated `GET /v1/models?limit=1000` inventory can fill otherwise unknown public
fields on matching rows. Enable it with `ANTHROPIC_API_KEY`; it never creates public catalog rows or
overrides known first-party facts. Additive response fields are accepted with a contract signal, and
one malformed inventory item is skipped without rejecting recognized sibling rows.

## Identity and catalog mapping

- IDs and aliases come from labeled official cells or exact API values. A display-name join is used
  only when it resolves to one known ID. Exact canonical IDs take precedence over aliases and
  display labels. An explicit unknown ID cannot fall back to a different revision. Reviewed label
  normalization preserves word and version order; a unique observed dated-ID stem can match a
  display label, but rearranged tokens cannot establish identity. Joins do not rename catalog rows.
- Current and historical official IDs remain in the catalog. Lifecycle state and release maturity
  are independent.
- Repeated overview observations distinguish missing fields from conflicting known values. Missing
  limits or metadata cannot erase known siblings; a third matching observation cannot clear a
  conflict. Conflicting names use the API ID as the display fallback; conflicting descriptions,
  reasoning and overview states remain unknown with a source-contract finding. Exact lifecycle and
  capability documents can independently establish their owned fields. Limit observations include
  the explicit shared-specification statement and exact model mentions in pricing's context claim;
  model-name prefixes do not establish that claim.
- Current lifecycle tables bind fields by their headers and contribute all recognized rows. Dates
  require real calendar values and agreement across peers. Current explicit states take precedence
  over inferred historical states; conflicting explicit states remain unknown. A known deprecated
  model advances to retired when its agreed retirement date has passed. Replacement IDs and valid
  retirement dates survive an unreadable historical announcement date. Historical dates belong to
  the nearest enclosing reviewed announcement heading and cannot cross a later section boundary.
- Messages applies to active and not-yet-retired callable IDs. Batches applies to active IDs when
  the Batch contract says all active models are supported.
- Capability claims are taken from their specific first-party compatibility lists or universal
  statements. A missing or changed statement leaves that fact unknown; it does not turn absence
  into `false`.
- The model overview's explicit statement that all current models support tool use owns the
  current `tool_call` capability. The optional thinking troubleshooting table supplies exact
  per-model adaptive/extended thinking support when the overview guide no longer lists model IDs.
- Feature guides may put exact compatible IDs in the bounded YAML
  `featureMetadata.supportedModels` list. Read that field structurally, retaining the reviewed
  legacy inline list. Neither surrounding frontmatter nor a display name establishes compatibility.
- A newly published model is admitted mechanically from official IDs. Family names are not an
  allowlist, including in release notes. Release-date headings reset at other sections; a launch
  below an unrelated heading cannot inherit the previous date.

## Model rates and dimensions

Each exact model has two offers when supported:

- `sync`: ordinary Messages inference;
- `batch`: Message Batches.

Fast speed, inference geography, and dated validity are shared rate dimensions. Exact five-minute
and one-hour cache-write rates become separate logical terms with TTL-specific quantity signals,
because one request may contain both TTLs. A global TTL selector must not select only one charge.
Unrecognized TTL prices keep their original qualified/raw scope. Batch is an offer because it is a
distinct asynchronous execution mechanism; separate offers already express the caller's choice, so no redundant
exclusivity relation is emitted. The US-only inference multiplier is applied only when the
generation threshold in pricing agrees with the data-residency contract.

The same bucket distinction applies to a raw price in an explicitly reviewed five-minute or
one-hour column: its term key and native evidence retain the bucket, but a global TTL selector cannot
dismiss that potentially simultaneous charge. Unreviewed TTL scopes remain qualified.

All recognized standard, Batch and Fast matrices contribute rows. Monetary columns bind by their
reviewed headers rather than column position. A well-shaped row parses each cell independently:
unsupported amounts, denominations, units and columns retain raw evidence without discarding known
sibling prices. An irregular row retains its whole native fragment while independent rows survive.
Literal code and price expressions survive Markdown formatting;
formatting cannot turn an expression into a scalar. Reviewed `$… / MTok` and `$… USD / MTok`
spellings are accepted. One source row has one reconciliation disposition even when a Fast row
names multiple models. Conflicting published prices remain distinct through canonical assembly.

Published `through` and `starting` dates use real calendar validation, including leap years. An
unreadable date or unreviewed parenthetical condition keeps the quote raw; it cannot become an
unqualified promotional or ordinary rate.

Published cache columns are checked against the published multipliers, including a source-published
per-model cache-read override. Multiple semicolon-separated override groups remain independent;
each group binds only its explicitly named models through the exact identity resolver. Overrides
use model IDs internally, independently of display-name availability. An unbound override withholds
the read policy instead of silently deriving the default read price; independent write factors
survive. Fast-mode compatibility is checked against the union of all published Fast rows, not
against each row in isolation.
Conflicting facts are reported and the directly published row remains
authoritative. Cache policy rows are validated independently across all reviewed policy tables;
conflicting or unreadable operations withhold only their derived rates. Known sibling multipliers
remain usable, and missing, malformed or unreviewed policy content remains raw at the affected
tariff scope. Geography multipliers likewise require agreement. When a multiplier or generation
threshold is unresolved, affected known rates remain explicitly global and the possible US charge
remains raw, preventing global rates from silently pricing US inference.
Generation parsing accepts multiword family names without a family allowlist. An ID without a
reviewed numeric generation leaves US eligibility raw and known default rates explicitly global.
Pricing headers are matched case-insensitively; a trailing numeric note marker on an otherwise exact
`MTok` cell is parsed only as source annotation. A model without an exact published row stays price-unknown; rates are
never inherited from a family or replacement model.

Fast prices use the served speed when available, through the typed `/usage/speed` response mapping.
The [Fast-mode contract](https://platform.claude.com/docs/en/build-with-claude/fast-mode) documents
`fast` and `standard` outcomes, including an Opus 4.6 request that asks for Fast but runs at standard
speed. Request intent alone cannot establish the charged speed. Mapping drift withholds only that
acquisition path, independently of published Fast rates.

## Request services

Service amounts and Code Execution rules belong to a unique `Usage and pricing` section. Examples
elsewhere cannot set a rate. Repeated reviewed amounts and minimums must agree, and monthly
allowances require valid integer grouping and agreement. Unsupported or conflicting service
amounts, minimums and allowances retain the native section as raw evidence while known independent
service facts survive. A service rate does not depend on acquiring its usage counter.

### Web Search

One service offer publishes USD 10 per 1,000 successful searches. The same rate applies in Messages
and Batches, so duplicating it into sync and Batch offers would add no information. The charge binds
to the provider-owned successful-search signal and maps it to the terminal response field
`/usage/server_tool_use/web_search_requests`; failed searches are not billed. Search-result tokens
remain ordinary model input usage. An interrupted stream that never yields terminal usage remains
unresolved for the downstream calculator rather than being guessed from emitted tool blocks.

### Code Execution

Two service states are sufficient:

- `standalone`: USD 0.05 per container-hour, a five-minute minimum, and 1,550 free
  container-hours per organization per month;
- `web-assisted`: included when the request contains a qualifying Web Search or Web Fetch tool
  version.

The public Messages outcome reports code-execution request count, not billable container duration.
The runtime rate therefore binds to an account-phase `code_execution_active_seconds` requirement,
not to that request count. A closed quantity calculation applies the five-minute minimum per
provider-owned Code Execution container and produces `code_execution_billable_seconds`. That
quantity method deliberately has no `input_sources`: exact request cost still requires Anthropic
accounting or another authoritative duration signal. The source parser constructs this typed
quantity calculation and the monthly allowance directly from recognized commercial numbers.
Services, usage inputs and vocabulary are independent source facts, without a model carrier.
Commercial assembly does not decode raw term keys or fragments to recover these rules. Conflicting
or unreadable minima and allowances remain passive raw evidence with local incomplete-cost behavior.

## Iteration accounting

Advisor, compaction, and server fallback do not need parallel service books:

- Advisor is a separate model inference billed at the selected advisor model's ordinary rates.
- Compaction is an additional sampling iteration billed at the same selected model rates.
- A credited fallback retry already changes returned cache-write and cache-read usage; no separate
  credit allowance should be added.

When `usage.iterations` is absent, price the response model from top-level usage. When it is present,
price each typed iteration using that iteration's exact model and do not add the top-level token
totals again. This handles executor, advisor, compaction, and fallback work through the normal model
books. Cache-write variants use a TTL-specific signal only when the price establishes that exact TTL;
the generic cache-creation response total must not be mapped to either the five-minute or one-hour
signal.

Each bound token rate publishes one direct quantity method with conditional response mappings for
the independently evidenced top-level usage field and `usage.iterations[*]` grouped by its reported
advisor model or the response model for ordinary/compaction iterations. Ordinary and compaction
entries do not report their own `model` in the reviewed example. If one field drifts, only that
mapping disappears; the price and any sibling mapping remain.
Messages mappings require the reviewed operation and a unique returned `usage: Usage` object.
Only its direct, uniquely declared fields with the reviewed types establish `/usage/*` locators.
Request fields, quoted code, unrelated objects, nested lookalikes and contradictory duplicates cannot establish
those paths. An unrelated nested lookalike cannot invalidate a valid direct field.
Reviewed nullable and optional wrappers retain conditional acquisition; a null counter is not
invented zero usage. The [official SDK Usage contract](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/resources/messages/messages.ts)
also confirms the nullable cache, geography, server-tool and served-tier fields.

Iteration counters require numeric, nonnegative safe-integer values at the actual usage path in
reviewed JSON examples, with `message`, `compaction`, or an `advisor_message` carrying a valid model
ID. The general compaction billing rule establishes aggregation, not arbitrary child fields. The
[threshold guide](https://platform.claude.com/docs/en/build-with-claude/compaction-threshold) example
establishes iteration input/output counts, but does not by itself establish iteration cache reads.
Top-level and iteration mappings are acquired independently. The Web Search guide likewise must
establish numeric `usage.server_tool_use.web_search_requests`, rather than merely mentioning it.
Cache-write rates bind distinct five-minute and one-hour signals to
`usage.cache_creation.ephemeral_5m_input_tokens` and
`usage.cache_creation.ephemeral_1h_input_tokens`, plus the corresponding typed
`usage.iterations[*].cache_creation` fields grouped by model. The prompt-caching contract establishes
that the aggregate cache-creation count is the sum of those buckets. JSON fences accept the upstream
`Output` label. Reduced reviewed JSON examples
and that partition statement establish each mapping independently; a renamed/missing bucket withholds
only its mapping. Missing buckets remain missing, never zero, and the aggregate is never substituted
for either TTL. The extractor version is advanced with this contract change.
An unreadable top-level TTL counter does not erase an independently evidenced typed iteration
counter; an unreviewed iteration type cannot acquire model attribution from another example.
OTel aggregate token attributes are not attached to these Anthropic-owned signals because they
cannot preserve both iteration ownership and cache-write TTL; a downstream integration may use
OTel only after proving those distinctions remain available.

## Refresh and comparison policy

Pricing reconciliation counts native tariff rows and billing rules, including excluded token
overhead. Catalog, endpoint and usage-acquisition diagnostics use the source-contract channel;
changing a usage field or lifecycle date cannot inflate the price-item denominator. Successful
usage mappings are carried as pricing-input facts rather than counted as normalized prices.

The stable Markdown pricing page is authoritative for the collected matrix. Dynamic marketing or
application pages are not refresh dependencies. Markdown frontmatter and other content before a
reviewed API heading are tolerated. Endpoint headings may use one or two `#` markers and
case-varying method labels, while the exact operation name, method, and path remain checked. The
overview accepts combined or split thinking rows across one or more `Feature` matrices, and
capability guides may publish exact supported IDs as a list or table. A source wording change
becomes a localized reconciliation finding; a single unreadable model row or service claim does not
reject the provider.

`models.dev` and LiteLLM are useful comparison inputs for detecting possible coverage gaps. They do
not create Anthropic IDs or prices and never override a current official conflict.
