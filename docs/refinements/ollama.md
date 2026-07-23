# Ollama refinement

Status: reviewed against catalog snapshot `2026-07-22T17:40:47.875Z`, current Ollama documentation, and Kong AI Gateway 2.0

## Catalog assessment

The refreshed catalog contains 239 unique rows: 233 official Library family IDs and 21 Cloud observations, with 15 exact IDs retained from both sources. The Cloud source starts with 18 IDs from the documented public `/api/tags` endpoint, then probes the six exact family IDs on the official Cloud-filtered catalog; two are callable, one returns an exact retired response, and three are unavailable. This yields 20 callable Cloud IDs and one historical Cloud row without inventing names or tags.

The resulting distribution is plausible: 236 active, two deprecated, and one retired row; 227 generation and 12 embedding observations, with OCR on two generation rows and moderation on one. All 239 rows have an explicit artifact or API update date. Only the 20 structured Cloud detail responses publish context limits, and no exact model release dates are available. The 218 Library-only rows use `not_applicable` hosted pricing, while all 21 Cloud observations use `not_published` because Ollama publishes subscription access rather than stable per-model monetary rates.

The source split and fail-closed mechanism are sound. Library cards provide exact callable family aliases, descriptions, capability badges, and update timestamps. The Cloud bundle requires the complete bounded list, Cloud catalog, and structured `/api/show` result for every listed model; an unavailable listed model rejects the source atomically. Every source that observes an exact ID remains in `source_refs`.

Two scope limitations remain:

- A Library family ID such as `llama3.2` means Ollama's default `latest` tag; it does not enumerate or prove the presence of `llama3.2:1b`. Kmodels intentionally does not synthesize size or quantization tags.
- Cloud lifecycle is not global Ollama lifecycle. `gemini-3-flash-preview`, `kimi-k2.5`, and `minimax-m2.5` are retired or scheduled for retirement from Cloud while their Library entries remain independently published. Flattening the Cloud state onto the merged row overstates provider-wide retirement. The official Cloud retirement tables also contain historical IDs and replacement IDs that the current adapter does not ingest.

The Cloud source is therefore exhaustive only for the current direct `/api/tags` inventory, not for historical Cloud offerings, community models, or models installed on a particular Ollama host.

## Kong AI Gateway 2.0

The Kong source of truth is `app/ai-gateway/ai-providers/ollama.md` and the Ollama entry in `app/_data/ai-gateway/v2/providers.yaml` on the `release/ai-gateway-2.0` branch.

Kong supports streaming generation through `/api/chat` and non-streaming embeddings through `/api/embed` on a configured `$UPSTREAM_URL`; it accepts Ollama, OpenAI, and Anthropic formats. Kong does not declare Ollama support for completions, files, batches, agentic, audio, image, video, realtime, or rerank operations.

The 227 generation and 12 embedding observations are only discovery candidates. Compatibility requires the exact ID accepted by the configured upstream and positive evidence for the selected operation. A public Library family, a direct Cloud ID, and a tag pulled into a local host are different availability claims even when they share a family name.

The Kong examples `llama3.2:1b` and `qwen3-embedding:8b` are not exact Kmodels rows; only the family aliases `llama3.2` and `qwen3-embedding` are present. This is expected because the public Library index does not enumerate those tags. Neither family membership nor a normalized type justifies manufacturing the tagged IDs or claiming that a configured host has pulled them.

## Refinement decision

1. Accept the 239-row Library/Cloud union and preserve both source references on all 15 exact overlaps.
2. Keep exact family aliases and exact tagged Cloud IDs as distinct identities; never generate tags from a family card.
3. Model Cloud lifecycle and replacement history separately from Library availability before using lifecycle as a Kong selection filter.
4. Treat Kong compatibility as an upstream-scoped relation: configured host, exact accepted tag, supported `/api/chat` or `/api/embed` operation, and current availability.
5. Do not contact an arbitrary local host from CI or treat its `/api/tags` response as global presence. A future explicitly allowlisted inventory may validate that host without creating global rows.
