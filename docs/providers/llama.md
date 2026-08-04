# Meta Llama

Status: current

## Sources and identity

- The exhaustive public catalog statically parses Meta's official
  [`llama-models`](https://github.com/meta-llama/llama-models) registry used by
  `llama-model list --show-all`; never import or execute remote Python.
- Every core ID must have one descriptor. The exact CLI descriptor, including
  variants, is `model_id`; the exact Hugging Face repository is an alias. Never
  slugify.
- Parse the complete `CoreModelId` → `ModelFamily` mapping and the closed numeric
  forms used by `Model.max_seq_length`. Unknown expressions, incomplete family
  classification, or descriptors without a context rule fail closed.
- The README launch table, exact model cards, and official Meta release announcements
  establish release dates. Model-specific dates win when a family table and card
  differ; repository commits are not model update dates.
- The official [`llama-api-python`](https://github.com/meta-llama/llama-api-python)
  SDK establishes the first-party API origin, exact relative resources, request and
  response schemas, and model IDs shown in reviewed examples. It is not a public
  hosted-model catalog or price book.
- Optional `/v1/models` is account-scoped and non-creating. API `created` is not an
  artifact release date, and absence from one account does not retire a global model.
  Enable it with `LLAMA_API_KEY`.

## Mapping

- Generative weights are text generation, Llama Guard is moderation, and Prompt
  Guard is classification.
- Downloadable-only weights have `not_applicable` pricing: Meta publishes model
  artifacts rather than an inference service for those identities. Infrastructure
  cost belongs to the chosen deployment provider and must not be copied into the
  Meta Llama price book.
- A Meta-hosted API identity with no current public amount is `not_published`, never
  free or not applicable. The dated 2025 launch statement that Llama API was a
  “limited free preview” does not establish an indefinitely current zero rate.
- Registry presence is active artifact evidence, including entries shown only by
  `--show-all`; it is not release-stage or deprecation evidence.
- Hosted aliases, routes, streaming, tool use, structured output, and multimodality
  apply only to the exact identity or release family supported by official evidence.
  Never copy them to siblings.
- Cerebras- and Groq-powered Llama API names are partner routes. The launch
  announcement establishes their experimental existence, but not exact public IDs,
  availability, or a transferable rate. Their standalone provider prices belong to
  the Cerebras/Groq commercial surfaces.

## Public estimate and account-exact cost

- Meta publishes no current numeric first-party Llama API price book. Public sources
  therefore cannot calculate a current hosted request cost. The only public
  commercial statement found is the April 29, 2025
  [limited free preview announcement](https://ai.meta.com/blog/llamacon-llama-news/),
  which has no current validity boundary or exact per-model rate table.
- The official SDK currently exposes Chat, Models, Uploads, and Moderations resources;
  it exposes no programmatic Usage, Costs, or Billing resource. The launch page says
  usage is tracked in one location, but does not publish a billing-data API or
  freshness SLA.
- Account access, preview entitlement, experimental partner access, custom-model
  availability, and any later private commercial terms are account-level facts. A
  gateway must take them from account configuration or the Meta portal/contract, not
  infer them from the artifact registry.
- Llama 4 weights are distributed under a royalty-free limited license, but the
  [community license](https://github.com/meta-llama/llama-models/blob/main/models/llama4/LICENSE)
  requires organizations above its 700-million-MAU threshold to request a separate
  Meta license. That is a commercial eligibility boundary, not a token rate.
- Self-hosted cost is GPU/capacity/energy/operations cost. Bedrock, Azure, Databricks,
  Cloudflare, Groq, Cerebras, and other hosted Llama offers must use their own
  first-party price books and account billing APIs.

## Request, response, and freshness

- The native Chat request names the model and may set `max_completion_tokens`; prompt
  content, image inputs, generated length, and tool iterations determine realized
  work. There is no documented cache or service-tier selector in the current native
  request schema.
- Non-streaming Chat returns an optional list of generic `{metric, value, unit}`
  values. Streaming emits the same open metric shape in `metrics` events. Metric names
  and units are unconstrained strings: the public schema does not guarantee separate
  billed input/output token fields or a cache-hit breakdown.
- Moderation responses contain the selected model and results but no documented
  metrics object. A gateway can count requests and, for known tokenizer artifacts,
  estimate tokens itself, but it cannot treat those estimates as Meta invoice units.
- Because no public current rate or cost endpoint exists, Meta Llama API cannot
  participate safely in public-price cost-based load balancing. An operator may route
  it using an explicitly configured account price/allowance; post-response generic
  metrics can refine usage only after their runtime names and units are validated.

## Extraction and reconciliation

- Refresh is deterministic and non-LLM. Python constructors and enums own artifact
  identity and limits; exact SDK resources own routes and accounting schemas; dated
  Meta announcements and repository licenses own commercial boundary evidence.
- Every catalog identity receives an explicit pricing disposition. The dated free
  preview and artifact license are reconciled as out-of-scope historical/eligibility
  terms rather than silently converted into current model rates.
- A newly generated SDK Billing/Costs/Usage resource is surfaced as an unsupported
  pricing diagnostic instead of failing the artifact catalog. Structural drift in an
  already reviewed request/response contract still fails closed because existing
  gateway accounting assumptions would no longer be proven.
- The live first-party bundle currently yields 48 identities: 46 downloadable-only
  artifacts are `not_applicable`, and the two exact hosted identities are
  `not_published`. Reconciliation contains 48 explicit non-numeric model states and
  two excluded commercial observations, with no numeric, raw, unbound, ambiguous, or
  unsupported item.
- The earlier extractor did not miss a public numeric price; no such first-party table
  was found. It did miss the free-preview currentness boundary, license eligibility,
  response metric shape, absence of a generated cost resource, and input-level
  pricing reconciliation. Those are now reviewed companions and drift checks.
- LiteLLM's native `meta_llama` entries currently carry model metadata but no token
  prices, so ccusage has no independent Meta rate. models.dev publishes seven Llama
  API entries as zero-cost, including partner-prefixed routes. Its only visible
  first-party support is the dated limited-free-preview announcement; that does not
  prove a current exact `$0` offer for each ID, so those zeros are not imported.
  models.dev's separate closed `meta`/Muse surface is not a Llama model-publisher
  identity and remains outside this provider.

## Kong AI Gateway

- Kong's Llama2 adapter is operator-defined. A registry artifact or Meta-hosted
  endpoint does not prove served name, format, quantization, upstream path, or
  deployment availability.
- Do not publish a direct compatibility list without a runtime binding that retains
  configured model name, format, upstream, operation, availability, and artifact
  relation.
- Moderation/classification artifacts remain outside Kong's Llama matrix.
