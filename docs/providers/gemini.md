# Gemini API

Status: current

## Sources and identity

- The exhaustive English-pinned bundle starts at the official model index,
  follows every reviewed model-card target, and includes fixed pricing,
  lifecycle, release, Gemma, Interactions, Live, and machine-readable v1beta
  Discovery references. Fixed first-party companions also cover billing,
  implicit and explicit caching, token usage, Flex and Priority inference,
  Search and Maps grounding, the account-specific Google Cloud Pricing API,
  Cloud Billing export latency, and Google's published Gemini API billing
  service identity. These policy documents are drift guards and do not create
  model rates.
- A card target may describe one model or a family. Every property table with a
  labeled model or agent code is parsed independently, so shared overview pages
  do not silently collapse to their first model. Callable IDs still come only
  from those labeled cells; paths and headings never become IDs.
- Keep current and historical IDs, explicit aliases, facts, and dates bound to their source rows.
- Optional authenticated `/v1beta/models` is account-scoped. Exact `name` stays
  authoritative when `baseModelId` is absent. Refresh follows the documented
  `nextPageToken` chain with `pageSize=1000`, rejects repeated tokens or bounded
  page/model overflow, then removes pagination metadata before parsing.
  Malformed items reject the source; it cannot create rows or retain raw data.
- Enable the optional inventory with `GEMINI_API_KEY`.

## Mapping

- Tasks are non-exclusive. Agent and computer-use rows remain text generation with endpoint/capability evidence. Live audio is `speech_to_speech`.
- Interactions and every supported method require exact listed IDs plus fixed
  method/route references. The public Discovery JSON owns REST paths, inventory
  pagination, the Model schema, GenerateContent response observability, and
  usage/service-tier fields; the Live and Interactions pages own their distinct
  WebSocket and REST routes. Names, modalities, spelling, and neighboring tasks
  never imply an endpoint.
- Only reviewed `supportedGenerationMethods` with pinned REST/WebSocket routes
  add endpoint or delivery facts. Missing or unknown methods remain unknown.
- Pricing sections bind through an exact model ID or one unique explicit alias.
  Unknown references, table headers, units, meters, or agent-pricing structure
  reject the source. At least 80% of non-retired models must retain numeric
  pricing; deliberate official omissions remain below that guard.
- `Free Tier` and `Paid Tier` are account eligibility, while Standard, Batch,
  Flex, and Priority remain inference service tiers. Only the exact phrase
  `Free of charge` becomes a zero rate. A storage price stated “per million
  tokens per hour” remains a token-hour denominator, and search grounding
  stated per 1,000 requests remains request pricing.
- Interpret each paid table cell under its published billing header as one commercial value. Under a token header, a token price is primary and adjacent per-image figures are equivalent usage examples, even across line breaks; they are not additional charges. A per-image value is used only when the cell has no token price.
- Shared Google Search allowances stay as bounded raw allowance facts because
  their quota spans several models and cannot truthfully become a per-model
  allowance. Agent pricing likewise stays as a raw base-price formula because
  the total is the selected underlying model consumption plus tools. Neither is
  converted to zero or a fabricated fixed price.
- Grounding uses the official generation-specific denominator: Gemini 3 Search
  and Maps rates are per executed search query, while Gemini 2.5 and older rates
  are per grounded prompt. Both remain `tool_call` meters, but the former uses a
  search-unit denominator and the latter a request denominator.
- Every commercial pricing claim gets a reconciliation disposition. Numeric and
  explicit free rates are normalized; shared allowances and agent formulas are
  raw; `Not available` or availability-only cells are explicit non-numeric; the
  data-use row is excluded. Unknown identities or numeric structures fail the
  source instead of becoming guessed rates.
- Release dates require exact codes in a dated changelog item containing a
  reviewed release verb. Prefix text is allowed; names and date-like ID
  suffixes are not release evidence.

## Public estimate and account-exact cost

- The public price page is enough for a list-price estimate only when the
  gateway knows the exact model, free or paid project, API operation, actual
  Standard/Flex/Priority/Batch tier, context threshold, input/output modality,
  output resolution or duration, cache outcome and storage TTL, grounding tool
  count, and agent-loop usage. A request parameter alone is insufficient when
  Priority can be downgraded; use the returned tier or response header.
- Gemini billing-account levels determine eligibility, rate limits, and account
  caps. Prepay versus Postpay determines when money moves, not a different
  published model rate. Free versus paid eligibility does change applicable
  rates. Promotional credits, tax, currency conversion, Enterprise volume
  discounts, and custom contracts are account-level adjustments.
- The preview Google Cloud Pricing API and the account pricing export are the
  first-party sources for list and contract SKU prices when the Gemini charge has
  an exact SKU binding. Google's SKU-group publication confirms that Gemini API
  is billing service `AEFD-7695-64FA`; the group is a credit-eligibility list,
  not an exhaustive model-price catalog. Query the account Pricing API under
  that service and join exact SKU IDs from billing data instead of matching SKU
  descriptions. Detailed usage cost export supplies effective cost, credits,
  currency, adjustments, and invoice attribution. Do not infer a contract
  discount from the public Gemini model table.
- The official pages have a surface-sensitive conflict: the pricing page says
  Google AI Studio usage is free in available regions, while the billing FAQ
  says AI Studio usage linked to a paid API key is charged. Treat the project/key
  billing state as authoritative and never encode a universal AI Studio zero
  rate for Gateway traffic.

## Request, response, and freshness

- Interactions usage reports input, output, thinking, cached, and tool-use tokens
  with modality breakdowns, plus grounding tool counts for Search and Maps.
  GenerateContent usage metadata reports prompt, cached-content, candidate,
  thinking, and tool-use-prompt tokens with prompt/cache modality details and
  the effective service tier. Its response schema also publishes `responseId`,
  `modelVersion`, and `modelStatus`, which should be retained for request-level
  reconciliation but do not replace the catalog lifecycle table. Thinking
  tokens are billed with output tokens.
- Document tokens appear under the `DOCUMENT` modality but are billed at the
  image-token rate. A generic total-token count is therefore insufficient;
  preserve response modality breakdowns. Explicit cache cost additionally needs
  the cache metadata token count and configured TTL. Implicit cache hits are
  reported and are enabled by default on Gemini 2.5 and newer models.
- Flex is selected by the client and has no automatic Standard fallback. Priority
  can be downgraded, so the gateway must observe `x-gemini-service-tier` or the
  response tier. Search/Maps usage is outcome-dependent; Interactions provides
  the strongest per-request grounding count.
- Prepay deductions have an approximately ten-minute billing-pipeline lag, but
  that balance is account aggregate. Cloud Billing cost details are typically
  available within a day, can take more than 24 hours, and BigQuery export has no
  delivery guarantee. Account pricing export runs once daily. None of these is a
  hot-path cost oracle.
- AI Studio `Dashboard > Usage` is the first-party interactive usage view. Cloud
  Billing reports can be filtered to the Gemini API service and grouped by SKU;
  API keys have no independent billing settings, so attribution is project and
  billing-account based. A documented 400/500 request is not token-billed but
  still consumes quota, and long-running batch or agent work can overrun a spend
  cap before delayed accounting catches up.
- Cost-based routing should use a locally cached public or account-contract price
  book plus request parameters before dispatch, then update estimates from the
  response usage and actual tier. Reconcile later with Cloud Billing export and
  invoices; do not load-balance on delayed aggregate cost reports.

## Extraction and reconciliation

- Refresh is deterministic and non-LLM: bounded model-card/property tables own
  identity; exact pricing table headers and cells own public rates; the public
  Discovery schema plus explicit Live/Interactions references own endpoints;
  fixed billing phrases fail closed when accounting semantics drift. Public
  pricing never creates an unlisted model. The authenticated inventory follows
  all documented pages and remains an overlay rather than an identity source.
- ccusage remains comparison-only because it obtains prices through LiteLLM.
  Its weekly auto-update workflow imports only OpenRouter and Vercel Gateway data;
  direct Gemini rows remain manually maintained. Detailed tier fields are useful
  leads, but Vertex-labeled entries and Vertex pricing cannot be merged into the
  Gemini Developer API surface.
- models.dev's hourly Google sync correctly follows the official Models API pagination, but sets
  `skipCreates` and only updates API-authoritative fields on pre-existing manual
  rows because that API omits pricing, modalities, lifecycle, release dates, and
  several capabilities. This is a useful independent confirmation of the same
  source boundary, not evidence for missing rows or rates.
- Portkey's workflow validates and publishes JSON after a push but does not fetch Google's catalog,
  so updates are manual and retain many historical IDs. It is useful as a drift
  lead only. Portkey, LiteLLM, and models.dev are never accepted as model or
  pricing evidence. A fixed Deep Research base rate from any comparator is less
  faithful than Google's first-party formula covering all underlying and
  intermediate inference plus tools.
