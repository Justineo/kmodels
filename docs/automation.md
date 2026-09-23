# Automation

Status: implemented

- GitHub Actions checks every push and pull request.
- A separate daily `Catalog repair` workflow uses a deterministic code-repair admission gate. The schedule
  alone never starts Copilot: code-repair inference begins when the latest committed refresh report contains
  a parser failure, a changed source-contract finding, known unrecognized public pricing-card
  structure, an explicitly rejected Databricks pricing subpage, a missing owned accounting/endpoint contract, a repeated public 404/410, a rejected provider validation, or a failed
  pricing validation. The gate excludes operational states such as fetch failures and missing
  credentials, plus unresolved pricing by itself. It deliberately does not pre-judge which changed
  source caused a provider regression; Copilot reviews every listed candidate and decides whether a
  safe code repair exists. A provider simply not publishing a price is never a repair candidate.
- Missing owned mappings and unrecognized pricing cards remain candidates on unchanged source bytes;
  accepted publication or fallback does not resolve them. The gate includes their reason counts and
  bounded diagnostic samples. Source candidates do not hide separate pricing validation failures
  for the same provider. Unknown meters and unbound product names alone are not automatically
  parser failures. When transport or required commercial evidence is unavailable and no code-repair
  candidate exists, preparation reports incomplete instead of claiming a healthy no-op. Missing
  optional credentials alone remains a normal configured scope.
- Public 404/410 responses enter relocation review after two consecutive failures. Transient
  transport/auth failures do not. A source URL changes only after independent first-party evidence
  establishes its successor. The public evidence CLI reports omitted companions explicitly even
  when the main bundle succeeds.
- The same repair workflow is manually dispatchable from GitHub Actions or with
  `gh workflow run catalog-repair.lock.yml`. Manual runs use the same issue gate and deduplication
  rules as scheduled runs.
- Neither hourly refresh nor daily repair runs Jev. The [manual semantic experiment](semantic-audit.md)
  remains available, but has not demonstrated incremental production defect discovery. Follow the
  [refresh/repair evidence audit](refresh-repair-audit.md) before choosing another pilot. The local
  repair-context CLI can consume explicitly supplied experimental evidence; the scheduled workflow
  supplies no semantic-audit directory, key, or cache.
- Repair runs are serialized. After an active run finishes, any queued run checks for an open pull
  request labeled `catalog-repair` and exits before inference when one exists. A repair changes only
  the smallest reproducible parser contract, reviewed fixture, regression test, extractor version,
  and provider guide. It never changes generated `data/`, weakens source-integrity validation, or guesses a price.
  Code-repair inference uses GPT-5.6 Luna with high reasoning effort to keep the recurring task
  cost-efficient while retaining deeper analysis for source-drift diagnosis.
  Public refetches automatically compare body hashes with the matching attempt in
  `data/fetch-state.json`; failed transport attempts cannot establish identity using a retained
  older hash. The refresh summary does not duplicate those hashes. Review runs the
  actual parser before comparing output counts. Historical-byte identity establishes historical
  reproduction, while independently reproduced current-source defects remain repairable. One
  unresolved candidate does not prevent a validated independent repair PR; unresolved candidates
  are listed explicitly. A post-execution outcome check fails incomplete, missing-data, missing-tool,
  empty, or contradictory final outputs even when the model process exits successfully.
  Successful repairs are proposed as one labeled draft pull request for human review; there is no
  direct push or automatic merge. Because this is a personal repository, Copilot inference uses a
  fine-grained personal token with `Copilot Requests: read` stored as `COPILOT_GITHUB_TOKEN`; the
  ordinary GitHub CLI OAuth token is not an acceptable substitute.
- Agentic workflow Markdown is the reviewed source and `gh aw compile` produces the matching
  `.lock.yml`; generated lock files are not reformatted or edited by hand.
- Catalog repair installs the `package.json`-pinned Vite+ with its official installer into
  `VP_HOME=/tmp/kmodels-vite-plus`, which is shared by preparation steps and the AWF sandbox and
  stays outside the framework's log-redaction and artifact directories.
  The setup action's `~/.vite-plus` installation is outside AWF's mounted home subdirectories.
  Vite+ installs the Node.js version from `.node-version` and the frozen dependency graph before
  inference. Repair scripts use `vp node`, and validation uses global `vp`, so the sandbox's
  tool-cache PATH scan cannot select a different Node.js version for project commands.
  The agent checks its prepared environment before diagnosis, runs validation sequentially after
  reviewing the diff, and reuses results unless a relevant change requires another check. An
  unavailable toolchain or blocked validation produces a structured incomplete report without a
  pull request. A repair pull request requires every repository validation command to pass.
- Public repair evidence is fetched through `vp node scripts/fetch-catalog-evidence.ts SOURCE_ID`
  (optionally followed by one exact fixed companion URL), using the reviewed manifest transport.
  Public manifest hosts are explicitly admitted by the repair sandbox network configuration; keep
  that list synchronized when adding source hosts. An unavailable tool/source or an unreproduced
  issue produces `report_incomplete`, not a no-op. Runtime sandbox connectivity must be verified in
  CI; local fetch success alone does not establish remote access.
- Vite+ (`vp`) is the project command entry point. The pinned pnpm version and
  `pnpm-lock.yaml` remain authoritative underneath it, and CI installs the
  lockfile frozen.
- Only native dependencies allowlisted in `pnpm-workspace.yaml` may run install scripts.
- The scheduled refresh runs hourly with jitter and commits the validated
  catalog, public-only parsed pricing compiler input, canonical pricing,
  derived UI/export asset indexes and packs, fetch state, quarantine, and
  refresh summary using a `chore(data): ...` commit. Its commit records the
  producing Actions run in a `Kmodels-Refresh-Run` trailer. Deployment checks
  out full commit/tree history with `filter: blob:none` so the website generation-time
  link can resolve the latest catalog-producing commit without downloading historical
  file contents, and prefer that run, while manually produced catalog commits fall
  back to their GitHub commit page. A non-cone sparse checkout includes root files,
  `src/`, `scripts/`, test source files, `public/`, and only the website/export projection
  manifests and packs from `data/`. Scripts and test sources preserve the production
  build's full TypeScript check scope; fixtures, guides, collector state, and canonical
  data files are unnecessary for that build. The catalog history query uses Git trees
  even though `data/catalog.json` is absent from the working tree. After a refresh commits and
  pushes changed data, it explicitly dispatches the dedicated deployment
  workflow because a push authenticated with the workflow `GITHUB_TOKEN` does
  not emit another `push` workflow run. Void accepts the dispatch workflow's
  GitHub OIDC token; deployment always checks out the latest `main`, while
  ordinary human-authenticated pushes retain their direct deployment trigger.
- If a refresh push is rejected and a fresh fetch shows that `main` has moved
  from the collection checkout, publication is skipped with a warning and job
  summary. The next hourly refresh collects against the new code. Generated
  data is never rebased onto code it was not validated with, and a skipped
  publication does not dispatch deployment. Push failures with an unchanged
  remote, and failures to check the remote, still fail the job.
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
  Coverage uses ✅ for models with a direct inference or linked capacity offer and ❓ for models
  without either in both the current value and delta; a shared service charge alone does not
  resolve model-price coverage. The legend distinguishes a published semantic model update from a source content,
  extractor, or field-path change and defines pricing coverage. Every retained or withheld
  candidate has a provider-local table naming the affected boundary, failed source or validation
  stage, exact sanitized reason, and published fallback. Provider-specific model changes and
  operational details use compact tables with zero counters omitted. Every changed model has one
  row with leaf-level previous/current field values.
- A recognized source-contract mismatch warns on its first occurrence with bounded path,
  mismatch kind, affected/observed counts, fingerprint, and public sample IDs
  when available. A second consecutive source failure adds persistence and,
  when available, last-success staleness. Unclassified parser failures remain
  `possible_structural_change`. Published count decreases are separate diagnostics, never
  structural failures or repair triggers by themselves; automation does not infer schema drift
  from a change in catalog size.
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
