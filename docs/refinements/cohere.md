# Cohere refinement

Status: implemented and replayed against Cohere's official sources on 2026-07-23 and the current Kong AI Gateway provider reference

## Catalog assessment

The 42 rows remain the exact observed current and historical Command, Aya, Embed, Rerank, and Transcribe families: 16 active, seven deprecated, seven retired, and 12 unknown-state rows. Their operation distribution remains 25 generation, eight embeddings, seven rerank, and two audio-transcription rows. Thirty-six rows now carry 53 exact positive API facts.

Sixteen rows have published prices, five are correctly represented as custom quote, and 21 remain unknown. The catalog is intentionally non-exhaustive. The authenticated inventory currently returns 31 account-visible models; it remains scoped evidence and is not used to weaken global presence.

## Kong AI Gateway

The Kong source of truth is `app/ai-gateway/ai-providers/cohere.md` and the Cohere entry in `app/_data/ai-gateway/v2/providers.yaml`.

| Kong capability | Upstream                     | Required Kmodels evidence                     |
| --------------- | ---------------------------- | --------------------------------------------- |
| `generate`      | `/v1/chat`                   | `generate` plus exact Chat V1 support         |
| `completions`   | `/v1/generate`               | `generate` plus exact legacy Generate support |
| `embeddings`    | `/v2/embed`                  | `embeddings` plus exact Embed support         |
| `rerank`        | `/v1/rerank` or `/v2/rerank` | `rerank` plus the exact supported API version |

The two transcription models remain outside Kong's Cohere capability matrix. `generate` still cannot distinguish Chat from legacy Generate, so a projection must intersect operation, exact route, lifecycle, and account evidence. Kong's current examples do not override conflicting or missing Cohere model evidence.

## Refinement decision

The model overview's tables are now bound to their reviewed Command, Embed, Rerank, Audio, or Aya section. Sparse platform tables take their operation from that section instead of an identifier prefix, while endpoint-bearing rows use the reviewed endpoint definition; a model table under an unknown section fails closed. Endpoint links are joined to fixed official Markdown API references whose headings and request URLs are validated atomically, and one definition now owns both operation and route. Enabled Command-card labels preserve Chat V1, Chat V2, and the OpenAI-compatible Chat Completions route. The current Embed, Rerank, Audio Transcriptions, and legacy Generate references preserve their exact versions. The Embed Jobs route is limited to the four models explicitly enumerated by its request schema, so the broader overview does not leak that route onto `embed-v4.0`.

The authenticated inventory retains its structured operation families but emits paths only for version-unambiguous legacy enums (`generate`, `summarize`, and `classify`). Current `embed_image` and `transcriptions` values establish embeddings and audio transcription, while generic `chat`, `embed`, and `rerank` values are not assigned a version. A zero context on image-only embedding variants is non-evidence rather than a zero-token limit. Unknown endpoint labels, missing model links, a changed API title/path, truncated pagination, or malformed inventory data fail closed.

Repeated responsive copies of a structured pricing product must now agree before they collapse, closing the last-write-wins gap without changing any current rate. Transcription stays in Kmodels and is excluded only by a future Kong projection. Unknown lifecycle, price, and account availability remain explicit. The pricing representation is unchanged in this provider turn: `docs/pricing.md` is still a repo-wide migration proposal, and Cohere's current token, search, and Model Vault observations remain in their native units until that migration is implemented coherently for every provider.
