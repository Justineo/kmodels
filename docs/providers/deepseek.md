# DeepSeek

Status: current

## Sources and identity

- The exhaustive global catalog is the official Models & Pricing table. Callable IDs and facts come only from labeled columns.
- Legacy IDs remain separate only while the current authoritative catalog names and maps them explicitly. When that evidence is removed, exhaustive collection removes those rows instead of retaining a historical compatibility assumption; underlying rolling revisions do not become request IDs.
- Lifecycle/replacements require an exact official footnote. Release/update dates require an exact callable ID in a dated log entry.
- Optional authenticated `/models` is account-scoped exact-schema validation. It may add API provenance to exact public matches but cannot create/remove rows or retain raw data.
- Enable the optional inventory with `DEEPSEEK_API_KEY`.

## Mapping

- Chat Completions evidence requires the fixed title, POST operation, request-model enum, thinking controls, effort values, and streaming field.
- Only exact currently listed IDs receive those facts.
- Keep direct cached-input, input, and output prices bound to the exact table column.
- The beta FIM and Anthropic-compatible interfaces require distinct base URLs. Do not publish them as bare paths until the route schema can retain that requirement.
- Ignore page metadata, dates embedded in IDs, and unused feature cells that contribute no public facts.

## Kong AI Gateway

- Candidates require active lifecycle, exact Chat Completions evidence, positive streaming, and account availability.
- Kong's versioned OpenAI-compatible upstream may intersect DeepSeek's reviewed unversioned resource; broad text generation alone cannot.
- Historical change-log mentions do not restore IDs absent from the exhaustive current catalog.
