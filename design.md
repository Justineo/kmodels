# Kmodels design

Status: implemented compact revision
Last decision update: 2026-07-22

## Product boundary

Kmodels is a best-effort catalog of model offerings published by 19 providers. Its two public resources are `Provider` and `ProviderModel`; identical names across providers remain distinct. Global presence means “observed in an official global catalog”, never account availability; `exhaustive` separately records whether the source claims completeness. Missing price means unknown, never free.

The repository ships two things from one TypeScript project:

1. `scripts/collect.ts` produces versioned static JSON without an LLM or inference call.
2. A plain HTML/CSS website reads that JSON. Void deploys the built `dist/` directory as a static site; there is no production worker.

## Collection decisions

- `src/catalog/manifests.ts` is the reviewed source allowlist and provider registry. Root URLs never arrive from a request. Discovered documents require an exact same-host path policy; a source may also enumerate fixed companion URLs whose hosts, keys, and byte limits are reviewed in the manifest.
- Sources declare `scope`, `exhaustive`, and `role`. Catalog sources create rows; overlays may replace only their declared fields on an existing row; account, region, workspace, and runtime inventories validate scoped availability but cannot delete or create global rows. Only a global catalog marked exhaustive supports a completeness claim.
- Prefer documented structured sources, then parse allowlisted official catalogs for missing fields. Dedicated structural adapters accept model IDs only from explicitly labeled ID fields or reviewed model-page paths and validate a provider-neutral identifier grammar; they do not enumerate current product-name prefixes. Vercel, Cerebras, Hugging Face and Ollama use structured adapters. Other providers use a conservative document adapter with a provider-specific pattern because their page structure does not identify callable fields; xAI identifiers come from reviewed model-page link targets. vLLM is reported as not configured unless an explicitly allowlisted runtime is added in code.
- Optional authenticated sources read named environment variables. Their raw responses are never snapshotted or published because account inventories can contain private fine-tuned model IDs. Missing authentication and source failures produce structured warnings without weakening a successful global catalog refresh.
- A successful scoped inventory may update its declared structured fields on an exact public model ID or unambiguous public alias. It still cannot create or remove a global row; unmatched IDs are counted only in a set-mismatch warning. This makes authenticated structured facts the highest-priority observation for matching rows without confusing account availability with global presence.
- An exact ID observed by a catalog always creates its own row, even when another catalog row also lists that ID as an alias. Alias matching is reserved for overlays and scoped inventories; aliases that equal a canonical ID are removed before those sources are applied. This prevents historical alias relationships from collapsing distinct products such as `o1` and `o1-preview`.
- Every response is size-limited, time-limited, conditionally fetched with ETag/Last-Modified, and redirected only to a host listed for that source. The TypeScript collector invokes `curl` without a shell so CI and proxied developer environments use a mature TLS/proxy transport while URL policy remains in code. Retries apply only to transient failures.
- Raw bodies are content-addressed, gzip-compressed snapshots. A source record binds URL, observation time, hash, extractor version and snapshot path.
- Candidate catalogs are validated per provider. Empty successful responses, duplicate IDs, invalid prices, model drops over 10%, price-rate drops over 20%, and non-promotional price changes over 50% are quarantined.
- Publication is failure-closed and provider-atomic. A rejected provider keeps its last validated models; providers do not block one another. One missing observation never deletes a model.
- Money is stored as source decimal strings. Scaling uses decimal-string arithmetic; binary floating-point is never used for price calculations.
- Generated files are `data/catalog.json` (durable previous state) and static endpoints under `public/v1/`. The website consumes `/v1/catalog/index.json`.

### OpenAI integration

- `GET /v1/models` is an authenticated, account-scoped inventory. Its documented object has only `id`, `object`, `created`, and `owned_by`; Kmodels validates that structure and compares identifier sets, but does not publish its private rows or interpret absence as deprecation.
- `/api/docs/models/all` is the exhaustive global catalog. The collector follows only 80–140 exact same-host `/api/docs/models/{id}` links and parses each model page for the official request ID, display name, description, aliases and snapshots, normalized task and modalities, token limits, capabilities, lifecycle badge, and every published price card.
- Direct text, audio, image, embedding, per-image, per-second, and per-minute rates retain their native units. Batch prices use an explicit service-tier condition. Published long-context and cache-write multipliers become exact decimal derived rates with their conditions; no binary floating-point is used. Explicitly open-weight models and free moderation models use `not_applicable`; an unparseable or absent hosted price remains `unknown` and emits an aggregate warning.
- `/api/docs/models` is a narrow alias overlay: aliases are accepted only from the same model card as their Model ID, so one card cannot leak an alias into its siblings.
- `/api/docs/deprecations` is an optional lifecycle overlay for current catalog IDs. It supplies deprecation/retirement state, shutdown date, and exact replacement model IDs. OpenAI's documented “legacy” label is not treated as deprecated until a deprecation is announced.

### Anthropic integration

- The exhaustive public catalog starts from the official Markdown model overview and follows exactly three same-host Markdown companions: pricing, model deprecations, and the Fable 5/Mythos 5 launch page. API IDs and aliases come only from labeled table cells; display labels are joined to lifecycle and price rows by a normalized identity only when the observed match is unique. No callable ID is generated from a display name.
- The overview supplies current and legacy display names, descriptions, aliases, modalities, thinking support, and token limits. Deprecation status and history supply active/deprecated/retired state, dates, and exact replacements, including historical retired IDs. The launch page supplies the separately observed Mythos facts.
- Direct, batch, fast-mode, 5-minute cache-write, 1-hour cache-write, and cache-read prices retain their published million-token unit and conditions. Sonnet 5 effective dates are explicit. Cache prices for batch/fast tiers and US-only inference prices are derived only from Anthropic's published stacking multipliers using decimal-string arithmetic; `inference_geo` remains a rate condition.
- `GET /v1/models?limit=1000` is an optional authenticated account inventory using `x-api-key` and the documented API version header. A complete one-page response overlays display name, release date, modalities, token limits, and structured capability flags on matching public rows. `has_more: true`, an empty result, or schema drift fails the optional source rather than publishing an incomplete interpretation. Raw inventory data is never persisted.

### Amazon Bedrock integration

- The exhaustive public catalog starts from AWS's model-card index and follows only reviewed same-host model-card Markdown paths. Callable base IDs and geo/global inference-profile aliases come exclusively from the labeled Programmatic Access table. Distinct Runtime and Mantle IDs remain distinct rows; no ID is generated from a display label.
- Model cards supply display name, description, launch date, formal lifecycle, exact announced retirement dates, modalities, context and output limits, reasoning, prompt caching, computer use, and endpoint aliases. `Legacy` is Bedrock's formal deprecated lifecycle; a “no sooner than” date is a guarantee, not an observed retirement date, and is therefore not published as one.
- The same atomic source fetches the three fixed AWS Price List Bulk API offers for Bedrock, Bedrock Foundation Models, and Bedrock Service. Rates join to a card only through a unique normalized official display identity or an exact model-ID occurrence in the usage code. Ambiguous products are skipped. All regions, Runtime/Mantle endpoint, in-region/geo/global routing, service tier, cache TTL, long-context threshold, image operation/quality/resolution, reserved capacity direction, native unit, and effective date remain explicit conditions. Per-1K token prices are normalized to per-million with decimal-string arithmetic.
- `ListFoundationModels` in `us-east-1` is an optional SigV4-authenticated regional inventory implemented with the official AWS SDK. It overlays exact matching public IDs with structured name, modalities, streaming, fine-tuning, and lifecycle timestamps, but cannot define global presence or create rows. Its raw response is never snapshotted. CI can enable it with `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and, for temporary credentials, `AWS_SESSION_TOKEN`.

## Public data semantics

- `account_availability` is always `unknown`.
- `model_id` is an official request identifier when observed as one; otherwise it is an explicitly typed source identifier. `name` retains a separately observed display label. Bedrock model cards may publish different IDs for `bedrock-runtime` and `bedrock-mantle`; each unique callable ID is a separate provider-model row with the shared display name.
- `types` contains exactly one normalized primary task: `text_generation`, `embedding`, `rerank`, `moderation`, `image_generation`, `video_generation`, `speech_to_text`, `text_to_speech`, `speech_to_speech`, `computer_use`, `classifier`, `ocr`, or `other`. Reasoning stays a capability, multimodality stays in `modalities`, and code generation is text generation rather than a separate task.
- Task evidence is applied in order: an exact reviewed task marker in the official identifier or display name, a structured source type, an output modality, then the source's reviewed default. Legacy mixed-dimension types are normalized when read. `other` is reserved for a future observed task that cannot be represented without guessing; classification never uses an LLM or facts inherited from another provider.
- Capability flags are tri-state. Absence from a source stays `unknown`.
- `is_deprecated` is tri-state and consistent with observed lifecycle evidence; `replacement_model_ids` contains only exact same-provider IDs observed in an official lifecycle source.
- `source_refs` resolve into catalog source records.
- Pricing rates retain meter, currency, unit and applicable context/route conditions. Hugging Face routes are separate rates; no minimum or average is invented.
- A provider coverage entry says `fresh`, `stale`, `unavailable`, or `not_configured` and carries a machine-readable reason without exposing private runtime URLs.
- Catalog warnings are structured by `code` with optional provider, source, and field context. Missing authentication, failed fetches/parses, scoped set mismatches, and aggregated missing-field coverage remain visible without warning per model row.

## Website decisions

Visual thesis: a compact monochrome index—white canvas, near-black text, cool-gray rules and green reserved for source freshness.

Content plan: one narrow status bar, one filter row and the model index. Model identifiers and separately observed display names have distinct columns; the display-name cell is blank when `name` is only the required `model_id` fallback. Text-token pricing is split into input, output and cached-input columns, preferring an unconditional published rate and otherwise showing the first source tier; every tier and cache-write rate remains explicit in model details. There is no hero, methodology section, footer narrative, marketing copy, card grid or decorative imagery. Provenance remains available through model details and the raw JSON link.

Interaction thesis: filter feedback is immediate, rows use a quiet hover state, and model details open in a compact native dialog. The app header, controls and table heading remain sticky; all motion is removed under `prefers-reduced-motion`.

The CSS begins with a modern reset, uses system fonts, and remains usable without JavaScript through an explanatory HTML shell. JavaScript writes external values with `textContent`, not HTML interpolation.

## Automation and ownership

- GitHub Actions checks the project on pushes and pull requests.
- pnpm is the sole package manager. Its version is pinned in `package.json`, `pnpm-lock.yaml` is authoritative, and CI uses a frozen lockfile. Only the reviewed native tooling dependencies in `pnpm-workspace.yaml` may run install scripts.
- A scheduled workflow checks sources every 30 minutes, applies jitter, and commits only validated generated changes. Provider secrets are optional; absent secrets skip only their scoped inventories.
- The deploy workflow uses the repository’s pinned `void` dependency and GitHub OIDC; `void.json` declares a plain static `dist` deployment. `VOID_PROJECT` is the only repository variable.
- Renovate follows the repository’s Shanghai timezone, seven-day minimum release age, grouped automerge for non-major updates, and isolated manual major updates.

## Change rule

When code and this document disagree, update the code or this document before merging. New providers, extraction heuristics, public fields, drift thresholds, deployment shape, or visual system changes are repo-scope decisions and must be recorded here.
