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
  facts. Fixed accounting phrases, the first-party OpenAPI, and response-schema fields fail closed
  when their semantics drift.
- Cohere's generated Markdown may place all Embed Job model/dimension entries on one bullet line.
  Parse only the bounded dimension list and stop before the following request fields; backticked enum
  values elsewhere on the page are not model IDs. Streaming accounting requires `message-end`,
  `usage`, and `billed_units`; `cached_tokens` is no longer claimed by that streaming reference and
  remains guarded only where Cohere publishes it. The current transcription contract is validated by
  its exact successful text response and absence of `billed_units`.
- The earlier extractor normalized rates but silently skipped unmatched pricing products, did not
  audit duplicate or retired price inputs, and did not fetch account/usage companions. It also
  silently discarded the internally inconsistent Command A card. The current extractor partitions
  all reviewed pricing inputs, validates the published OpenAPI and response billing fields, and
  resolves only the reviewed multi-document identity defect described above.
- The live bundle contains 43 identities and 36 non-retired rows: 15 have numeric facts, seven are
  explicitly free, and 14 remain unknown. Sixteen current rows carry at least one price fact, and
  the bundle emits 39 model price facts overall. Source reconciliation partitions 62 reviewed items
  into 35 normalized, 16 explicit non-numeric, and 11 excluded items, with no unbound, ambiguous,
  raw, unsupported, or unresolved item.
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
