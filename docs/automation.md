# Automation

Status: implemented

- GitHub Actions checks every push and pull request.
- Vite+ (`vp`) is the project command entry point. The pinned pnpm version and
  `pnpm-lock.yaml` remain authoritative underneath it, and CI installs the
  lockfile frozen.
- Only native dependencies allowlisted in `pnpm-workspace.yaml` may run install scripts.
- The scheduled refresh runs hourly with jitter and commits the validated
  catalog, public-only parsed pricing compiler input, canonical pricing,
  derived UI/export asset indexes and packs, fetch state, quarantine, and
  refresh summary using a `chore(data): ...` commit. Its commit records the
  producing Actions run in a `Kmodels-Refresh-Run` trailer. Deployment checks
  out full history so the website generation-time link can resolve the latest
  catalog-producing commit and prefer that run, while manually produced catalog
  commits fall back to their GitHub commit page. A successful refresh completion
  triggers deployment explicitly because a push authenticated with the workflow
  `GITHUB_TOKEN` does not emit another `push` workflow run. Deployment always
  checks out the latest `main`, while ordinary human-authenticated pushes retain
  their direct deployment trigger.
- The collector owns failure classification and the safe public status
  projection. The workflow renders its structured report into the GitHub job
  summary, emits warnings for retained or withheld providers, and keeps the
  complete report as a 30-day artifact. A failure before report creation is
  called out explicitly and commits nothing.
- The report keeps its provider table compact: model and source deltas use `+`, `−`, and `~`, while
  publication, pricing, and signal values remain stable machine-readable labels. A collapsible
  legend defines each value and distinguishes a published semantic model update from a source
  content, extractor, or field-path change. Provider-specific model changes and operational details
  use compact tables with zero counters omitted; explanatory semantics and shorthand stay in the
  external legend. Every changed model has one row with leaf-level previous/current field values.
- A recognized source-contract mismatch warns on its first occurrence with bounded path,
  mismatch kind, affected/observed counts, fingerprint, and public sample IDs
  when available. A second consecutive source failure adds persistence and,
  when available, last-success staleness. Unclassified parser failures and abrupt count loss
  remain `possible_structural_change`; automation never upgrades that heuristic
  into a factual schema-change claim.
- Provider collection is work-conserving with four bounded workers. Completion
  of a fast provider immediately starts the next provider instead of waiting
  for the slowest member of a fixed batch. Source order inside a provider stays
  deterministic because overlays and inventories can depend on catalog output.
- Scheduled refresh validates only the generated catalog suite and production
  build. It does not rerun code-only unit and fixture tests when the checkout is
  unchanged. Push and pull-request CI runs those tests once. Generated-data
  assertions follow the boundary and volatility rules in [Testing](testing.md).
- One non-isolated, single-worker generated-data test project shares one parsed
  catalog/pricing context. Pricing runs one whole-catalog topology and limit
  pass, then validates provider partitions
  through four work-conserving worker threads. Large providers therefore run
  concurrently without parsing the 100+ MB resource more than once. Per-test
  timeouts remain an inner diagnostic; the 30-minute refresh job timeout is the
  outer safety cap.
- The catalog and canonical pricing advance as one validated accepted pair. Collection
  overlaps provider validation with canonical serialization, then freezes and
  brands the exact candidate object. Commit can therefore create both consumer
  projections and stage the immutable pair without repeating semantic
  validation. It advances one atomic pointer and repairs durable mirrors after
  interruption. Production verifies pair-bound projection manifests and
  encoded entry hashes without parsing the canonical pair.
- The `compile:pricing` task also makes canonical pricing compilation available
  independently. It performs no fetch, validates the catalog-bound public
  parsed input, and republishes the accepted pair and projections. The
  `prepare:assets` task remains the narrower projection-only repair.
- `KMODELS_PRICING_RELEASE_INPUT` is an optional reviewed manual-release input
  for explicit absence/removal/withdrawal intents and pair-bound safety
  findings. Scheduled source adapters cannot create it; an unresolved finding
  must be resupplied for every attempted build until a safe pair commits.
- Provider secrets are optional. Missing secrets skip only their scoped inventories.
- Deployment uses the pinned `void` dependency and GitHub OIDC. `void.json` deploys static `dist/`; `VOID_PROJECT` is the only repository variable.
- Renovate uses the Shanghai timezone, a seven-day minimum release age, grouped automerge for
  non-major updates, and isolated manual major updates. Its custom package-manager matcher keeps
  the strict `devEngines.packageManager.version` pin synchronized with the standard
  `packageManager` pin.
