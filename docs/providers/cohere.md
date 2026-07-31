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

## Mapping

- A reviewed section or endpoint definition owns the base task and route semantics.
  Exact task markers may add a non-exclusive specialization such as translation.
- Detailed rows in the current overview, and exact indexed cards with enabled API
  endpoints, establish active lifecycle state. Platform-only rows and legacy endpoint
  lists do not.
- Preserve exact Chat V1/V2, OpenAI compatibility, Embed, Embed Jobs, Rerank, Audio Transcriptions, and legacy Generate routes. Limit Embed Jobs to its explicit request-model list.
- Generic account inventory values such as chat/embed/rerank add tasks but not API versions. Zero context on image-only embeddings is unknown, not a zero-token limit.
- Pricing joins require one unique non-retired model. Responsive copies must agree.
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

## Kong AI Gateway

- Intersect lifecycle and account evidence with exact Chat V1, legacy Generate, Embed version, or Rerank version evidence.
- Broad generation cannot distinguish Chat from Generate.
- Transcription remains valid provider data but is outside Kong's current Cohere matrix.
