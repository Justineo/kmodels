# Cohere

Status: current

## Sources and identity

- The non-exhaustive public catalog is one atomic website bundle rooted at Cohere's
  Models section index. That machine-readable index discovers same-section HTML model
  pages without a family-name allowlist; the overview, pricing, lifecycle, changelog,
  API, compatibility, and legacy references are reviewed companions. Cohere's public
  developer-experience repository is a second first-party surface: its one-way-synced
  OpenAPI document is fetched in the same atomic bundle.
- Every indexed model page must be fetched exactly once. Model-document, total-model,
  and current-pricing coverage bounds reject partial indexes and silent source drift.
- Callable IDs come only from labeled Cohere model fields; adjacent cloud IDs and paths never become IDs.
- Tables must remain under a reviewed Command, Embed, Rerank, Audio, or Aya section. Unknown sections, labels, links, or routes reject the provider.
- Model-card facts normally apply only when the labeled ID agrees with its page path.
  One narrow documented exception handles an upstream identity defect: the title and
  path must agree, a same-product release note must supply one exact SDK ID already in
  the overview, and the incorrectly labeled ID must have its own path-matching card.
  Without all three independent checks, the card remains ambiguous and contributes no
  facts or prices.
- Lifecycle headings supply their own dates and semantics. Effective retirements become
  retired only after the effective date; earlier observations remain deprecated.
  Task-qualified and tabular replacement lists bind only exact IDs.
- Optional `/v1/models` is account-scoped. The transport requests the documented maximum
  page size of 1,000 and follows `next_page_token` through bounded, repeated-token-safe
  pagination before parsing one aggregate. Empty intermediate pages, excess pages/models,
  malformed items, or an incomplete aggregate fail it; it cannot create rows, infer API
  versions, or retain raw data.
- Enable the optional inventory with `COHERE_API_KEY`.
- Fixed first-party companions cover the public pricing policy, evaluation/production-key rules,
  account billing errors, dashboard usage and invoice permissions, native and streaming Chat usage,
  Embed and asynchronous Embed Job billing metadata, Rerank search units, and the transcription
  response. These are accounting drift guards and never create model identity.
- The official OpenAPI companion independently guards native V1/V2 Chat, Embed, Embed Jobs,
  Rerank, Audio Transcriptions, the Models pagination contract, model response fields, and
  V1/V2 usage schemas. Required semantic keys are checked inside their indentation-bounded
  YAML objects, so additive fields do not break refresh while moved or removed contract fields do.

## Mapping

- A reviewed section or endpoint definition owns the base task and route semantics.
  Exact task markers may add a non-exclusive specialization such as translation.
- Detailed rows in the current overview, and exact indexed cards with enabled API
  endpoints, establish active lifecycle state. Platform-only rows and legacy endpoint
  lists do not.
- Preserve exact Chat V1/V2, OpenAI compatibility, Embed, Embed Jobs, Rerank, Audio Transcriptions, and legacy Generate routes. Cohere currently links Audio Transcriptions through the exact versioned `/v2/reference/create-audio-transcription` alias while the canonical reference remains `/reference/create-audio-transcription`; both establish the same reviewed V2 operation. Limit Embed Jobs to its explicit request-model list.
- Generic account inventory values such as chat/embed/rerank add tasks but not API versions. Zero context on image-only embeddings is unknown, not a zero-token limit.
- Pricing joins prefer one exact active model over a deprecated date-less alias, then require one
  unique non-retired match. Responsive copies must agree.
  Explicit alias rows share their exact target's rates while retaining their own
  catalog row.
- Preserve token, embedding, search, instance-hour, instance-month, instance-year, and capacity
  conditions. Evaluation credentials, exact model-specific no-charge hosted access, free artifact
  acquisition, and paid Model Vault capacity are separate offers even when they concern one model.
- Normalize published billing-period labels into the shared period condition before conflict analysis; unsupported period wording still fails closed.
- Conflicting duplicate prices invalidate only the exact amount selector. Preserve their raw
  alternatives and independently supported sibling facts; responsive-copy disagreement similarly
  removes only that product payload. Contact-only offers are `custom_quote`; explicit free access
  is not.
- A retired model has no current hosted offer: historical prices are removed and an
  exact not-applicable disposition is published. Unknown current prices remain unknown;
  absence is never interpreted as free.
- Every reviewed price, free/custom statement, and retired historical amount receives a source-item
  reconciliation disposition. Duplicate evidence and out-of-scope historical prices are excluded;
  unbound or internally conflicting current evidence remains a diagnostic instead of being guessed.

## Commercial topology audit

Design status: implemented. The deterministic collector, atomic price-book adapter, fixtures, and
model-detail projection implement the provider-wide topology below. Account-only negotiated terms
and relationships whose exact target is not public remain bounded rather than synthesized.

### Public commercial source graph

| Surface                                                                                                                                                                                                                                                             | Exact authority and completeness boundary                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cohere's current [pricing page](https://cohere.com/pricing), [pricing policy](https://docs.cohere.com/docs/how-does-cohere-pricing-work), [rate limits](https://docs.cohere.com/docs/rate-limits), and exact model cards                                            | Current Cohere-hosted amounts, explicit free or custom-quote statements, key class, rate limits, and model-specific production-access exceptions. A pricing product is not exhaustive model inventory, and a product that presents both “API key” and “model download” must be split into independent commercial claims. |
| Models index, exact cards, lifecycle/changelog pages, account `/v1/models`, and Cohere's OpenAPI                                                                                                                                                                    | Global model identity, callable IDs, aliases, lifecycle, route/version support, account inventory, and response fields. Account-created or customized IDs cannot become global rows, and inventory presence does not establish a public price.                                                                           |
| Native [Chat](https://docs.cohere.com/reference/chat), streaming Chat, [Embed](https://docs.cohere.com/reference/embed), Embed Job, [Rerank](https://docs.cohere.com/reference/rerank), and [Transcribe](https://docs.cohere.com/docs/transcribe) references        | Exact request/outcome usage fields and operation semantics. Returned `billed_units`, not generic tokens or request counts, are the closest public request-level charge signal. A response schema never supplies a missing amount.                                                                                        |
| [Tool use](https://docs.cohere.com/v2/docs/tool-use-overview), RAG/documents, connectors, and the [V1-to-V2 migration guide](https://docs.cohere.com/v2/docs/migrating-v1-to-v2)                                                                                    | Client-executed tool boundary, token contribution, deprecated V1 Cohere `web-search` connector, and V2 user-defined replacement. No reviewed first-party source publishes a generic Cohere tool-call, citation, or RAG surcharge.                                                                                        |
| General [`/v2/batches`](https://docs.cohere.com/reference/create-batch), Embed Jobs, and dataset/job references                                                                                                                                                     | Asynchronous resource identity, request shape, result counters, lifecycle, and failures. They do not publish a separate Batch or Embed Job amount or same-price rule, and the generic Batch API does not enumerate an exhaustive globally supported model set.                                                           |
| [Model Vault overview](https://docs.cohere.com/docs/model-vault), Standard [supported models](https://docs.cohere.com/docs/model-vault/standard/supported-models), [pricing](https://docs.cohere.com/docs/model-vault/standard/pricing), management, and monitoring | Cohere-managed isolated capacity, exact model/performance-tier amounts, Fixed/Flex plan structure, commitments, autoscaling, pause/resume, enrollment, and account usage-hour/spend evidence. The dedicated current pages supersede less-specific marketing or legacy Vault tables claim by claim.                       |
| Encrypted Vault [supported models](https://docs.cohere.com/docs/model-vault/encrypted/supported-models) and [pricing](https://docs.cohere.com/docs/model-vault/encrypted/pricing)                                                                                   | Confidential-hardware product boundary, beta enrollment, design-partner no-charge status, and unpublished later commercial terms. Standard rates cannot fill Encrypted gaps.                                                                                                                                             |
| Deployment-options, private-deployment, open-weight download/license, and cloud-AI-service guides                                                                                                                                                                   | Seller, operator, artifact acquisition, managed endpoint, and infrastructure boundaries. AWS, Azure, OCI, customer VPC/on-premises, and downloaded execution retain their own price books or contracts; Cohere-direct rates do not transfer across routes.                                                               |
| North, Compass, [Model Vault with North](https://docs.cohere.com/docs/model-vault/model-vault-with-north), and customization/private-deployment sales pages                                                                                                         | Provider-owned application/service identity, bundle or backend compatibility, and custom-quote path. North and Compass are not model IDs or universal add-ons; customized-model resources remain account scoped.                                                                                                         |
| Cohere dashboard Billing/Usage, invoices, organization roles, and billing-error guidance                                                                                                                                                                            | Account settlement, thresholds, permissions, negotiated terms, credits, currency, taxes, and adjustments. No reviewed public programmatic organization Costs API exists; `/v1/datasets/usage` is dataset storage, not model billing.                                                                                     |

Comparator catalogs remain comparison-only. Their copied rates, flattened units, aliases, or
broader inventories may identify a first-party coverage gap, but they cannot establish Cohere
amount, applicability, route, or lifecycle.

### Books, resources, and offer boundaries

- A model book can contain a Cohere-hosted synchronous offer for one exact model and route. Chat,
  Embed, and Rerank retain their native meters. API version and streaming are delivery surfaces of
  the same offer unless Cohere publishes a price difference.
- Evaluation API access is a separate credential/enrollment offer: calls are explicitly free within
  non-commercial and rate-limit constraints. A newer Chat model whose production key behaves like
  an evaluation key keeps that model-specific access offer; broad “production is paid” prose cannot
  manufacture a token rate.
- Free model-weight acquisition is a one-time distribution/license offer for an exact artifact. It
  does not make Cohere SaaS, Model Vault, private infrastructure, or third-party execution free.
  Marketing that shows both a free API key and free download therefore yields two claims, not one
  model-level `free` state.
- Standard Model Vault and Encrypted Model Vault are distinct Cohere-managed capacity mechanisms.
  Standard Fixed and Flex are distinct offers; model, performance tier, commitment period, and
  enrollment are applicability. A Vault may contain several models, but a public rate remains
  attached to the exact model/tier capacity resource it names.
- Standard Fixed is a committed instance quantity without autoscaling. Standard Flex combines a
  committed baseline with autoscaled capacity. Monthly/annual commitment terms and instance-hour
  overage are components or variants of their exact plan, not detachable add-ons to model PAYG.
  Published commitment alternatives are never summed with each other.
- Current Standard tables publish exact hourly/monthly/annual rows for supported Embed and Rerank
  tiers, and separate hourly rows for named generative models. The table explicitly associates Flex
  overage with instance-hours; where the exact plan binding of a generative hourly row is not stated,
  preserve the amount with bounded plan applicability instead of rejecting it or guessing. A dash is
  not zero.
- Encrypted Vault beta no-charge access is scoped to accepted design partners and its validity. A
  later/general commercial quote path is a separate non-numeric offer; it does not overwrite beta
  and cannot reuse Standard prices. Standard and Encrypted are alternatives for one Vault resource,
  not organization-wide mutually exclusive products.
- Generic `/v2/batches` is a distinct async service/resource. Until Cohere publishes an exhaustive
  supported-model relation, its provider-service book has an empty model projection and a bounded
  model binding. Embed Jobs may project only their exact documented model list. Neither mechanism
  inherits synchronous rates or a discount without first-party price evidence.
- North and Compass belong in provider-service books with `custom_quote` offers. A specifically
  configured North-with-Vault route uses a Vault inference backend, but public evidence does not
  make Vault a universal North fee, include North in Vault capacity, or expose a reliable composite
  total. Similarly named North models, North suite, and Vault North/Compass bundles retain separate
  identities.
- Private deployment is a composed route: Cohere license/support/customization is sales-scoped and
  operator infrastructure is externally billed. Open-weight execution is operator billed after
  free artifact acquisition. Cloud AI services use the cloud seller's book. None is a fallback
  Cohere-hosted token offer.
- Fine-tuning's public API is deprecated. Bespoke customization, support, and private serving remain
  provider-service `custom_quote` work; derived model and endpoint IDs are account resources, not
  global catalog candidates.

### Commercial relationships

| Source offer or resource             | Relation                     | Target and scope                                                                                                   | Cost consequence                                                                                                                                          |
| ------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hosted evaluation access             | `exclusive_with`             | Hosted PAYG or sales-enabled production for the same request/credential route                                      | Evaluation is its own bounded free access path, not a zero-price allowance deducted from PAYG spend.                                                      |
| Hosted synchronous inference         | `exclusive_with`             | Generic Batch, Embed Job, Standard Vault, Encrypted Vault, or externally operated execution for the same work item | One realized execution uses one settlement route. Never add Cohere token rates to Vault capacity or cloud/private infrastructure for that same inference. |
| Standard Fixed                       | `exclusive_with`             | Standard Flex for the same Vault acquisition/model capacity                                                        | Plans are selectable alternatives. Flex baseline and autoscale overage remain one hybrid offer.                                                           |
| Standard Vault                       | `exclusive_with`             | Encrypted Vault for the same Vault resource                                                                        | Vault type is immutable after creation. Separate Vaults can coexist in one organization, so no global exclusion edge is valid.                            |
| North-with-Vault configuration       | `requires`                   | One exact Standard or Encrypted Vault backend selected for that configuration                                      | North application/service terms and Vault capacity can both settle. The relation is not applied to standalone North or every North contract.              |
| V2 model tool declaration/result     | no commercial offer relation | Client-executed function and exact Chat request                                                                    | Tool schemas/results can increase billed model input. The executed tool keeps its own service/operator cost; there is no generic Cohere tool-call rate.   |
| Deprecated V1 `web-search` connector | bounded raw                  | Exact V1 Chat connector route                                                                                      | Preserve the provider-operated route, but amount and separate-charge status are unpublished. Do not label it free or equate it with V2 client tools.      |
| Direct documents/RAG context         | no commercial offer relation | Chat input billed units                                                                                            | Retrieval/context affects model input. External vector/search systems keep separate service identity and prices.                                          |
| Free open-weight download            | `compatible_with`            | Exact Cohere private/open-weight execution offer where both are first-party established                            | Acquisition can be zero while execution remains externally billed. No coverage relation turns the runtime into a free service.                            |
| Private deployment composition       | bounded raw                  | Cohere custom entitlement/support plus customer-operated infrastructure                                            | Public sources establish both cost owners but not exact offer targets or terms. Do not invent a cross-provider edge or one combined amount.               |

Use `exclusive_with` only for one acquisition or execution scope. It never implies that a customer
cannot use different Cohere routes concurrently. `Requires` expresses a proven dependency, not
inclusion or a guessed total. A relation is omitted or retained as bounded raw when its target,
scope, or commercial consequence is not first-party exact.

### Meters, charge signals, and earliest reliable phase

| Commercial atom                                   | Published denominator                                    | Charge or reconciliation signal                                                                                                                | Earliest reliable phase       |
| ------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Chat input                                        | Million billed input tokens                              | `usage.billed_units.input_tokens`; tool schemas, documents, tool results, and accumulated context are included when Cohere counts them         | Outcome                       |
| Chat output                                       | Million billed output tokens                             | `usage.billed_units.output_tokens`, including model-generated content Cohere classifies as billable                                            | Outcome                       |
| Generic Chat tokens/cache counters                | None independently published                             | Generic `tokens` can include internal/special tokens; `cached_tokens` has no reviewed cache-specific rate                                      | Diagnostic only               |
| Embed text                                        | Million billed input tokens                              | Embed or completed Embed Job `billed_units.input_tokens` when the exact mechanism/rate relation applies                                        | Outcome / job outcome         |
| Embed image                                       | Million billed image tokens                              | `billed_units.image_tokens` when returned                                                                                                      | Outcome / job outcome         |
| Embed image count                                 | No conversion to image tokens published                  | `billed_units.images` proves images were processed but cannot proxy billed image tokens                                                        | Coverage diagnostic           |
| Rerank                                            | Thousand search units                                    | `meta.billed_units.search_units`; one search covers a query and up to 100 documents, with documented long-document chunking affecting count    | Outcome                       |
| Hosted Transcribe evaluation                      | Explicit no-charge access within limits                  | Successful transcription and credential/rate-limit state; the current response exposes no monetary usage counter                               | Request/outcome eligibility   |
| Generic Batch generation                          | Input/output tokens reported by the completed job        | Job `input_tokens`, `output_tokens`, record outcome, and exact requested model; public amount and global model applicability remain unresolved | Job outcome, price unresolved |
| Embed Job                                         | Completed job billed units                               | Job result `meta.billed_units`; do not apply synchronous Embed rates without an exact same-price rule                                          | Job outcome, price unresolved |
| Standard Vault Flex overage                       | Instance-hour for exact model and performance tier       | Account/dashboard usage hours, baseline/max configuration, active replicas, exact Vault/tier, and contract                                     | Account/resource outcome      |
| Standard Vault commitment                         | Instance-month or instance-year for exact model and tier | Active contract term, committed instance count, Vault identity, and account settlement                                                         | Account                       |
| Generative Vault hourly row                       | Instance-hour for exact model/tier row                   | Account usage hours and exact model/tier; plan binding remains partial where the table does not state it                                       | Account/resource outcome      |
| Encrypted beta                                    | Enrollment-scoped explicit no-charge state               | Accepted design-partner enrollment, exact beta validity, and Encrypted Vault identity                                                          | Account enrollment            |
| Download                                          | One exact artifact/license acquisition                   | First-party publisher artifact and license; download count is not an inference meter                                                           | Acquisition                   |
| North, Compass, customization, private deployment | Contract-defined                                         | Quote/order plus account invoice; public feature use cannot reconstruct a price                                                                | Account settlement            |
| External tool/cloud/private compute               | External service-native meter                            | Tool/cloud/operator response and invoice, outside Cohere's book                                                                                | External outcome/account      |
| Cohere account settlement                         | Exact invoice/contract amount in account currency        | Billing portal, invoice, negotiated terms, credits, tax, currency, and adjustments                                                             | Account settlement            |

Rerank request count cannot replace search units: document count and chunking can change the billed
quantity. Embed image count cannot replace image tokens without an official conversion. Vault
request tokens cannot be converted into instance-hours. Trial request limits, TPM/RPM, organization
Vault quotas, and replica caps are allowance, admission, or sizing facts, not monetary denominators.

### Requested, realized, enrollment, and settlement facts

- Request facts select exact model, route/API version, synchronous versus async mechanism, key
  class, input modalities, tools/documents, and target Vault. They can forecast hosted token usage
  but cannot know final billed units, Rerank chunking, async success, or autoscaled capacity.
- Outcome facts bind Chat/Embed/Rerank billed units, successful Batch records, actual model, tool or
  connector execution, and job completion. A declared tool, submitted record, or requested image
  does not prove the exact billable quantity.
- Resource facts select Standard/Encrypted type, Fixed/Flex plan, model, tier, committed/min/max
  replicas, active/pause state, and term. Cohere documents spend and usage-hour monitoring, but not
  enough public rounding and billable-state semantics to derive invoice-exact hours from request
  traffic. Prefer account-reported usage hours.
- Enrollment facts include evaluation/production credential class, sales approval for newer-model
  production, Vault waitlist/self-service eligibility, Encrypted design-partner status, and accepted
  licenses/contracts. They do not change model lifecycle.
- Account facts select negotiated amount, currency, thresholds, credits, taxes, billing period, and
  invoice adjustments. Public rates plus returned billed units provide an estimate; the billing
  portal, contract, and invoice provide settlement truth.
- A failed or cancelled async item follows the exact mechanism's billing rule. Record success counts
  alone cannot prove token charges, and the lack of a public failure-price statement cannot be
  interpreted as free.

### Commercial-atom disposition ledger

| Reviewed atom class                                                 | Design disposition                                                                                                                                                                                                           |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact current Chat input/output rows                                | Normalize into one Cohere-hosted synchronous offer per exact model/route using billed input/output tokens.                                                                                                                   |
| Exact Embed text and image-token rows                               | Normalize the native token components. Bind image pricing only to returned billed image tokens; preserve response coverage as partial where only image count is available.                                                   |
| Exact Rerank rows                                                   | Normalize as search-unit offers with returned `search_units`; never flatten into request, document, or token prices.                                                                                                         |
| Explicit free evaluation/API access                                 | Normalize as a credential-, use-, limit-, and validity-scoped offer. Do not project a global free model price.                                                                                                               |
| Explicit free model download                                        | Normalize as exact artifact/license acquisition, separate from hosted and executed inference.                                                                                                                                |
| Hosted and download claims on one marketing product                 | Split and reconcile independently; neither claim supplies the other's applicability or execution price.                                                                                                                      |
| Newer-model production access requiring sales                       | Preserve the current bounded evaluation behavior and separate production `custom_quote`/enrollment path. Do not inherit a family rate.                                                                                       |
| Standard Vault exact model/tier hourly, monthly, and annual rows    | Normalize as capacity terms with exact plan/term applicability where published. Preserve ambiguous plan binding as bounded evidence instead of discarding the amount.                                                        |
| Standard Fixed/Flex structure and Flex overage                      | Normalize distinct capacity offers and baseline/overage composition. Never attach overage as an add-on to ordinary model PAYG.                                                                                               |
| Standard generative hourly rows and contact-sales commitments       | Normalize exact hourly amount/model/tier claims; preserve unclear plan binding and unpublished commitment terms separately. Dash is not zero.                                                                                |
| Encrypted Vault beta and later commercial path                      | Normalize enrollment-scoped beta no-charge access separately from unpublished/current quote terms. Do not copy Standard amounts.                                                                                             |
| Generic Batch                                                       | Provider-service offer with empty model projection, `not_published` amount, and bounded model relationship until first-party support/pricing is exact. No guessed discount or PAYG inheritance.                              |
| Embed Jobs                                                          | Preserve exact async model applicability and result meter; amount/same-price relationship remains bounded until first-party pricing states it.                                                                               |
| Tool calls, citations, structured output, and direct RAG documents  | No separately priced Cohere atom is published. Preserve model usage contribution and external-service boundaries; do not emit a generic free tool.                                                                           |
| Deprecated V1 Cohere `web-search` connector                         | Preserve route/service evidence as bounded raw with unproven separate-charge status. Do not conflate it with V2 user-defined tools.                                                                                          |
| Transcribe API, model weights, and Vault production                 | Split free limited API access, free Apache-licensed acquisition, and paid/custom capacity execution.                                                                                                                         |
| North and Compass                                                   | Provider-service `custom_quote` offers. Do not create model rows or attach them to every Cohere model.                                                                                                                       |
| Vault North/Compass bundles                                         | Preserve exact bundle resource identity and support; do not equate a bundle label with the top-level suite contract without first-party identity proof.                                                                      |
| Private deployment, support, and customization                      | Provider-service `custom_quote` plus explicit externally billed infrastructure boundary. Account-created model/endpoint IDs stay out of the global catalog.                                                                  |
| AWS, Azure, OCI, customer VPC/on-premises, and downloaded execution | Exclude amounts from the Cohere-direct book; preserve seller/operator route and use that price book or account contract.                                                                                                     |
| Retired historical amounts and deprecated fine-tuning API           | Preserve as historical/non-current evidence or exclusion. Do not expose as a current offer.                                                                                                                                  |
| Duplicate, conflicting, malformed, or newly shaped evidence         | Reconcile claim-locally by exact identity, source specificity, validity, and semantics. Retain alternatives or bounded raw diagnostics when unresolved; do not reject recognized model rows, sibling facts, or the provider. |

### Authority and conflicts

- Exact current pricing cells own public amounts. Exact model cards and route guides own identity,
  availability, limits, and model-specific enrollment. Response/API references own billed counters.
  Dedicated Standard or Encrypted Vault pages own their mechanisms and amounts. Contracts, account
  usage, and invoices own settlement.
- Current dedicated Standard Vault pricing is more specific than the old marketing/legacy Vault
  grid and includes generative hourly rows. Prefer it only for the exact amount/mechanism claim; do
  not let it erase still-valid identity or operational facts from companion sources.
- Command A's current card has the documented label defect described below. The overview, exact
  release note, path/title, specifications, and correctly labeled A+ sibling permit the narrow
  resolution. Missing corroboration makes only that price/identity binding ambiguous.
- Command A+ free hosted access and Command A's numeric hosted rates are independent exact-product
  claims. Similar family labels cannot transfer amounts. Likewise, broad production-key prose loses
  only the conflicting applicability claim when an exact newer-model card says production behaves
  like evaluation.
- A combined marketing `Free` label can establish separate API-access and download claims only when
  its structured fields say so. It never proves free execution on Vault, cloud, private, or local
  infrastructure.
- Every recognized item receives a disposition: normalized, explicit non-numeric, excluded,
  bounded raw, or unresolved conflict. Unknown product types, meters, connector terms, plan binding,
  or source drift generate claim-local diagnostics. Refresh continues with independently supported
  identities, prices, relationships, and usage contracts.
- A conflict is resolved automatically only when exact model/resource identity, route, validity,
  unit, and a more specific or current first-party authority determine one result. Otherwise retain
  the alternatives and select no calculator value. Absence, dash, `N/A`, or contact-sales wording
  never becomes numeric zero.

### Model-detail composition and cost coverage

- Present one exact model identity with route-specific commercial alternatives: hosted evaluation,
  hosted PAYG or sales-enabled production, supported Embed Job, Standard/Encrypted Vault, download,
  and private/cloud execution only where first-party evidence establishes each route. Generic Batch
  remains a standalone service until exact model projection is published.
- Show independently billed provider services and external components as relationships, not copied
  model rates. V2 client tools and third-party retrieval remain external; North and Compass remain
  provider services; Vault capacity remains an alternative settlement mechanism.
- Cost coverage is phase and mechanism specific. Chat, Embed text, and Rerank can usually refine a
  public estimate from response billed units. Embed image is partial when image-token usage is
  absent. Batch/Embed Job amount coverage is unknown without an exact price relation. Vault and
  custom/private/service offers require account evidence.
- The UI should distinguish `estimated`, `capacity mechanism`, `scoped no-charge`, `custom quote`,
  `externally billed`, `amount not published`, `usage unavailable`, and `conflicting evidence`. A
  simple `free/paid/unknown` state loses essential Cohere semantics.
- Availability, price amount, usage observability, and settlement coverage are independent. A real
  callable model remains in the catalog when one commercial claim is unknown; a published rate
  remains visible when its post-response usage binding is partial, with the limitation shown.

## Public estimate and account-exact cost

- Public list prices can estimate Cohere-hosted usage only after selecting the exact model, endpoint,
  API-key class, and offer. Generation uses billed input/output tokens, Embed uses billed text tokens
  or images, Rerank uses billed search units, and Model Vault uses provisioned instance time rather
  than request tokens. Cloud-provider deployments are separate commercial surfaces and must use
  their Bedrock, Azure, or OCI price books.
- Evaluation/trial keys are free but rate limited. Production keys are paid for the established
  hosted models, while production keys for newer Chat variants currently behave like trial keys
  until their limits and direct production access requires sales. The specific model card and rate-
  limit table therefore override broad prose that describes all generative models as token-priced.
- Free API access and a paid or custom Model Vault alternative can coexist for one model. Public
  hourly/monthly Model Vault rows are capacity offers; unpriced enterprise configurations,
  longer-term commitments, private deployments, contract terms, taxes, credits, and invoice
  adjustments cannot be reconstructed from the public model rate book.
- The reviewed public reference documents dashboard Usage history, billing limits, and downloadable
  invoices, but no programmatic Usage/Costs API for organization charges. `/v1/datasets/usage` is
  dataset-storage consumption, not model billing. An account's invoice-exact cost therefore comes
  from its Cohere commercial terms and billing records, not from a public cost endpoint.

## Request, response, and freshness

- Native Chat V1/V2 responses expose `billed_units.input_tokens` and
  `billed_units.output_tokens` separately from generic token counts. Cohere says billed units are
  the units actually charged; internal/special tokens can make generic counts larger. Streaming
  Chat supplies the same usage on `message-end`.
- Chat also exposes `cached_tokens`, but Cohere publishes no cache-specific discounted rate. Do not
  invent a cache discount: use returned billed units for the post-response estimate. Request content,
  output limits, thinking, tools, truncation, and cache behavior can affect realized units, so a
  client request alone supplies only a forecast.
- Embed reports billed text/image units; completed Embed Jobs expose billed units in the job result.
  Rerank reports `billed_units.search_units`. The current transcription response contains only the
  transcribed text and no usage object; its public API offer is free within limits, while production
  Model Vault is capacity-priced.
- Per-request billed units are synchronous enough to refine gateway accounting immediately after a
  response, but they arrive after route selection and do not contain negotiated account price,
  credits, taxes, or invoice adjustments. Cohere publishes no freshness SLA for dashboard usage or
  invoices and no aggregate cost API suitable for a hot routing loop.
- Cost-aware routing should use a locally cached first-party price book plus API-key/deployment policy
  and request parameters before dispatch, then update estimates from returned billed units. Reconcile
  later against dashboard/invoice records. Do not route on delayed aggregate billing state.

## Extraction and reconciliation

- Refresh is deterministic and non-LLM. Labeled model IDs own identity; typed RSC pricing products,
  exact legacy sentences, dedicated Standard/Encrypted Model Vault tables, and model-card pricing
  blocks own commercial facts. The first-party OpenAPI and identity/route structure remain strict
  drift guards. Accounting phrases normalize fact-locally inside a complete
  commercial bundle. A failed companion fetch retains the complete accepted pricing
  partition; a malformed individual claim suppresses only its dependent binding,
  enrollment, relation, or resource and emits a reconciliation item.
- Optional first-party companions cover generic Batch, V2 caller-executed tools, V1 migration,
  Standard and Encrypted Vault support/pricing, North-with-Vault, and private deployment. Their
  absence cannot discard the required model bundle or independently supported hosted rates.
  A recognized malformed or conflicting commercial row is retained as bounded raw evidence when it
  cannot be normalized; it does not reject a model row or the provider.
- Cohere's generated Markdown may place all Embed Job model/dimension entries on one bullet line.
  Parse only the bounded dimension list and stop before the following request fields; backticked enum
  values elsewhere on the page are not model IDs. Streaming accounting requires `message-end`,
  `usage`, and `billed_units`; `cached_tokens` is no longer claimed by that streaming reference and
  remains guarded only where Cohere publishes it. The current transcription contract is validated by
  its exact successful text response and absence of `billed_units`.
- The extractor partitions hosted model rates from provider-resource facts. Evaluation access is a
  per-model credential alternative; explicit no-charge production access is not merged into it.
  Standard Vault Fixed/Flex and published hourly tiers are capacity books, free downloads are
  distribution books, North/Compass/private deployment are service books, and Batch/Embed Jobs keep
  their independently documented async boundaries. No generic V2 tool-call rate is emitted.
- Standard Vault model/tier amounts remain usable even when the table label has no unique global
  catalog identity. Such a row becomes an unprojected capacity resource with the exact published
  model label, amount, tier, unit, and an unresolved identity-binding term; it is not discarded or
  guessed onto a similarly named model.
- Hosted Chat, Embed, and Rerank rate terms bind to Cohere's returned
  `meta.billed_units` fields. If the exact accounting reference drifts, the numeric amount remains
  published while its charge binding is omitted and the limitation is explicit. Standard Vault
  terms bind to provider-owned instance-hour, instance-month, or instance-year account/resource
  signals rather than token usage.
- Reconciliation assertions test semantic contracts rather than frozen aggregate counts. The model
  inventory and pricing surface can grow mechanically; refresh bounds still diagnose suspicious
  coverage changes without turning ordinary pricing gaps into provider failure.
- `/docs/command-a` still has an upstream defect: its path, title, 256K/8K specifications, and
  `$2.50/$10` rates describe Command A, but its labeled ID is
  `command-a-plus-05-2026`. The overview independently maps Command A to
  `command-a-03-2025`; the Command A release note says to use that exact SDK ID; and the separate
  Command A+ card correctly owns `command-a-plus-05-2026` and says the API offer is free within
  limits. Those checks bind the two card rates to `command-a-03-2025` and record the bad label as
  excluded evidence. Any missing or changed corroboration restores the two ambiguous diagnostics.
- Current first-party evidence intentionally leaves the v3 Embed and Rerank usage prices, nightly
  aliases, Tiny Aya variants, Aya Vision 32B, and Summarize unknown because the dedicated current
  pricing page publishes no exact current usage offer for them. Model Vault capacity alone does not
  establish a hosted per-request rate.
- ccusage remains comparison-only because it delegates Cohere prices to LiteLLM. The inspected
  LiteLLM snapshot has 22 direct Cohere entries and 17 exact non-retired overlaps after removing its
  `cohere/` prefix and including its separate `cohere_chat` namespace. It supplies third-party
  prices for seven rows that remain unknown here: one nightly alias, four Embed v3 models, and two
  Rerank v3 models. Its single shared JSON map has no per-row source provenance and contains a
  1,000x outlier for `embed-multilingual-light-v3.0`. Updates arrive through repository edits/PRs;
  LiteLLM's newer catalog API is another delivery surface for that maintained metadata, not a
  first-party Cohere feed.
- models.dev now has a native, hand-authored Cohere provider with 14 rows. Eleven overlap our 36
  non-retired rows exactly, two are rows Cohere has retired here, and one is the open-weight
  `command-r7b-arabic-02-2025`, which current hosted-model documentation does not establish as a
  Cohere API ID. Nine current overlaps carry prices. Eight agree with the first-party evidence used
  here; `command-a-plus-05-2026` incorrectly carries `$2.50/$10` even though Cohere's dedicated A+
  card says free within rate limits. Its Cohere directory is not registered in models.dev's hourly
  provider-sync modules, so the general hourly automation framework does not make these rows an
  automatically refreshed Cohere price book.
- Portkey's community-maintained Cohere file has 19 model keys besides its default: 18 exactly match
  our full catalog, 13 match non-retired rows, and `command-r7b` is a date-less alias rather than an
  exact ID. It contributes six third-party prices where first-party current rates remain unknown,
  but flattens Rerank's search price into a request-token-shaped field and has had only manual Cohere
  file changes in the inspected history. Its hosted config can refresh gateway caches, but that is
  distribution of the community file, not extraction from Cohere.
- First-party sources support the overlapping Command R/R+/R7B, Embed 4, Rerank 4, free-model, and
  Model Vault facts already extracted here. They do not currently support importing the extra
  third-party v3/nightly prices as exact Cohere-hosted current rates. They also show why a comparator
  can copy a plausible amount onto the wrong A-family ID: page-level identity must be reconciled
  across the overview, release note, and dedicated sibling card rather than trusted in isolation.
