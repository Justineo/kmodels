# Vertex AI

Status: current

## Sources and identity

- Use current Gemini Enterprise Agent Platform catalogs while retaining provider identity `Vertex AI`.
- Each regional Google, partner, and open-model catalog is independent and non-exhaustive. Pin English and accept IDs only from labeled cells.
- Keep publisher/API families, facts, lifecycle, and exact region/deployment pairs bound to model cards. Paths, labels, approximate dates, and page metadata do not create identity or dates.
- Optional paginated Model Garden inventory is account-scoped. Use the fixed publisher set and 300-item page maximum; an omitted repeated field is an empty page. It cannot create rows or retain raw data.
- Enable the optional inventory with `GOOGLE_SERVICE_ACCOUNT_JSON`.

## Mapping

- Endpoint evidence is family-scoped and requires its fixed reference: Google `generateContent`, `embedContent`, `predict`, or `predictLongRunning`; Claude raw prediction; Grok/Llama OpenAI-compatible routes; or an exact managed-open sample.
- Mistral partner cards, unlisted open models, and Live/Realtime Google cards receive no inferred endpoint.
- Tasks, sibling models, and generic Vertex methods never widen route support.
- Price joins require one unique official model identity. Preserve tier, context, cache, region, modality, unit, and exact conditions.
- Treat the published `<=` and `=<` 200K headings as the same closed upper bound. The separate unqualified regional table is the default regional scope when an unequal Global price exists; it is not widened over the Global rate.

## Kong AI Gateway

- Kong's provider is Gemini Vertex, not a generic adapter for every Vertex model.
- Compatibility requires the Gemini-compatible publisher/API family, exact method, active lifecycle, acceptable maturity, and region.
- Partner/open-model text generation alone is insufficient.
- Files, batches, and ranking configuration may be service-level/native operations without a selected model row.
- Missing route evidence and absent Kong examples remain unknown; never infer aliases.
