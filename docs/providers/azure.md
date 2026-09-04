# Microsoft Foundry

Status: current

## Boundary

The Azure catalog contains first-party documented model identities that can be invoked through a
Foundry inference endpoint. Pricing contains only public list rates attributable to an inference
request, a completed Batch item, or an exactly observable built-in request component.

The shared book → offer → term → variant model is used without Azure-specific topology. Azure
vocabulary is limited to source-native model IDs, meters, deployment scopes, regions, service tiers,
and usage signals.

The catalog does not require a model to have a currently resolved price. A missing price is local to
the model or offer. Capacity-only products, training artifacts, and infrastructure SKUs do not enter
the catalog merely because they appear in a broad marketplace or pricing page.

## Sources

| Source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Purpose and authority                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [MicrosoftDocs OpenAI models](https://github.com/MicrosoftDocs/azure-ai-docs/blob/main/articles/foundry/openai/includes/models-azure-direct-openai.md), [models sold by Azure](https://github.com/MicrosoftDocs/azure-ai-docs/blob/main/articles/foundry/foundry-models/includes/models-azure-direct-others.md), and [partner models](https://github.com/MicrosoftDocs/azure-ai-docs/blob/main/articles/foundry/foundry-models/includes/models-partners.md)                                                                         | Primary public model/version identity, operation, modality, limit, and API evidence.                                                                                                                                                                                  |
| MicrosoftDocs lifecycle tables and Standard, Provisioned, and Batch deployment matrices                                                                                                                                                                                                                                                                                                                                                                                                                                             | Lifecycle and deployment availability. Provisioned availability is a catalog fact, not an admitted request price. Each companion is optional; a missing companion retains its last verified facts.                                                                    |
| Anonymous `ai.azure.com` catalog API                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Optional first-party supplement for exact identities already supported by the documented catalog family and for newer exact versions. It is undocumented, fill-only for documented tuples, never overrides documented lifecycle, and never blocks a provider refresh. |
| [Azure Retail Prices API](https://learn.microsoft.com/rest/api/cost-management/retail-prices/azure-retail-prices)                                                                                                                                                                                                                                                                                                                                                                                                                   | Current public consumption meters. A row is published only after a deterministic model/version and meter join.                                                                                                                                                        |
| [Azure OpenAI pricing](https://azure.microsoft.com/pricing/details/azure-openai/) and the [Foundry Models pricing index](https://azure.microsoft.com/pricing/details/ai-foundry-models/microsoft/)                                                                                                                                                                                                                                                                                                                                  | Public model-family list prices and request-attributable built-in tool rates. Discovered family pages are optional and parsed independently.                                                                                                                          |
| [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing.md), delegated by [Microsoft's Claude billing contract](https://learn.microsoft.com/azure/ai-foundry/foundry-models/concepts/claude-models-billing)                                                                                                                                                                                                                                                                                                    | Claude token/cache rates in Foundry. Microsoft states that each call is first priced with Anthropic's published per-model token rates. CCU conversion, Marketplace discounts, and invoice settlement are outside scope.                                               |
| [Azure OpenAI Chat](https://learn.microsoft.com/rest/api/aifoundry/azureopenai/chat), [Responses](https://learn.microsoft.com/rest/api/aifoundry/azureopenai/responses), [Batch](https://learn.microsoft.com/rest/api/aifoundry/azureopenai/batch), [Embeddings](https://learn.microsoft.com/rest/api/aifoundry/azureopenai/embeddings), [media](https://learn.microsoft.com/azure/foundry/openai/reference-preview-latest), and [prompt caching](https://learn.microsoft.com/azure/foundry/openai/how-to/prompt-caching) contracts | Optional first-party accounting supplement. It establishes exact response, terminal stream-event, completed-job, and media-result fields from which a downstream request calculator can acquire quantities. It publishes no price and no runtime lifecycle.           |
| Authenticated Azure Location Models and exact ARM meter inventory                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Optional account-scoped confirmation of public model/version availability and exact meter IDs. It may enrich an existing public tuple but does not publish subscription resources, principals, deployment names, private prices, or account-only identities.          |

The undocumented portal and every pricing overlay are optional. Transport, page, or schema failure
therefore keeps the public catalog usable and retains the last accepted Azure pricing partition with
a freshness warning.

## Catalog mapping

- Preserve Azure's case-sensitive model ID and explicit version. A versionless public row and a
  versioned row remain distinct identities unless Microsoft publishes an exact relation.
- Merge repeated exact tuples across catalog tables, deployment matrices, the optional portal, and
  authenticated inventory. Known public lifecycle wins over portal lifecycle; fill-only supplements
  cannot replace a known scalar.
- Treat OpenAI, models sold directly by Azure, and partner/community models as service-family
  evidence, not as different identity namespaces.
- Derive tasks and endpoints only from explicit table types and endpoint text. New unrecognized task
  labels are reported and ignored locally; they do not reject the model row.
- Availability records deployment type and region. Standard, Batch, and Provisioned matrices may all
  describe a callable model, but only request-attributable usage rates enter pricing.
- Optional account inventory contributes only positive, non-secret facts to an existing public
  identity. Missing credentials or a failed region leaves public facts unchanged.

## Pricing mapping

### Request-cost input contract

Kmodels is a price book, not a request observer. The optional `azure-accounting` source publishes
the first-party data contract a calculator may consume; it does not intercept streams, persist
usage, detect retries, or reconcile an invoice.

Current exact acquisition paths are:

- Chat/Completions response usage for prompt, cached prompt, cache-write, completion, input-audio,
  and output-audio tokens. The same documented usage object is available from the terminal stream
  chunk when `include_usage` is enabled; that path is explicitly `terminal_only` because an
  interrupted stream may not deliver it.
- Responses response usage for input, cached input, output, and reasoning tokens. Reasoning is
  available as a breakdown but remains part of output unless a price source publishes a distinct
  meter.
- Batch job usage for input, cached input, output, and reasoning tokens. These are job aggregates,
  so the binding resets at `job`, not at a fabricated result-item counter.
- Embeddings response prompt tokens.
- Image response text-input, image-input, and image-output tokens; generated-image array length;
  and the returned `quality` and `size` selectors.
- Conditional transcription and translation response duration, and successful video-result
  duration.

Accounting facts are endpoint-gated. A Chat locator is not attached to a model that only documents
Responses, and image, audio, or video locators are attached only to a matching model task. When
Azure publishes separately priced cache or audio input, uncached text is calculated within one API
family as `total input - cached input - cache write - audio input`, floored at zero. Separately
priced text output is similarly `total output - audio output`. A partial family never contributes a
calculation method, so fields from Chat and Responses cannot be combined into a plausible but false
quantity.

The current Azure contracts do not establish an exact response selector for priority versus
standard deployment pricing, a request/result field for region or deployment scope, a filtered
count of File Search or Web Search calls, a Code Interpreter session boundary, Model Router's
selected-model contribution, document-page counts, rerank search units, TTS billing characters, or
video resolution as one categorical field. Those rates retain semantic charge bindings without
`input_sources`; callers must supply the exact quantity or selector from their own configuration or
telemetry. Kmodels does not invent a JSON path to make a list price appear executable.

### Admitted offers

- `sync`: synchronous pay-as-you-go inference.
- `batch`: the distinct asynchronous Batch mechanism. Rates apply to the completed job's reported
  usage aggregate; enqueued tokens and quota are not prices.
- `router`: Model Router input markup. The response `model` selects the underlying model whose normal
  inference rates are additive.

Within an offer, retain only conditions that select or establish the applied rate: model/version,
region, deployment scope, served service tier, context tier, modality, operation, quality,
resolution, cache TTL, and validity when first-party evidence supplies them. Equal prices are not
expanded into a synthetic Cartesian product.

Normalized meters include input/output/cache token classes, embeddings, rerank searches, image,
audio, video, pages, requests, and duration units used directly by inference. A numeric rate remains
useful without a charge binding; a missing signal is local to that term.

### Request components

The Azure OpenAI pricing page can publish separate service books for components whose charged event
is observable from the proxied operation:

- Responses File Search tool calls;
- Responses Web Search calls when published;
- Code Interpreter sessions; and
- Computer Use token usage.

Persistent File Search/vector storage is excluded. An unknown row in the reviewed built-in-tools
table is retained as one bounded raw request-component fact; an explicitly identified storage or
capacity row is discarded rather than serialized as raw. When one Computer Use cell contains both
Input and Output regional amounts, each amount is classified from its nearest local label rather
than from the combined cell text.

### Excluded commercial facts

The collector discards:

- fine-tuning/training jobs, checkpoints, graders, and training compute;
- fine-tuned-model hosting and other persistent hosting charges;
- PTU/provisioned capacity, Reservations, commitment plans, and spillover procurement;
- Managed Compute GPU/VM charges;
- hosted-agent vCPU/GiB runtime and persistent agent storage;
- standalone Agent Service, Content Safety, evaluation, and observability products unless a future
  reviewed source proves an exact separately billed event in the proxied inference protocol;
- Agent prepurchase/ACU plans, subscriptions, credits, balances, and allowances at account scope; and
- Marketplace enrollment, CCU conversion, private offers, MACC, invoices, taxes, and settlement.

These facts are outside the Gateway rate-book boundary, not unknown pricing. They do not appear in
canonical raw facts or website projections.

## Exact matching and conflicts

Retail matching is deterministic:

1. constrain the Microsoft product/SKU family;
2. match normalized ordered identity tokens and explicit version markers;
3. bind only an exact catalog version, an existing versionless tuple, or the sole eligible public
   version; and
4. infer a meter only when the native unit and a unique task/meter interpretation agree.

Never fuzzy-match a SKU, guess input versus output, or copy a family price to every version. An
unbound row is reported but does not reject recognized siblings.

For an exact overlapping claim, authority is:

1. authenticated direct ARM meter ID joined to the public Retail Prices row for its exact scope;
2. public Retail Prices SKU/meter for its exact model, region, deployment, tier, and validity scope;
3. the exact Microsoft model-family pricing row; and
4. an explicitly delegated first-party price book, currently Anthropic for Claude.

Different region, deployment mechanism, seller, tier, or validity is not a conflict. A conflict with
no deterministic winner withholds only the disputed rate and emits reconciliation evidence; valid
sibling rates survive.

## Resilient refresh

- The primary MicrosoftDocs index is required. Its fixed catalog, lifecycle, and deployment
  companions are independently optional and retain last verified facts when omitted.
- The portal, Retail Prices, public price pages, Claude price book, and authenticated inventory are
  optional overlays. Their failure cannot reject the documented catalog.
- JSON collections parse row by row. A malformed row or new enum value is skipped or partially
  interpreted with a contract signal; recognized rows survive.
- HTML prices parse table, row, price cell, region, and meter independently. A malformed price cell
  cannot erase another model or tool rate.
- Delegated Claude pricing validates the semantic Foundry conversion and Data Zone contract, then
  locates rate columns by header. Prose/link changes and unrelated new columns do not invalidate
  readable model rows.
- Dynamic pricing-family discovery has no minimum page-count dependency. A new family page may add
  exact prices but cannot widen identity matching.
- If an optional pricing dependency is missing, or the assembled Azure partition fails topology
  validation, publish the previous accepted Azure pricing partition as stale. Never mix a partial
  current price graph with retained siblings.
- Catalog/pricing publication remains crash-consistent; staleness and reconciliation stay in
  operational metadata rather than being hidden in displayed rates.

## Presentation

Model details show only applicable invocation offers, the dimensions that materially select a rate,
published meter/rate rows, and exact request components. They do not show plans, capacity,
training, storage, enrollment, or settlement. Known usage-counting parameters remain visible, but
the website does not ask for quantities or calculate a total.
