# Automation

Status: implemented

- GitHub Actions checks every push and pull request.
- A separate daily `Catalog repair` workflow first runs a deterministic, non-AI gate. The schedule
  alone never starts Copilot: inference begins only when the latest committed refresh report contains
  a parser failure, a changed source-contract finding, a rejected provider validation, or a failed
  pricing validation. The gate excludes only operational states such as fetch failures and missing
  credentials, plus unresolved pricing by itself. It deliberately does not pre-judge which changed
  source caused a provider regression; Copilot reviews every listed candidate and decides whether a
  safe code repair exists. A provider simply not publishing a price is never a repair candidate.
- The same repair workflow is manually dispatchable from GitHub Actions or with
  `gh workflow run catalog-repair.lock.yml`. Manual runs use the same issue gate and deduplication
  rules as scheduled runs.
- Repair runs are serialized. After an active run finishes, any queued run checks for an open pull
  request labeled `catalog-repair` and exits before inference when one exists. A repair changes only
  the smallest reproducible parser contract, reviewed fixture, regression test, extractor version,
  and provider guide. It never changes generated `data/`, weakens a drift guard, or guesses a price.
  Repair inference uses GPT-5.6 Luna with high reasoning effort to keep the recurring task
  cost-efficient while retaining deeper analysis for source-drift diagnosis.
  Successful repairs are proposed as one labeled draft pull request for human review; there is no
  direct push or automatic merge. Because this is a personal repository, Copilot inference uses a
  fine-grained personal token with `Copilot Requests: read` stored as `COPILOT_GITHUB_TOKEN`; the
  ordinary GitHub CLI OAuth token is not an acceptable substitute.
- Agentic workflow Markdown is the reviewed source and `gh aw compile` produces the matching
  `.lock.yml`; generated lock files are not reformatted or edited by hand.
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
  commits fall back to their GitHub commit page. After a refresh commits and
  pushes changed data, it explicitly dispatches the dedicated deployment
  workflow because a push authenticated with the workflow `GITHUB_TOKEN` does
  not emit another `push` workflow run. Void accepts the dispatch workflow's
  GitHub OIDC token; deployment always checks out the latest `main`, while
  ordinary human-authenticated pushes retain their direct deployment trigger.
- The collector owns failure classification and the safe public status
  projection. The workflow renders its structured report into the GitHub job
  summary, emits warnings for retained or withheld providers, and keeps the
  complete report as a 30-day artifact. A failure before report creation is
  called out explicitly and commits nothing.
- The report's provider table pairs current model, source, and pricing-coverage counts with their
  deltas. Model and source deltas show only nonzero `+`, `−`, and `~` terms; coverage deltas
  separately show changes in resolved and unknown model counts. Catalog publication and pricing
  publication have separate columns because fresh catalog data can advance while failed pricing is
  retained. Summary enum cells use only emoji; the structured report retains stable machine-readable
  values and a collapsible set of compact legend tables defines every icon by column and boundary.
  Coverage uses ✅ for resolved models and ❓ for unresolved models in both the current value and
  delta. The legend distinguishes a published semantic model update from a source content,
  extractor, or field-path change and defines pricing coverage. Every retained or withheld
  candidate has a provider-local table naming the affected boundary, failed source or validation
  stage, exact sanitized reason, and published fallback. Provider-specific model changes and
  operational details use compact tables with zero counters omitted. Every changed model has one
  row with leaf-level previous/current field values.
- A recognized source-contract mismatch warns on its first occurrence with bounded path,
  mismatch kind, affected/observed counts, fingerprint, and public sample IDs
  when available. A second consecutive source failure adds persistence and,
  when available, last-success staleness. Unclassified parser failures and abrupt count loss
  remain `possible_structural_change`; automation never upgrades that heuristic
  into a factual schema-change claim.
- Collection starts every provider concurrently because provider fetch, failure,
  validation, and publication boundaries are independent. Total collection time
  therefore approaches the slowest provider instead of accumulating behind a
  shared provider-worker limit. Within one provider, source transports with disjoint
  reviewed host sets may overlap; any shared host serializes them, and every
  multi-document transport retains its own reviewed concurrency limit. Parsing and
  application stay in manifest order because overlays and inventories can depend on
  preceding catalog output.
- Scheduled refresh validates only the generated catalog suite and production
  build. It does not rerun code-only unit and fixture tests when the checkout is
  unchanged. Push and pull-request CI runs those tests once. Generated-data
  assertions follow the boundary and volatility rules in [Testing](testing.md).
- One non-isolated, single-worker generated-data test project shares one parsed
  catalog/pricing context. Pricing runs one whole-catalog topology and limit
  pass, then validates provider partitions through four largest-first,
  work-conserving worker threads. Canonical pricing replay likewise assembles
  independent provider partitions through a four-worker pool before one parallel
  candidate-validation pass. Large providers therefore run concurrently without
  parsing the 100+ MB resource more than once. Per-test
  timeouts remain an inner diagnostic; the 30-minute refresh job timeout is the
  outer safety cap.
- The catalog and canonical pricing advance as one validated accepted pair. Collection
  overlaps provider validation with canonical serialization, then freezes and
  brands the exact candidate object. Commit concurrently compresses deterministic
  projection assets and stages the immutable pair without repeating semantic
  validation. It advances one atomic pointer and repairs durable mirrors after
  interruption. Production verifies pair-bound projection manifests and encoded
  entry hashes without parsing the canonical pair.
- The `compile:pricing` task also makes canonical pricing compilation available
  independently. It performs no fetch, validates the catalog-bound public
  parsed input, and republishes the accepted pair and projections. The
  `prepare:assets` task remains the narrower projection-only repair.
- `KMODELS_PRICING_RELEASE_INPUT` is an optional reviewed manual-release input
  for explicit absence/removal/withdrawal intents and pair-bound safety
  findings. Scheduled source adapters cannot create it; an unresolved finding
  must be resupplied for every attempted build until a safe pair commits.
- Provider secrets are optional. Missing secrets skip only their scoped inventories. Azure uses the
  same subscription Reader service principal locally and in Actions and discovers every applicable
  region from subscription metadata.
- Deployment uses the pinned `void` dependency and GitHub OIDC. `void.json` deploys static `dist/`; `VOID_PROJECT` is the only repository variable.
- Renovate uses the Shanghai timezone, a seven-day minimum release age, grouped automerge for
  non-major updates, and isolated manual major updates. Its custom package-manager matcher keeps
  the strict `devEngines.packageManager.version` pin synchronized with the standard
  `packageManager` pin.
