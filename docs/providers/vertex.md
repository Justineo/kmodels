# Vertex AI

Status: current

## Sources and identity

- Use current Gemini Enterprise Agent Platform catalogs while retaining provider identity `Vertex AI`.
- Each regional Google, partner, and managed-open catalog is independent and non-exhaustive. Use the MaaS model list—not the generic self-deployment chooser—as the open-model index. Pin English and crawl bounded model-card namespaces; same-depth capability guides can be fetched, but only documents containing labeled model cards satisfy card-coverage bounds.
- Accept card IDs from labeled `Model ID` cells. Partner and open indexes can also contribute the exact publisher, ID, name, description, and modality encoded by a unique Model Garden URL; if one URL is reused by differently named rows, none of those rows creates identity.
- Keep publisher/API families, facts, lifecycle, and exact region/deployment pairs bound to the relevant card section. A publisher link elsewhere on a shared page cannot classify another model.
- Normalize the documented `global endpoint` and geography-labeled `Multi-region` values to `global`, `us`, or `eu`. Other availability requires an exact region code.
- Parse full or abbreviated English dates, labeled deprecation/retirement/discontinuation dates, and exact endpoint-replacement tables. A future retirement date does not retire a model early.
- Parse token limits from `Token limits`, `Quota`, `Quotas`, `Quota limits`, and labeled maximum-sequence rows. A one-letter token suffix is a unit only when it is not the beginning of the next label.
- Paths, display labels, approximate dates, and page metadata do not create identity or dates.
- Optional paginated Model Garden inventory is account-scoped. Use the fixed publisher set and 300-item page maximum; an omitted repeated field is an empty page. It cannot create rows or retain raw data.
- Enable the optional inventory with `GOOGLE_SERVICE_ACCOUNT_JSON`.

## Mapping

- Endpoint evidence is family-scoped and requires its fixed reference: Google `generateContent`, `embedContent`, `predict`, or `predictLongRunning`; the text-embedding reference's exact supported-model table and literal regional examples; Claude raw prediction; Grok/Llama OpenAI-compatible routes; or an exact managed-open sample.
- Mistral partner cards, unlisted open models, and Live/Realtime Google cards receive no inferred endpoint.
- Tasks, sibling models, and generic Vertex methods never widen route support.
- Price joins preserve parameter-size and version discriminators. Reviewed terminal API suffixes can expose a family key, and one official family label can apply to every exact ID carrying the same card name. A less-specific label is otherwise accepted only when it has one most-specific target; unmatched or ambiguous labels do not inherit the preceding model.
- Preserve tier, context, cache, region, modality, unit, and exact conditions. Expand a shared `Flex/Batch` amount into the two selectable tiers; an explicitly labeled amount applies only to its tier. `Online requests` is Standard and `Batch requests` is Batch.
- Treat the published `<=` and `=<` 200K headings as the same closed upper bound. The separate unqualified regional table is the default regional scope when an unequal Global price exists; it is not widened over the Global rate.
- When an otherwise identical unequal promotional row is explicit, the unqualified companion row is non-promotional. Unqualified regional prices without such a paired distinction stay unmodified.
- Normalize explicit token, character, image, frame, second, and request prices. A fixed-duration song is one request, not a per-second rate. Preserve alternative per-page amounts and malformed duplicate labels as commercial raw facts instead of guessing their applicability.
- Every current-model pricing source has a reviewed minimum numeric-coverage ratio: 80% for Google models and 90% for partner and managed-open models. Falling below it rejects the source. Provider-level tools, agents, tuning, optimizer examples, and Provisioned Throughput are not model base rates and are not attached to model offers.

## Kong AI Gateway

- Kong's provider is Gemini Vertex, not a generic adapter for every Vertex model.
- Compatibility requires the Gemini-compatible publisher/API family, exact method, active lifecycle, acceptable maturity, and region.
- Partner/open-model text generation alone is insufficient.
- Files, batches, and ranking configuration may be service-level/native operations without a selected model row.
- Missing route evidence and absent Kong examples remain unknown; never infer aliases.
