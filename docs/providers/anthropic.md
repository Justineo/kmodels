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
- [Web Search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool) for the
  successful-search rate and `usage.server_tool_use.web_search_requests`;
- [Code Execution](https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool)
  for compatible model IDs, container-hour rate, minimum duration, allowance, and the qualifying
  web-tool condition;
- [Messages](https://platform.claude.com/docs/en/api/messages/create),
  [Advisor](https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool),
  [compaction](https://platform.claude.com/docs/en/build-with-claude/compaction), and
  [fallback credit](https://platform.claude.com/docs/en/build-with-claude/fallback-credit) for
  request outcome accounting;
- [model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations), model
  ID/version guidance, release notes, and feature guides for identity, lifecycle, and capability
  facts.

Every companion is optional at transport time. A missing companion does not reject the root model
catalog. When any companion is omitted, the collector retains the last verified facts owned by this
source and marks the pricing refresh incomplete rather than publishing unknown regressions or a
partially rebuilt price book. Duplicate documents remain invalid because their provenance is
ambiguous. Malformed rows and individual claims are skipped or reported without rejecting
independent rows.

The optional authenticated `GET /v1/models?limit=1000` inventory can fill otherwise unknown public
fields on matching rows. Enable it with `ANTHROPIC_API_KEY`; it never creates public catalog rows or
overrides known first-party facts. Additive response fields are accepted with a contract signal, and
one malformed inventory item is skipped without rejecting recognized sibling rows.

## Identity and catalog mapping

- IDs and aliases come from labeled official cells or exact API values. A display-name join is used
  only when it resolves to one known ID.
- Current and historical official IDs remain in the catalog. Lifecycle state and release maturity
  are independent.
- Messages applies to active and not-yet-retired callable IDs. Batches applies to active IDs when
  the Batch contract says all active models are supported.
- Capability claims are taken from their specific first-party compatibility lists or universal
  statements. A missing or changed statement leaves that fact unknown; it does not turn absence
  into `false`.
- A newly published model is admitted mechanically from official IDs. Family names are not an
  allowlist.

## Model rates and dimensions

Each exact model has two offers when supported:

- `sync`: ordinary Messages inference;
- `batch`: Message Batches.

Cache TTL, Fast speed, inference geography, and dated validity are shared rate dimensions rather
than separate provider-specific schemas. Batch is an offer because it is a distinct asynchronous
execution mechanism; separate offers already express the caller's choice, so no redundant
exclusivity relation is emitted. The US-only inference multiplier is applied only when the
generation threshold in pricing agrees with the data-residency contract.

Published cache columns are checked against the published multipliers. Conflicting facts are
reported and the directly published row remains authoritative. A model without an exact published
row stays price-unknown; rates are never inherited from a family or replacement model.

## Request services

### Web Search

One service offer publishes USD 10 per 1,000 successful searches. The same rate applies in Messages
and Batches, so duplicating it into sync and Batch offers would add no information. The charge binds
to `usage.server_tool_use.web_search_requests`; failed searches are not billed. Search-result tokens
remain ordinary model input usage.

### Code Execution

Two service states are sufficient:

- `standalone`: USD 0.05 per container-hour, a five-minute minimum, and 1,550 free
  container-hours per organization per month;
- `web-assisted`: included when the request contains a qualifying Web Search or Web Fetch tool
  version.

The public Messages outcome reports code-execution request count, not billable container duration.
The rate and known total-cost parameters therefore remain visible, but the runtime rate has no false
per-request charge binding. Exact cost needs provider accounting or another authoritative duration
signal.

## Iteration accounting

Advisor, compaction, and server fallback do not need parallel service books:

- Advisor is a separate model inference billed at the selected advisor model's ordinary rates.
- Compaction is an additional sampling iteration billed at the same selected model rates.
- A credited fallback retry already changes returned cache-write and cache-read usage; no separate
  credit allowance should be added.

When `usage.iterations` is absent, price the response model from top-level usage. When it is present,
price each typed iteration using that iteration's exact model and do not add the top-level token
totals again. This handles executor, advisor, compaction, and fallback work through the normal model
books. Cache-write variants bind only when the response exposes an exact TTL split; a generic cache
creation total must not be guessed into the five-minute or one-hour rate.

## Refresh and comparison policy

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
