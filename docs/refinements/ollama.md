# Ollama refinement

Status: reviewed against a live refresh on 2026-07-23, current Ollama documentation, and Kong AI Gateway 2.0

## Catalog assessment

The refreshed catalog contains 239 unique rows: 233 official Library family IDs and 21 Cloud observations, with 15 exact IDs observed by both sources. The Cloud bundle begins with 18 IDs from the documented public `/api/tags` endpoint and probes the six additional exact family IDs from the Cloud-filtered official catalog. Two additional families are callable, one returns Ollama's exact retired response, and three are unavailable. The adapter therefore publishes 20 callable Cloud IDs plus one family with validated historical Cloud presence without manufacturing a name or tag.

All 239 global rows are active. The three Cloud retirements or schedules currently affect exact families that remain published in the Library, so projecting them onto the single global lifecycle would incorrectly claim that the Ollama model itself is deprecated or retired. Those rows instead retain both `Ollama Cloud` and `Ollama Library` service families while their channel-specific retirement stays unprojected. The distribution is 218 Library-only rows, 15 exact Library/Cloud overlaps, and six Cloud-only exact tagged IDs.

The remaining facts are plausible: 227 generation and 12 embedding observations, with OCR on two generation rows and moderation on one. Every row has an explicit artifact or API update date; the 20 successful structured Cloud detail responses additionally publish context limits. No exact model release dates are available. Library-only rows use `not_applicable` hosted pricing, while all 21 Cloud observations use `not_published` because Ollama publishes shared subscription plans and per-model usage levels rather than a stable monetary rate attributable to one model.

The fetch and conversion path is deterministic and failure-closed:

- Library cards provide exact callable family aliases, descriptions, capability badges, and update timestamps.
- The Cloud bundle requires the complete bounded list, Cloud catalog, and a structured `/api/show` result for every listed ID; an unavailable listed model rejects the source atomically.
- The server returns `/api/tags` in nondeterministic order, so the bundle sorts its complete items by exact ID before hashing without dropping fields.
- A retired-model response contains a different request-reference UUID on every call. The collector validates and removes only that volatile UUID before hashing, and it does not persist redundant component responses because the normalized bundle is the durable snapshot.
- Every source that observes an exact ID remains in `source_refs`, and the exact delivery families remain in `service_families`.

Three scope limits are intentional:

- A Library family such as `llama3.2` selects Ollama's default `latest` tag; it does not enumerate or prove `llama3.2:1b`. Kmodels never synthesizes size, quantization, `:cloud`, or `-cloud` tags.
- The public model schema has one global lifecycle. It cannot retain a Cloud-only retirement date on a family that is still active in the Library, so that scoped date is validated but suppressed. A channel-scoped lifecycle resource is still required before publishing Cloud retirement history and replacements completely.
- Neither Library nor Cloud service-family evidence proves that a configured Ollama host has pulled or accepts an exact tag. A local `/api/tags` inventory may contain private names and remains outside global collection.

The Cloud source is exhaustive only for the current direct `/api/tags` inventory, not for historical Cloud offerings, community models, or models installed on a particular Ollama host.

## Kong AI Gateway 2.0

Kong documents streaming generation through `/api/chat` and non-streaming embeddings through `/api/embed` on a configured `$UPSTREAM_URL`. It does not declare Ollama support for completions, files, batches, agentic, audio, image, video, realtime, or rerank operations.

The 227 generation and 12 embedding rows are discovery candidates, not a compatibility allowlist. Compatibility additionally requires the exact ID accepted by the configured upstream, positive evidence for the selected operation, and current runtime availability. A Library family, a direct Cloud API ID, and a tag pulled into a local host remain different availability claims even when they share a family name.

Kong's examples `llama3.2:1b` and `qwen3-embedding:8b` are not exact Kmodels rows; only `llama3.2` and `qwen3-embedding` are present. This is expected because the public Library index does not enumerate tags. Neither a family row nor a normalized operation justifies manufacturing those tagged IDs or claiming that a configured host has pulled them.

The general Ollama API references publish host-level routes rather than a per-model endpoint matrix. Kmodels therefore does not derive `api_endpoints` from a Library badge or normalized `types`; Kong route selection remains contingent on the configured upstream and its exact served model.

## Refinement decision

1. Keep the 239-row Library/Cloud union and preserve all exact source and service-family evidence.
2. Publish lifecycle as the global union of current official delivery evidence: a current Library family remains active even when its Cloud channel is retiring.
3. Keep exact family aliases and exact tagged Cloud IDs distinct; never derive one from the other.
4. Canonicalize only transport noise—unordered list items and request-reference UUIDs—while retaining and validating every fact-bearing field.
5. Treat Kong compatibility as an upstream-scoped relation among configured host, exact accepted tag, supported `/api/chat` or `/api/embed` operation, and current availability.
6. Do not contact an arbitrary local host from CI. A future explicitly allowlisted inventory may validate that host but must not create global rows.
