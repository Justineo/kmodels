# Gemini API

Status: current

## Sources and identity

- The exhaustive English-pinned bundle starts at the official model index,
  follows every reviewed model-card target, and includes fixed pricing,
  lifecycle, release, Gemma, Interactions, method, and Live references.
- A card target may describe one model or a family. Every property table with a
  labeled model or agent code is parsed independently, so shared overview pages
  do not silently collapse to their first model. Callable IDs still come only
  from those labeled cells; paths and headings never become IDs.
- Keep current and historical IDs, explicit aliases, facts, and dates bound to their source rows.
- Optional authenticated `/v1beta/models` is account-scoped. Exact `name` stays authoritative when `baseModelId` is absent. Pagination or malformed items reject the source; it cannot create rows or retain raw data.
- Enable the optional inventory with `GEMINI_API_KEY`.

## Mapping

- Tasks are non-exclusive. Agent and computer-use rows remain text generation with endpoint/capability evidence. Live audio is `speech_to_speech`.
- Interactions and every supported method require exact listed IDs plus fixed method/route references. Names, modalities, spelling, and neighboring tasks never imply an endpoint.
- Only reviewed `supportedGenerationMethods` with pinned REST/WebSocket routes add endpoint or delivery facts. Missing or unknown methods remain unknown.
- Pricing sections bind through an exact model ID or one unique explicit alias.
  Unknown references, table headers, units, meters, or agent-pricing structure
  reject the source. At least 80% of non-retired models must retain numeric
  pricing; deliberate official omissions remain below that guard.
- `Free Tier` and `Paid Tier` are account eligibility, while Standard, Batch,
  Flex, and Priority remain inference service tiers. Only the exact phrase
  `Free of charge` becomes a zero rate. A storage price stated “per million
  tokens per hour” remains a token-hour denominator, and search grounding
  stated per 1,000 requests remains request pricing.
- Interpret each paid table cell under its published billing header as one commercial value. Under a token header, a token price is primary and adjacent per-image figures are equivalent usage examples, even across line breaks; they are not additional charges. A per-image value is used only when the cell has no token price.
- Shared Google Search allowances stay as bounded raw allowance facts because
  their quota spans several models and cannot truthfully become a per-model
  allowance. Agent pricing likewise stays as a raw base-price formula because
  the total is the selected underlying model consumption plus tools. Neither is
  converted to zero or a fabricated fixed price.
- Release dates require exact codes in a dated changelog item containing a
  reviewed release verb. Prefix text is allowed; names and date-like ID
  suffixes are not release evidence.

## Kong AI Gateway

- Derive compatibility from exact methods such as `generateContent`, `embedContent`, `batchEmbedContents`, `BidiGenerateContent`, or `predictLongRunning`; they are not interchangeable.
- Files and batches are service-level. Text agents, speech synthesis, translation, and audio generation are not automatically in Kong's Gemini matrix.
- Do not normalize documentation spelling drift into route evidence or alias stale/missing Kong examples to newer IDs.
