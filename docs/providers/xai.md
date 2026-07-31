# xAI

Status: current

## Sources and identity

- Statically extract, but never execute, the reviewed public model payload. Parse only reviewed
  language, embedding, image, audio, and video categories with count bounds, and fail closed when a
  new model category appears. The catalog is non-exhaustive.
- Preserve the structured model `version` as identity. Optional authenticated inventories are
  account-scoped, non-creating observations: detailed inventories preserve their version, while the
  general inventory may enrich a uniquely matching public identity.
- The fixed `llms.txt` companion owns public pricing terms, releases, Speech to Speech models,
  lifecycle redirects, capability-wide statements, and request examples. Structured fixed-point
  prices must agree with the public tables, but hidden payload discount fields are not commercial
  evidence.
- Redirected exact IDs remain separate `legacy` rows because their slugs continue to resolve. Their
  effective pricing is derived from the single documented redirect target from the redirect date.
  Voice configuration names without documented request model parameters do not become IDs.
- Enable the optional inventories with `XAI_API_KEY`.

## Mapping

- Tasks are non-exclusive. Multi-agent behavior stays in Responses/capability evidence; realtime is delivery.
- Publish an endpoint only when an allowlisted fenced request example contains an exact request URL
  and resolvable model ID or alias. Model bindings come from the example, never a hardcoded model
  list or task inheritance.
- Parse Speech to Speech prices per documented request model ID and resolve every one against the
  structured realtime services. Each version keeps its own audio-minute and text-input rates; shared
  tool rates remain separate. Validate internal TTS, STT, and realtime service prices without
  publishing those service names as models.
- Parse Batch discounts and Priority multipliers from public pricing prose. Batch support comes from
  the Batch API support document, including explicit model exclusions; media Batch support remains
  at standard rates. Streaming follows the documented output-modality-wide rule.
- Normalize fixed-point prices with decimal shifts. Preserve context, service tier, media, duration,
  message, tool, and lifecycle-effective conditions.
- Dates require exact ID, alias, or display-name bindings. API `created` is not a model date.

## Kong AI Gateway

- Candidates require active lifecycle, acceptable maturity, and exact non-streaming Chat Completions, Responses, or Image Generations evidence.
- Function Calling also requires positive tool-call capability.
- Image Edits, Video Generations, and Realtime remain valid xAI facts outside Kong's current matrix.
- Absent or retired Kong examples never restore or alias provider IDs.
