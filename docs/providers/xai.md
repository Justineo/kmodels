# xAI

Status: current

## Sources and identity

- Statically extract, but never execute, the reviewed public model payload. Parse only reviewed language, embedding, image, audio, and video fields with count bounds. The catalog is non-exhaustive.
- The fixed `llms.txt` companion owns pricing, releases, Speech to Speech, Multi-agent lifecycle, retirements, and request examples. Structured and textual prices must agree.
- Retired exact IDs remain separate rows. Voice configuration names without request model parameters do not become IDs; only documented versioned Speech to Speech IDs do.
- Optional authenticated inventories are account-scoped, non-creating, and non-persisted.
- Enable the optional inventories with `XAI_API_KEY`.

## Mapping

- Tasks are non-exclusive. Multi-agent behavior stays in Responses/capability evidence; realtime is delivery.
- Publish an endpoint only when an allowlisted example contains one exact resolvable ID/alias and exact request URL. Never inherit routes from tasks or siblings.
- Validate each audio operation only against its current required structured price fields and the public pricing table.
- Normalize fixed-point prices with decimal shifts. Preserve context, tier, media, duration, message, and tool conditions.
- Dates require exact ID, alias, or display-name bindings. API `created` is not a model date.

## Kong AI Gateway

- Candidates require active lifecycle, acceptable maturity, and exact non-streaming Chat Completions, Responses, or Image Generations evidence.
- Function Calling also requires positive tool-call capability.
- Image Edits, Video Generations, and Realtime remain valid xAI facts outside Kong's current matrix.
- Absent or retired Kong examples never restore or alias provider IDs.
