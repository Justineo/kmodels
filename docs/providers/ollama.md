# Ollama

## Official source topology and refresh

- Production refresh uses only first-party Ollama surfaces. The non-exhaustive Library at
  `https://ollama.com/library` supplies current family identities, descriptions, capability badges,
  and update dates. An untagged family name is callable as its default/`latest` tag; the collector
  never invents size, quantization, `:cloud`, `-cloud`, or community-namespace identities.
- Ollama Cloud is one atomic bundle: public `GET https://ollama.com/api/tags`, the Cloud-filtered
  Library search, every current Cloud family page, and `POST https://ollama.com/api/show` for the
  union of exact list IDs and family-page IDs. Family pages provide the authoritative mapping from
  Library tags such as `name:cloud` or `name-cloud` to direct Cloud API IDs. A missing page, list
  detail, or union detail rejects the source.
- Fixed first-party companions include both official `llms.txt` indexes, canonical Markdown for the
  API introduction, list/show contracts, usage, authentication, Cloud routing, OpenAI/Anthropic
  compatibility, web search, tool calling, thinking, and vision, plus raw OpenAPI, pricing, and
  terms. The indexes are discovery sentinels: a new commercial, billing, quota, cache, or usage page
  fails collection until reviewed.
- Ollama documents the local base as `http://localhost:11434/api` and the same Cloud API at
  `https://ollama.com/api`. The API is not strictly versioned, but is expected to remain stable and
  backwards compatible; rare deprecations are announced in GitHub release notes. Release notes are
  policy evidence, not a structured exhaustive model-history feed, so they do not create rows.
- Refresh is deterministic and requires no LLM. It uses exact URLs and hosts, bounded response and
  model counts, schema validation, semantic assertions, normalized page/API payloads, and atomic
  dependency hashes. CI never authenticates or contacts an arbitrary local runtime.

## Identity, API contract, and resilient matching

- The official List Models contract fixes `GET /api/tags`, operation ID `list`, `ListResponse`, and
  `ModelSummary`. The collector owns `name`, `model`, `modified_at`, `size`, `digest`, and the detail
  shape, and accepts the documented optional `remote_model` and `remote_host` fields. Those optional
  transport fields do not manufacture a second catalog identity.
- The official Show Model Details contract fixes `POST /api/show`, operation ID `show`,
  `ShowRequest`, and `ShowResponse`. Capabilities, `model_info`, modification time, and exact parent
  identity provide tasks, modalities, context/embedding limits, updates, and Cloud identity checks.
  Documented optional parameters, license, and template fields are recognized but do not imply
  provider-neutral semantics.
- Raw OpenAPI is independently checked for version 3.1.0, current document version 0.1.0, local
  server and bearer scheme, Tags/Show requests and responses, Generate/Chat/Embed routes, and native
  prompt/output usage counters. New unrelated endpoints do not fail collection.
- Additive top-level fields in list items or successful Show responses are accepted with bounded
  source-contract diagnostics so ordinary API evolution does not interrupt refresh. Changes to
  owned nested details, types, capability enums, identities, counts, status codes, or envelope shape
  fail closed. Request-specific UUIDs in 410 retirement errors and unordered list ordering are
  removed before hashing; family pages are reduced to exact Cloud tags, usage levels, and rate cards.
- Library and Cloud are independent channels. Exact overlaps retain both source and service-family
  evidence. A Cloud retirement is published only for an exact identity with no current Library
  evidence; current Library presence keeps the global row active.

## Model boundary

- The public Library is curated and non-exhaustive. Ollama publishes no stable global endpoint for
  every community namespace and every tag. `/api/tags` on a local daemon describes that operator's
  installed state, not Ollama's global offer, and therefore cannot fill this boundary in CI.
- Cloud docs say models may be deprecated and retired. Current list/page/detail probes capture
  visible transitions and exact 410 responses, but no first-party public API exposes complete
  disappeared-model history. Historical Cloud completeness remains intentionally bounded rather
  than reconstructed from downstream catalogs.

## Public price coverage

- The pricing page publishes plans and allowance mechanics, not a general per-model dollar price
  book: Free is `$0`; Pro is `$20/month` or `$200/year`; Max is `$100/month` with new sign-ups
  paused; Team is `$25/seat/month` with a five-seat minimum and included usage; Enterprise is
  custom. Session limits reset every five hours, weekly limits every seven days, and concurrency
  varies by plan.
- Individual allowance consumption depends on model plus input, cached-input, and output tokens.
  Most Cloud pages publish only `low`, `medium`, `high`, or `extra high` usage. Preserve this ordinal
  label as a raw allowance fact; it is neither currency nor a stable multiplier. Those rows remain
  `not_published` rather than receiving a guessed rate.
- An exact per-model rate card can supply numeric facts when published; other Cloud rows retain their
  official usage-level raw fact and remain `not_published`.
- Local-only weights are `not_applicable` to Ollama provider billing; operator compute and
  infrastructure are outside this price book. A Cloud offer without an exact dollar rate is
  `not_published`. Plans, allowances, taxes, automatic renewal, one-year extra-credit expiry, and
  custom Enterprise terms remain account-level or excluded reconciliation evidence.

## Request, response, and cost boundary

- Native Generate/Chat responses return `prompt_eval_count` and `eval_count`; streaming emits them
  in the final `done: true` chunk. OpenAI compatibility can include usage. Anthropic compatibility
  reports approximate tokenizer counts and does not support prompt caching.
- Native OpenAPI still exposes no cached-input token count even though pricing says cached input
  affects usage. Consequently even Kimi K3 cannot be reconstructed exactly from a normal response
  when cache reads occur. No public Usage/Costs ledger API or freshness contract is documented.
- Thinking, vision input, and client-executed tool follow-ups can alter work or token volume. Ollama
  publishes no separate thinking/image billing meter, and tool execution is client-side. A gateway
  may estimate a published marginal token charge only when an exact rate and every billed counter
  exist; it cannot derive account-effective allowance cost before a request.

## Comparator audit

- models.dev contains an Ollama Cloud generator, but its provider sync does not run it; the published
  files are therefore manual comparison data. LiteLLM's Ollama entries primarily describe local
  models and flatten provider cost to zero, which cannot represent Cloud plan and allowance
  semantics. Other gateway catalogs describe their own routes, not Ollama's offer. None is production
  authority.
