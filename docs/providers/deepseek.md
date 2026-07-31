# DeepSeek

Status: current

## Sources and identity

- The exhaustive global catalog is the official Models & Pricing table. Callable IDs and facts come only from its model columns; compatibility names mentioned only in footnotes or history do not become current rows.
- Parse and validate every table row. Base URLs, beta feature support, and positive concurrency values are source-shape contracts even when the public model schema cannot represent their base-path or account-quota semantics.
- Lifecycle/replacements require an exact official footnote. Release/update dates require a valid dated log entry and exact callable ID. “Backward compatibility” establishes an update or alias observation, never a first release.
- Optional authenticated `/models` is account-scoped exact-schema validation. It may add API provenance to exact public matches but cannot create/remove rows or retain raw data.
- Enable the optional inventory with `DEEPSEEK_API_KEY`.

## Mapping

- Chat Completions evidence requires exactly one POST `/chat/completions` operation plus the request-model enum, thinking controls, effort values, streaming field, JSON response format, and function-tool schema. Responses evidence requires exactly one POST `/responses` operation and exact agreement between its request-model enum and the per-model support row. Display headings are nonsemantic and may change independently.
- Only exact currently listed IDs receive those facts. Publish Responses only for models positively named by both official sources.
- Keep direct cached-input, input, and output prices bound to the exact table column.
- The beta FIM and Anthropic-compatible interfaces require distinct base URLs. Validate their support rows but do not publish them as bare paths until the route schema can retain that requirement.
- Concurrency limits are account-level defaults that can be expanded, not architectural model limits, so validate but do not publish them under `limits`.
- Do not publish page metadata or dates embedded in IDs.

## Kong AI Gateway

- Candidates require active lifecycle, exact Chat Completions evidence, positive streaming, and account availability.
- Kong's versioned OpenAI-compatible upstream may intersect DeepSeek's reviewed unversioned resource; broad text generation alone cannot.
- Historical change-log mentions do not restore IDs absent from the exhaustive current catalog.
