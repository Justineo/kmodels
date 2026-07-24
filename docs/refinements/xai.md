# xAI refinement

Status: implemented and revalidated against live official sources on 2026-07-23

## Catalog assessment

The live replay has 20 rows: 11 active, one deprecated, and eight retired; two active rows separately carry preview maturity. It covers text, multi-agent, image, video, and speech-to-speech models, with 12 rows carrying published prices and eight historical rows remaining unknown. Multi-agent behavior remains endpoint and capability evidence, while realtime remains transport.

The failed refresh was caused by two reviewed source changes: Realtime audio pricing moved from a token field to `realtimeAudioSecondPrice`, and the Voice Agent documentation became Speech to Speech. The adapter now validates only the operation-specific structured fields it consumes and cross-checks TTS characters, STT batch/streaming seconds, Realtime audio seconds, and Realtime text messages against the public pricing table. A changed amount still rejects the provider atomically.

Seven rows publish nine exact API endpoint facts. Each fact requires an allowlisted capability section to retain its exact example ID or alias and request URL, and that identity must resolve to exactly one current structured row. Grok 4.5 has Chat Completions and Responses; the Multi-agent model has Responses; the quality image model has generations and edits; both directly documented video models have generations; and both Speech to Speech rows have Realtime. No endpoint is inherited from a broad operation.

## Kong AI Gateway 2.0

The Kong source of truth is `app/ai-gateway/ai-providers/xai.md` and the xAI entry in `app/_data/ai-gateway/v2/providers.yaml`.

Kong supports non-streaming Chat Completions, Function Calling, Responses, and Image Generations. The exact current intersection is Grok 4.5 for Chat Completions and Responses, Grok 4.20 Multi-agent for Responses, and Grok Imagine Image Quality for Image Generations. Function Calling additionally requires the model's positive tool-call capability.

Kong does not list Image Edits, Video Generations, or Realtime for xAI, so those valid provider facts stay outside the Kong matrix. Its examples have drifted: `grok-3` is retired, while `grok-4` and `grok-2-image` are not current IDs or aliases. Kmodels does not invent replacements for those names.

## Refinement decision

1. Keep the public structured catalog plus fixed `llms.txt` companion as one atomic source; the fresh replay confirms that retained-source design.
2. Model each audio operation with only its current required pricing fields and validate every consumed amount against the public pricing table; do not make changed fields broadly optional.
3. Publish API paths only from exact model/example bindings that resolve once. Missing evidence means unknown support, not a negative assertion or family-wide inheritance.
4. Derive Kong candidates only from active rows with an acceptable release stage whose exact route intersects Kong's documented surface.
5. Keep Image Edits, Video Generations, and Realtime in Kmodels but outside Kong's current xAI matrix; keep optional authenticated inventories scoped to account validation.
