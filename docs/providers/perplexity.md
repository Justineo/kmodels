# Perplexity

Status: implemented

## Sources and scope

The official [API pricing page](https://docs.perplexity.ai/docs/getting-started/pricing) owns current
native model rates and independently priced services. The linked
[Sonar model index](https://docs.perplexity.ai/docs/sonar/models) establishes exact Sonar IDs;
embedding tables publish exact callable IDs directly. The adapter reads Markdown tables and model
links without executing MDX, calculator widgets, or embedded JavaScript.

The source is non-exhaustive. It covers Sonar, Sonar Pro, Sonar Reasoning Pro, Sonar Deep Research,
the standard and contextualized embeddings, Search API, and Agent API tool fees. Third-party
Router/Agent model rate cards, subscriptions, credit purchases, negotiated prices, and tax are not
copied from another provider or represented as native Perplexity inference prices. Agent tool
service books do not claim compatibility with Sonar model books.

## Price composition

- Sonar, Sonar Pro, and Sonar Reasoning Pro add input/output token charges and a per-request fee
  selected by low, medium, or high search context.
- Sonar Pro also selects the realized `fast` or `pro` search effort. `auto` is a request-time
  classifier, so its actual classification selects one of those prices. It is not a third fee.
- Deep Research adds five independently priced quantities: input tokens, answer output tokens,
  citation tokens, reasoning tokens, and executed search queries. Citation and reasoning use
  provider-owned meters and remain separate from ordinary answer output; no token component is
  counted twice. There is no invented Sonar-style per-request surcharge.
- Embedding models charge their explicitly published input-token rate.
- Search API charges per successful request, including a successful response with no results.
  Multiple queries inside one successful request do not multiply the fee; failed requests are
  excluded. Search API has no token charge.
- Agent `web_search`, `fetch_url`, `people_search`, and `finance_search` charge per invocation.
  Sandbox sessions use the published 20-minute active-use billing window, which is not a runtime
  cap. SDK search requests inside the sandbox have their own published charge.

Rates have exact rational prices and semantic usage bindings, so a caller with accurate billable
quantities and selectors can calculate costs without a provider response-field locator. Input
collection, final classification, shared account state, retries, and invoice reconciliation remain
caller responsibilities. The sandbox binding takes the number of billed sessions; the catalog
does not infer that count from an unqualified wall-clock duration.

## Drift and publication

Native Sonar identity remains tied to the model index when a price cell changes. An unknown numeric
cell becomes a bounded base-price raw fact; known sibling rates survive. `-` denotes an absent
published component, not a fabricated charge. Amounts and applicability come only from the same
first-party rate card. Source extractor revisions prevent replaying older parsed inputs as though
they contained newly supported rules.

Registration and fixture validation do not refresh the accepted `data/` snapshot. The normal
authorized collection publishes the new provider and rebuilds its static projections atomically.
