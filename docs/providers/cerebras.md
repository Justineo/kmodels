# Cerebras

## Source topology and refresh

- Production refresh uses only first-party Cerebras surfaces. The required current inventory is
  `GET https://api.cerebras.ai/public/v1/models`; it is unauthenticated, documented, exhaustive,
  and collected atomically with its official `format=openrouter` and `format=huggingface`
  serializers plus the public-model contract. All three serializers must expose the same exact ID
  set and agree on identity, prices, limits, modalities, and overlapping capabilities. Compatibility
  cache/image/request zeroes are documented placeholders and never become native price facts.
- The official Model Catalog is an independent exhaustive source for current model cards, exact
  callable IDs, Production/Preview maturity, endpoint labels, features, limits, and structured
  `ModelInfo` rates. Dynamic cards and a fixed set of commercial/API companions are fetched in one
  linked bundle. `llms.txt` is the discovery sentinel: a new commercial-looking documentation page
  rejects the source until it is classified.
- The bundle includes Cerebras's raw OpenAPI 3.1 document, API-version policy,
  public pricing page, usage schemas, prompt caching, image inputs, reasoning, predicted outputs,
  service tiers, tools, Batch, console billing/cost reporting, projects, rate limits, metrics,
  dedicated inference, and AWS Marketplace billing. The raw OpenAPI is route/capability/usage
  evidence only; example model names cannot create inventory rows.
- Cerebras docs are Mintlify-style stable Markdown surfaces (`llms.txt`, canonical `.md` pages and
  raw `openapi.yaml`) with ordinary HTTP validators. The website price table is a Next.js page backed
  by embedded Sanity data. The public endpoint's three official serializers provide a first-party
  self-consistency check that does not depend on page layout or a community catalog.
- Deprecations and the change log add lifecycle and exact earliest-release evidence. Parameter
  deprecations do not create model rows. Replacement links resolve through exact catalog path/ID or
  change-log name/ID bindings; unresolved, conflicting, or dangling references reject the source.
- Optional authenticated `/v1/models` is account-scoped inventory validation enabled by
  `CEREBRAS_API_KEY`. It cannot create or remove global rows and raw responses are not retained.
  Reviewed additive item fields are accepted with a bounded contract signal; unknown nested fields,
  changed types, unknown values, ID-set divergence, and root-envelope drift fail closed.
- Refresh is fully deterministic and requires no LLM. Do not replace any of these sources with
  models.dev, LiteLLM, Portkey, Helicone, OpenRouter, Hugging Face, or another downstream catalog.

## Identity, mapping, and source conflicts

- Callable IDs must be exact structured API IDs or exact `modelId` values bound to a model link in
  the Production/Preview catalog tables. `/models/choose-a-model` is a reviewed selection guide, not
  a model card. Any other newly discovered `/models/*` page fails closed until classified.
- The catalog owns maturity when official surfaces disagree. In the current snapshot Gemma 4 31B is
  in the Preview table while the public native serializer says `preview: false`; the merged row stays
  Preview. API `created` values are not release dates.
- Current model-card prices come from structured `ModelInfo`. Every card's natural-language pricing
  sentence and every website price-table component is independently reconciled. The current Gemma
  prose says $2.15/$2.70 per million input/output tokens, while structured `ModelInfo`, all three
  public serializers, and the website table say $0.99/$1.49. The structured consensus wins and both
  prose components remain explicit unbound source-conflict evidence. Equal prose/page components are
  recorded as corroboration rather than disappearing from the reconciliation denominator.
- Current endpoint cards accept only reviewed Chat Completions and Completions labels bound to exact
  POST paths. The raw OpenAPI currently contains only `POST /v1/chat/completions` and validates bearer
  authentication, request/response schemas, structured output, tools, reasoning effort, service
  tiers, prompt-cache routing and usage detail. The separately documented legacy Completions route
  remains card evidence; it is not invented from the raw OpenAPI.
- Cache-read rates derive only from the official rule that cached input is billed at the standard
  input rate. There is no separate public cache-write meter. A single unconditional rate remains
  valid only while the service-tier guide says all preview tiers are billed equally.
- `reasoning_effort` is positive effort-control evidence only when the exact parameter appears on a
  model card. Account-tier rate limits and per-request image limits do not fit provider-neutral scalar
  limits and are not flattened into them.

## Cost boundary

- A completed shared-inference response is publicly calculable from exact model ID plus
  `usage.prompt_tokens` and `usage.completion_tokens`. Image tokens are included in prompt tokens.
  Cached input has the standard input rate. Hidden reasoning and rejected predicted-output tokens are
  included in completion accounting and must not be added again. The client executes tool calls, so
  no Cerebras tool-execution meter is added.
- Batch is Private Preview and currently documents only `/v1/chat/completions`. Only completed batch
  requests are charged, but no current public Batch rate is published; synchronous shared rates and
  example model names are not promoted to Batch pricing or support facts.
- The result is public list-cost, not account-effective invoice cost. Trial credits, credit expiry and
  recharge, per-model monthly subscriptions, enterprise/dedicated contracts, and AWS Marketplace
  billing are account or channel adjustments. Console Cost can lag by 10 minutes, active monthly-plan
  requests are excluded from usage billing, and Marketplace charges may lag 24–48 hours.
- Cerebras documents console Usage, Cached-Usage and Cost reports with CSV export, but no public
  Usage/Costs ledger API. The opt-in dedicated Metrics API reports aggregate counters for the last
  complete minute, not request cost. Gateways should route on public marginal-rate estimates and
  returned usage, then reconcile account-effective cost asynchronously.

## Comparator audit

- models.dev and LiteLLM keep direct Cerebras entries manually rather than synchronizing the official
  public endpoint. Portkey and Helicone likewise publish community-maintained subsets; routed catalogs
  such as OpenRouter and Hugging Face describe their own downstream offers. These sources are useful
  drift alarms, but they neither establish Cerebras inventory nor override first-party facts.
