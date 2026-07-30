# Cohere

Status: current

## Sources and identity

- The non-exhaustive public catalog is one atomic website bundle rooted at the overview plus reviewed family, pricing, lifecycle, release, API, compatibility, and legacy references.
- Callable IDs come only from labeled Cohere model fields; adjacent cloud IDs and paths never become IDs.
- Tables must remain under a reviewed Command, Embed, Rerank, Audio, or Aya section. Unknown sections, labels, links, or routes reject the provider.
- Model-card facts apply only when the labeled ID agrees with its family. Lifecycle/release joins require exact IDs; ambiguous replacements stay unprojected.
- Optional `/v1/models?page_size=1000` is account-scoped. Pagination, empty data, or malformed items fail it; it cannot create rows, infer API versions, or retain raw data.
- Enable the optional inventory with `COHERE_API_KEY`.

## Mapping

- A reviewed section or endpoint definition owns both task and route semantics. Model-name prefixes never supply defaults.
- Preserve exact Chat V1/V2, OpenAI compatibility, Embed, Embed Jobs, Rerank, Audio Transcriptions, and legacy Generate routes. Limit Embed Jobs to its explicit request-model list.
- Generic account inventory values such as chat/embed/rerank add tasks but not API versions. Zero context on image-only embeddings is unknown, not a zero-token limit.
- Pricing joins require one unique non-retired model. Responsive copies must agree. Preserve token, embedding, search, hourly, monthly, and capacity units/conditions.
- Normalize published billing-period labels into the shared period condition before conflict analysis; unsupported period wording still fails closed.
- Conflicting duplicate prices reject the provider. Free experiments plus negotiated production are `custom_quote`.

## Kong AI Gateway

- Intersect lifecycle and account evidence with exact Chat V1, legacy Generate, Embed version, or Rerank version evidence.
- Broad generation cannot distinguish Chat from Generate.
- Transcription remains valid provider data but is outside Kong's current Cohere matrix.
