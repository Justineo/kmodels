# Hugging Face

Status: current

## Sources and identity

- Global rows come only from Hugging Face-operated public listings: OpenAI-compatible router models and concrete `live` `hf-inference` mappings.
- Both use the exact `namespace/repository` ID. Do not import third-party partner mappings, all Hub repositories, provider-internal IDs, private/staging rows, or router rows without a live backend.
- Parameterized tag filters are dynamic routing contracts, not model rows. Validate the reviewed LoRA contract without flattening it.
- Exclude credential-like identifiers. Mapping/router responses are not snapshotted; malformed data or count drift rejects the source.
- Do not request an HF token for global collection; authenticated inventory would expose private/account data without improving presence.

## Routes and mapping

- Preserve each exact live mapping's provider model ID, raw task, and state in `routes`.
- Union reviewed task registrations. Unknown tasks remain raw route evidence; an empty task list stays unknown.
- Router rows carry exact `/v1/chat/completions` evidence. Only live backends contribute presence, route-conditioned pricing, maximum advertised context, and conservative capability aggregates.
- Validate documented error routes but publish no facts from them.
- An explicitly free route cannot also have a nonzero price. Keep every backend rate as a separate route condition.
- The router publishes no provider model ID; never invent one or reconstruct removed partner joins.
- Router/repository timestamps and volatile latency/throughput are not stable model facts.

## Kong AI Gateway

- Compatibility is versioned and requires an exact Kong capability, upstream surface, and Hugging Face route; provider membership and `source_refs` are insufficient.
- AI Gateway 2.0 chat requires live router membership. Embeddings require a concrete `hf-inference` `feature-extraction` mapping. Audio transcription, image, video, and native generation each require the matching concrete raw task/route.
- AI Gateway 2.0 does not support completions, files, batches, agents, speech synthesis, audio translation, realtime, or reranking for Hugging Face.
- AI Gateway 1.x supports chat from 3.9, embeddings from 3.11, video from 3.13, and native text generation from 3.9. Do not project 2.0-only image/audio support backward.
- Unknown or mismatched task/endpoint combinations remain unclassified.
