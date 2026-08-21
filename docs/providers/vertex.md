# Gemini Enterprise Agent Platform

Status: current

## Boundary

Kmodels catalogs models that Google exposes as managed APIs on Gemini Enterprise Agent Platform or
through its Model-as-a-Service offerings. Agent Platform agents, runtimes, registries, gateways,
skills, and other non-model resources do not create catalog rows. The generic Model Garden
self-deployment inventory does not create catalog rows. Catalog inclusion and price availability
are independent: a managed model remains useful even when its current public rate cannot be
matched.

The website uses the Google Cloud mark to distinguish this managed platform from the standalone
Gemini API. Its stable provider ID remains `vertex`.

The price book covers only costs attributable to a proxied inference request or its result:

- online, Priority, Flex, and Batch inference;
- input, output, cache-read, embedding, image, audio, and video generation rates; and
- separately metered request components such as grounding, Maps, and Claude web search when the
  result exposes a reviewed count.

Training, retained cache storage, Provisioned Throughput, savings plans, agents, CodeMender,
AlphaEvolve, model optimization, account allowances, billing export, and settlement are outside the
AI Gateway rate-book boundary. They are not retained as raw pricing merely because the public page
mentions them. Cache-read inference is in scope; cache storage over time is not.

## Sources

Model discovery and pricing are separate sources:

- the Google, partner, and managed-open model indexes and their bounded model cards establish model
  identity, capabilities, lifecycle, availability, and invocation routes;
- the public Agent Platform generative AI pricing page establishes rates and their dimensions; and
- optional first-party grounding guides, Claude web-search documentation, and the Agent Platform
  API Discovery document establish model applicability and observable usage fields.

The optional authenticated Model Garden API checks known public identities only. It cannot create
rows, contribute private prices, or retain account data.

Each source owns only its claims. A pricing-page failure does not reject model discovery. A changed
route guide withholds only that route, and a changed usage schema withholds charge bindings while
preserving the published rates. Previously accepted provider data is retained only when the
provider refresh itself cannot publish a valid replacement.

## Mapping

- Model IDs come from labeled model-card fields or exact Model Garden links. Headings, display
  labels, and approximate dates do not create identity.
- A family price may apply to multiple IDs only when one model card establishes that family. Other
  joins require a unique best model match; ambiguous rows remain unmatched rather than widening a
  price. An explicit unmatched model label also ends the preceding row group, so later continuation
  rows cannot inherit an unrelated model.
- The current Cloud pricing page is normalized by semantic heading and table order. Flexible
  Savings Plan columns are removed before parsing because they are account commitments, not
  request rates. New unrelated columns and sections are ignored locally.
- Standard, Priority, Flex, and Batch remain shared `service_tier` values. A combined Flex/Batch
  heading expands to both only when the row does not distinguish them; `Global (Flex)` and
  `Global (Batch)` select the exact tier. Row descriptors such as `Batch Input` and explicit
  `Request Type` cells take the same exact tier instead of overlapping the standard row.
- Global and non-global values use `deployment_scope`; exact published regions use `region`.
  Region tabs are part of the table scope: global, multi-region, and regional panels remain
  disjoint even when the table itself has no Region column.
  Context thresholds, modality, operation, resolution, audio, cache TTL, and effective dates remain
  independent applicability dimensions. Dated promotional and standard labels retain their
  published `through`, `beginning`, or `starting` boundary.
- Direct token rates are normalized per token while preserving the published million-token unit as
  evidence. Page alternatives are ignored only when a first-party model card gives an exact token
  equivalence; otherwise the token rate remains normalized and the unresolved alternative remains
  a bounded base-price fact.
- Explicit `N/A` cells are local non-numeric evidence. They do not reject another meter, model, or
  source.

## Charge binding

The canonical topology is the shared `book -> offer -> term -> variant` model. Provider code only
maps its dimensions and response fields.

- Gemini token usage binds to `GenerateContentResponse.usageMetadata`, including modality details
  and cached-token details.
- Claude token usage binds to `Message.usage`; Grok Responses usage binds to `Response.usage`; and
  OpenAI-compatible managed-open usage binds to `ChatCompletion.usage`.
- Grounding and search components bind only to exact returned query/request counts. A published
  rate without a reviewed observable count remains useful but has no charge binding.
- Media generation rates remain selectable rate variants even when no exact response usage locator
  has been reviewed. The rate book does not invent locators.

No provider-specific price-book hierarchy is introduced. These bindings, dimensions, and labels
are provider vocabulary layered on the common canonical model.

## Refresh behavior

Refresh is deterministic and uses only official pages, public APIs, and optional configured
credentials. No LLM or OCR participates. HTML layout changes are handled best effort: accept every
independently understood model and rate, keep unsupported in-boundary facts bounded and local, and
never fail the provider merely because an unrelated table, column, tag, or usage field changed.

The pricing source is intentionally allowed a larger response bundle because the Cloud page and
the first-party applicability guides are large. The bound is a transport safety limit, not a
schema assertion.
