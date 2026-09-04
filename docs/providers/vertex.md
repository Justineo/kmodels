# Gemini Enterprise Agent Platform

Status: current

## Boundary

Kmodels catalogs models that Google exposes as managed APIs on Gemini Enterprise Agent Platform or
through its Model-as-a-Service offerings. The provider ID remains `vertex`. Agent Platform agents,
runtimes, registries, gateways, skills, generic self-deployment inventory, and other non-model
resources do not create catalog rows.

The price book covers public costs attributable to one proxied inference request or its result:

- online, Priority, Flex, and Batch inference;
- input, output, cache-read, embedding, image, audio, and video generation rates; and
- independently metered request components such as grounding, Maps, and Claude web search.

Training, retained cache storage, Provisioned Throughput, savings plans, agents, CodeMender,
AlphaEvolve, model optimization, account allowances, billing export, and settlement are outside
this boundary. Cache-read inference is in scope; cache storage over time is not.

Kmodels publishes a price book and calculation-input contracts. It does not own the runtime request
lifecycle: the Gateway still captures requests, terminal responses or stream events, asynchronous
results, interruptions, retries, and any account-side reconciliation data.

## Sources

Model discovery and pricing remain independent:

- the Google, partner, and managed-open indexes plus bounded model cards establish model identity,
  capabilities, lifecycle, availability, and invocation routes;
- the public Agent Platform pricing page establishes rates and applicability; and
- the Discovery schema and fixed first-party Batch, grounding, Claude, Grok Responses,
  OpenAI-compatible, Imagen, and Veo documents establish calculation inputs and selectors.

The pricing source explicitly owns both `pricing` and `pricing_inputs`. Accounting contracts are not
treated as rate evidence. The optional authenticated Model Garden API validates known public
identities only; it cannot create rows, contribute private prices, or retain account data.
Its service-account key must be active: an OAuth `invalid_grant` is reported as a credential
failure and skips only this optional account-scoped validation source. Replacing
`GOOGLE_SERVICE_ACCOUNT_JSON` with a current key restores it; public catalog and pricing sources do
not depend on that credential.

Each source owns only its claims. A pricing-page failure does not reject model discovery. A changed
route guide withholds only that route. A missing accounting field removes only the affected input
or selector method while preserving the semantic charge binding and published rate. Previously
accepted provider data is retained only when the provider refresh cannot publish a valid
replacement.

## Mapping

- Model IDs come from labeled model-card fields or exact Model Garden links. Headings, display
  labels, and approximate dates do not create identity.
- A family price may apply to multiple IDs only when one model card establishes that family. Other
  joins require a unique best model match; ambiguous rows remain unmatched.
- Flexible Savings Plan columns are excluded because they are account commitments, not request
  rates. New unrelated columns and sections are ignored locally.
- Standard, Priority, Flex, and Batch are shared `service_tier` values. Online conditions become
  `served_service_tier`; `trafficType` or the equivalent partner response value selects Standard,
  Priority, or Flex. Batch is a separate offer and uses successful result-item accounting.
- Global and non-global values use `deployment_scope`; exact locations use `region`. A request
  location can select an exact region, but it does not infer the wildcard meaning of non-global.
- Context thresholds, modality, operation, resolution, audio, cache TTL, and effective dates remain
  independent applicability dimensions.
- Page alternatives are ignored only when a model card gives an exact token equivalence. Otherwise
  the token rate stays normalized and the unresolved alternative remains bounded raw evidence.
- Explicit `N/A` cells are local non-numeric evidence and do not reject another meter or model.

## Calculation inputs

The current reviewed accounting surface is:

- Gemini `generateContent` and terminal stream responses: total and per-modality prompt, cached,
  candidate, tool-result prompt, and thought tokens; served traffic type; generated inline-image
  count; Google Search and Image Search query counts; and returned Web, Maps, or Agent Search
  grounding presence;
- Gemini Batch Cloud Storage JSONL: the same `usageMetadata` and grounding fields under each
  successful row's `response`; failed rows do not contribute completed inference usage;
- embeddings: total plus text, image, video, audio, and document prompt-token details;
- Claude: input, cache-write, cache-read, output, and web-search-request counts from response usage
  for non-streaming and streaming calls;
- Grok Responses: input, cached input, output, reasoning, traffic type, server-side tool count, and
  source count from a response or terminal `response.completed` event;
- OpenAI-compatible chat: prompt and completion tokens from a response or final stream usage chunk;
- Imagen: actual returned `predictions` count and requested output resolution; and
- Veo: requested duration and actual returned video count, multiplied to produce generated seconds,
  plus requested resolution and audio selection.

Uncached Gemini input is calculated as prompt input minus cached input with a zero floor, plus tool
execution results provided back to the model. Grok input subtracts cached input with the same zero
floor. Gemini image-rate input and cache quantities include image and document modality buckets.
Text output adds thought tokens; aggregate candidate output is used only when no separately priced
output modality would be double counted. Thinking is therefore included when the public output
rate covers it, while the separate reasoning counter remains available as a calculation input.

Grounding mappings intentionally distinguish queries from grounded prompts. Google Search and Image
Search expose query arrays. Returned Web, Maps, and retrieved-context chunks can establish a
qualifying grounded request. Agent Platform does not expose the actual number of Google Maps
queries, so a Maps query-priced rate has a semantic binding but no quantity method; the deprecated
Maps widget context token is not treated as a query count.

## Known calculation gaps

The following remain explicit downstream inputs rather than invented mappings:

- partner-model Batch result usage, until Google documents its exact result envelope;
- Claude cache-TTL selection and Claude long-context threshold calculation on Agent Platform;
- wildcard `deployment_scope` selection from a concrete regional endpoint;
- actual Google Maps query count;
- interrupted-stream attribution and retry policy; and
- invoice, discount, billing-export, or invocation-log reconciliation.

These gaps do not erase rates. A binding without quantity methods states the billable semantic
quantity; a method without provider input sources states a known calculation whose inputs must be
supplied by the caller.

## Refresh behavior

Refresh is deterministic and uses official pages, public APIs, and optional configured credentials.
No LLM or OCR participates. Discovery contracts are checked field by field, so one renamed usage
member removes only contracts that depend on it. The pricing-input reconciliation reports the exact
bound count against the reviewed surface. Unsupported in-boundary rate facts stay bounded and local;
unrelated table, route, or accounting drift does not fail the provider.

The pricing bundle has a larger transport bound because the Cloud page and fixed first-party
documents are large. That bound is a transport safety limit, not a schema assertion.
