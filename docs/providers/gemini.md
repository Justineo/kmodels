# Gemini API

Status: current

## Sources and identity

- The exhaustive English-pinned bundle starts at the official model index, follows 30–60 reviewed model cards, and includes fixed pricing, lifecycle, release, Gemma, Interactions, method, and Live references.
- Callable IDs come only from labeled model or agent codes; paths never become IDs.
- Keep current and historical IDs, explicit aliases, facts, and dates bound to their source rows.
- Optional authenticated `/v1beta/models` is account-scoped. Exact `name` stays authoritative when `baseModelId` is absent. Pagination or malformed items reject the source; it cannot create rows or retain raw data.
- Enable the optional inventory with `GEMINI_API_KEY`.

## Mapping

- Tasks are non-exclusive. Agent and computer-use rows remain text generation with endpoint/capability evidence. Live audio is `speech_to_speech`.
- Interactions and every supported method require exact listed IDs plus fixed method/route references. Names, modalities, spelling, and neighboring tasks never imply an endpoint.
- Only reviewed `supportedGenerationMethods` with pinned REST/WebSocket routes add endpoint or delivery facts. Missing or unknown methods remain unknown.
- Preserve native pricing units and conditions. A storage price stated “per million tokens per hour” is a token-hour denominator, not token throughput. Explicit free tiers are zero rates; missing or unparseable prices remain unknown.
- Interpret each paid table cell under its published billing header as one commercial value. Under a token header, a token price is primary and adjacent per-image figures are equivalent usage examples, even across line breaks; they are not additional charges. A per-image value is used only when the cell has no token price.

## Kong AI Gateway

- Derive compatibility from exact methods such as `generateContent`, `embedContent`, `batchEmbedContents`, `BidiGenerateContent`, or `predictLongRunning`; they are not interchangeable.
- Files and batches are service-level. Text agents, speech synthesis, translation, and audio generation are not automatically in Kong's Gemini matrix.
- Do not normalize documentation spelling drift into route evidence or alias stale/missing Kong examples to newer IDs.
