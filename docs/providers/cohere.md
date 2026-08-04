# Cohere

Status: current

## Sources and identity

- The non-exhaustive public catalog is one atomic website bundle rooted at Cohere's
  Models section index. That machine-readable index discovers same-section HTML model
  pages without a family-name allowlist; the overview, pricing, lifecycle, changelog,
  API, compatibility, and legacy references are reviewed companions.
- Every indexed model page must be fetched exactly once. Model-document, total-model,
  and current-pricing coverage bounds reject partial indexes and silent source drift.
- Callable IDs come only from labeled Cohere model fields; adjacent cloud IDs and paths never become IDs.
- Tables must remain under a reviewed Command, Embed, Rerank, Audio, or Aya section. Unknown sections, labels, links, or routes reject the provider.
- Model-card facts apply only when the labeled ID agrees with its page path. This
  deliberately rejects internally inconsistent cards instead of binding facts by title.
- Lifecycle headings supply their own dates and semantics. Effective retirements become
  retired only after the effective date; earlier observations remain deprecated.
  Task-qualified and tabular replacement lists bind only exact IDs.
- Optional `/v1/models?page_size=1000` is account-scoped. Pagination, empty data, or malformed items fail it; it cannot create rows, infer API versions, or retain raw data.
- Enable the optional inventory with `COHERE_API_KEY`.
- Fixed first-party companions cover the public pricing policy, evaluation/production-key rules,
  account billing errors, dashboard usage and invoice permissions, native and streaming Chat usage,
  Embed and asynchronous Embed Job billing metadata, Rerank search units, and the transcription
  response. These are accounting drift guards and never create model identity.

## Mapping

- A reviewed section or endpoint definition owns the base task and route semantics.
  Exact task markers may add a non-exclusive specialization such as translation.
- Detailed rows in the current overview, and exact indexed cards with enabled API
  endpoints, establish active lifecycle state. Platform-only rows and legacy endpoint
  lists do not.
- Preserve exact Chat V1/V2, OpenAI compatibility, Embed, Embed Jobs, Rerank, Audio Transcriptions, and legacy Generate routes. Limit Embed Jobs to its explicit request-model list.
- Generic account inventory values such as chat/embed/rerank add tasks but not API versions. Zero context on image-only embeddings is unknown, not a zero-token limit.
- Pricing joins prefer one exact active model over a deprecated date-less alias, then require one
  unique non-retired match. Responsive copies must agree.
  Explicit alias rows share their exact target's rates while retaining their own
  catalog row.
- Preserve token, embedding, search, hourly, monthly, and capacity units and
  conditions. Explicitly free API access remains a free usage offer, including when
  the same model also has numeric Model Vault capacity pricing.
- Normalize published billing-period labels into the shared period condition before conflict analysis; unsupported period wording still fails closed.
- Conflicting duplicate prices reject the provider. Contact-only offers are
  `custom_quote`; explicit free access is not.
- A retired model has no current hosted offer: historical prices are removed and an
  exact not-applicable disposition is published. Unknown current prices remain unknown;
  absence is never interpreted as free.
- Every reviewed price, free/custom statement, and retired historical amount receives a source-item
  reconciliation disposition. Duplicate evidence and out-of-scope historical prices are excluded;
  unbound or internally conflicting current evidence remains a diagnostic instead of being guessed.

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
  exact legacy sentences, reviewed Model Vault grids, and model-card pricing blocks own commercial
  facts. Fixed accounting phrases and response-schema fields fail closed when their semantics drift.
- The earlier extractor normalized rates but silently skipped unmatched pricing products, did not
  audit duplicate or retired price inputs, and did not fetch account/usage companions. It also
  silently discarded the internally inconsistent Command A card. The current extractor partitions
  all reviewed pricing inputs, validates response billing fields, and surfaces that conflict.
- The live bundle contains 43 identities and 36 non-retired rows: 14 have numeric facts, seven are
  explicitly free, and 15 remain unknown. It emits 37 normalized model facts. Source reconciliation
  partitions 61 reviewed items into 33 normalized, 16 explicit non-numeric, ten excluded, and two
  ambiguous items, with no unbound, raw, unsupported, or unresolved item.
- Both ambiguous items are the two token prices on `/docs/command-a`: the page path/title says
  Command A, but its labeled ID is `command-a-plus-05-2026`; meanwhile the dedicated pricing page
  and Command A+ card say that ID is free within limits. Neither amount is bound to
  `command-a-03-2025` or Command A+. This is an upstream first-party conflict, not a parser gap.
- Current first-party evidence intentionally leaves the v3 Embed and Rerank usage prices, nightly
  aliases, Tiny Aya variants, Aya Vision 32B, and Summarize unknown because the dedicated current
  pricing page publishes no exact current usage offer for them. Model Vault capacity alone does not
  establish a hosted per-request rate.
- ccusage remains comparison-only because it delegates Cohere prices to LiteLLM. The inspected
  LiteLLM snapshot has 22 direct Cohere entries and 17 exact non-retired overlaps after removing its
  `cohere/` prefix. It fills several of our unknowns with old Command A, Embed v3, and Rerank v3
  amounts, but provides no source provenance and contains a 1,000x outlier for
  `embed-multilingual-light-v3.0`. models.dev has no native Cohere provider price book in the
  inspected snapshot; its Cohere-labelled rows belong to gateways such as OpenRouter, Vercel, or
  Azure and are different commercial surfaces.
- First-party sources support the overlapping Command R/R+/R7B, Embed 4, Rerank 4, free-model, and
  Model Vault facts already extracted here. They do not currently support importing the extra
  third-party v3/nightly prices as exact Cohere-hosted current rates. The conflicted Command A page
  explains why third-party books commonly show `$2.50/$10`, but its broken identity prevents a safe
  exact binding.

## Kong AI Gateway

- Intersect lifecycle and account evidence with exact Chat V1, legacy Generate, Embed version, or Rerank version evidence.
- Broad generation cannot distinguish Chat from Generate.
- Transcription remains valid provider data but is outside Kong's current Cohere matrix.
