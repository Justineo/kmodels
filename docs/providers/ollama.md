# Ollama

Status: current

## Sources and identity

- The non-exhaustive official Library publishes exact callable family names; omitted tags select `latest`.
- Never synthesize size, quantization, `:cloud`, `-cloud`, or community IDs. Community namespaces remain outside the reviewed catalog.
- Cloud `/api/tags` plus `/api/show` for every listed ID is one atomic source. A missing detail rejects it. Exact catalog probes may add aliases or validate retired Cloud presence.
- Retain independent Library and Cloud source/service-family evidence for exact overlaps.
- Do not authenticate or contact arbitrary local runtimes in CI.

## Mapping

- Library and Cloud lifecycle are separate. A current Library family remains globally active even if its Cloud channel retires.
- Publish Cloud lifecycle only for an exact ID without current Library evidence. A channel-scoped lifecycle resource is required before exposing suppressed Cloud retirement history completely.
- Sort the unordered Cloud list and remove only the request-specific retired-response UUID before hashing. Retain every fact-bearing field in memory only.
- Library weights use `not_applicable` pricing. Direct Cloud rows use `not_published` because subscriptions/usage levels do not provide a stable per-model monetary rate.
- Explicit Library/API update fields become `updated_date`, not release.

## Kong AI Gateway

- Kong uses `/api/chat` for streaming generation and `/api/embed` for non-streaming embeddings on a configured upstream.
- Compatibility requires the configured host, exact accepted tag, matching operation, and current runtime availability.
- Library families, Cloud IDs, and pulled local tags are different scope claims. General API references and normalized tasks do not create per-model endpoints.
- Do not manufacture tagged Kong examples from family rows or claim that an operator has pulled them.
