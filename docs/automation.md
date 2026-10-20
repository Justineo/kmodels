# Automation

Status: implemented

- GitHub Actions checks every push and pull request, including the portable pricing package build
  and packed Node/browser conformance checks. Package preparation never publishes to npm.
- A separate daily `Catalog repair` workflow uses a deterministic code-repair admission gate. The schedule
  alone never starts Copilot: preparation reads the latest completed main-branch refresh's report
  artifact, run identity, failed steps, and bounded failure log with read-only Actions access.
  Evidence lives outside the checkout; failed generated data never replaces the accepted pair.
  Collection, generated-data verification, and build failures enter execution review even when
  the provider report contains no repair candidate. Operational failures or a missing report
  remain explicitly incomplete; GitHub evidence retrieval errors fail preparation instead of
  silently falling back to a healthy old report. Local runs without execution evidence use the
  committed report. Code-repair inference also begins when the selected refresh report contains
  a parser failure, a changed source-contract finding, known unrecognized public pricing-card
  structure, an explicitly rejected Databricks pricing subpage, a missing owned accounting/endpoint contract, a repeated public 404/410, a rejected provider validation, or a failed
  pricing validation. The gate excludes operational states such as fetch failures and missing
  credentials, plus unresolved pricing by itself. It deliberately does not pre-judge which changed
  source caused a provider regression; Copilot reviews every listed candidate and decides whether a
  safe code repair exists. Preparation admits one error-driven provider per run, using a stable
  rotation over configured providers by UTC day, alongside the independent periodic-review slot.
  All candidates for that error provider stay together. The context and immutable admission retain
  every deferred candidate; they remain unreviewed and are re-evaluated from the latest refresh on
  later runs. A batch outcome does not establish that the deferred queue or whole catalog is healthy.
  This bounds investigation without allowing the agent to drop difficult candidates after admission.
  A provider simply not publishing a price is never a repair candidate,
  but a parser that rejects the whole catalog because one model lacks a price is repairable.
  Repair preserves valid sibling models and keeps an unobserved price unknown. A `not_published`
  state needs an explicit source claim; an absent or empty price field cannot establish it. Repair
  never invents prices or relaxes checks on malformed non-empty values or source identity.
- Missing owned mappings and unrecognized pricing cards remain candidates on unchanged source bytes;
  accepted publication or fallback does not resolve them. The gate includes their reason counts and
  bounded diagnostic samples. Source candidates do not hide separate pricing validation failures
  for the same provider. Unknown meters and unbound product names alone are not automatically
  parser failures. When transport or required commercial evidence is unavailable and no code-repair
  candidate exists, preparation reports incomplete instead of claiming a healthy no-op. Missing
  optional credentials alone remains a normal configured scope.
  Rejected public price cells, unsupported price labels, and
  drifted optional catalog companions also carry their exact diagnostic samples into admission,
  even when source bytes are unchanged and a separate pricing partition remains retained. Replay
  and local parser repair do not require the whole provider to become publishable. A GitHub-source
  404 requires checking the provider's published documentation, and a rejected price requires
  examining the actual markup and column semantics before declaring it unpublished.
- Public 404/410 responses enter relocation review after two consecutive failures. Transient
  transport/auth failures do not. A source URL changes only after independent first-party evidence
  establishes its successor. The public evidence CLI reports omitted companions explicitly even
  when the main bundle succeeds.
- Dependency contract failures enter source investigation even when the root bytes are unchanged
  and catalog/pricing publication succeeds. Repeated public dependency 404/410 uses that dependency's
  own history for relocation review. Transient dependency failures mark evidence incomplete without
  becoming blind parser repairs; truncated dependency evidence also remains incomplete. Native HTTP
  status takes precedence over legacy report-message matching. Reports identify bundle versus
  claim impact, individual failure streaks and last success, so fresh root data cannot hide stale
  acquisition evidence. Public evidence receipts expose the same bounded dependency failures.
- The same repair workflow is manually dispatchable from GitHub Actions or with
  `gh workflow run catalog-repair.lock.yml`. Manual runs use the same repair-candidate gate and publication
  rules as scheduled runs.
- Refresh and repair never create GitHub issues or require a repair pull request. A completed
  repair commits validated code directly to `main`; unavailable evidence, tool failures, timeouts, and incomplete investigation remain
  visible in Actions summaries, logs, artifacts, and failed job status. Every framework issue
  reporting path is explicitly disabled: agent/job failure reports, no-op reports, missing tools/data,
  incomplete reports and threat-detection reports. Threat detection and
  the incomplete-outcome check still run. The conclusion job has no issue permission, and the
  agent outcome gate rejects issue/comment/PR requests even when accompanied by a repair intent.
  The agent has only read permissions. A custom `commit_repair` safe-output job receives the
  write permissions required for direct publication and deployment dispatch; it runs only after
  successful agent validation, safe-output processing, and successful threat detection.
- Neither hourly refresh nor daily repair runs Jev. The [manual semantic experiment](semantic-audit.md)
  remains available, but has not demonstrated incremental production defect discovery. Follow the
  [refresh/repair evidence audit](refresh-repair-audit.md) before choosing another pilot. The local
  repair-context CLI can consume explicitly supplied experimental evidence; the scheduled workflow
  supplies no semantic-audit directory, key, or cache.
- Daily repair also admits one comprehensive review independently of errors through
  `KMODELS_PERIODIC_REVIEW=true`. UTC days rotate deterministically over sorted manifest providers,
  then a global architecture review: currently 20 providers plus one global slot per 21-day cycle.
  Provider reviews inspect current first-party discovery, identity/lifecycle, complete price/service
  inventory and scopes, quantity/selector acquisition, retention/replay, calculator/display parity
  and simplicity. The global slot examines shared model consistency and collection/repair feedback.
  Reviews use the existing serialized job and evidence artifacts; there is no second scheduler or
  production semantic classifier. A failed slot is incomplete, visible in Actions, and revisited
  on its next cycle; a manual dispatch can rerun that day's slot. Error-driven candidates continue
  to be investigated daily regardless of the selected review provider.
- Repair runs are serialized and do not wait on existing pull requests. A repair changes only
  the smallest reproducible parser contract, reviewed fixture, regression test, extractor version,
  and provider guide. It never changes generated `data/`, weakens source-integrity validation, or guesses a price.
  Code-repair inference uses DeepSeek's current `deepseek-flash` alias with high reasoning effort
  through the existing Copilot CLI BYOK transport and DeepSeek's
  [stateless Responses API](https://api-docs.deepseek.com/guides/responses_api/). As of
  2026-10-18 the alias serves DeepSeek-V4.1-Flash-1017; use the current official alias rather than
  the retired `deepseek-v4-flash` name; [DeepSeek's model table](https://api-docs.deepseek.com/quick_start/pricing/)
  owns the current alias mapping. The DeepSeek account behind `DEEPSEEK_API_KEY` pays inference
  directly; a zero Copilot-credit report for BYOK does not mean inference was free. Use DeepSeek's
  usage/billing records for spend. The repair agent's model fallback is disabled to preserve the
  requested model ID; the pinned compiler does not propagate this setting to its separate detection
  proxy. Both phases explicitly select `deepseek-flash` and target DeepSeek's API.
  The `models.providers.github-copilot.models.deepseek-flash.cost` overlay supplies AWF's missing
  BYOK pricing for both phases. Values are USD per token: input `0.0000003`, output `0.0000012`,
  cache read `0.000000006`, cache write `0`. These are the official peak rates on 2026-10-18;
  off-peak rates are half, so the proxy records a conservative budget estimate rather than an
  exact time-dependent bill. Keep the cache-read rate: charging cached input at the ordinary
  input rate would greatly overstate these long sessions. Unknown models still fail pricing
  admission; do not disable the AI-credit guard or supply zero prices to bypass it.
  API compatibility and successful tool execution do not establish repair quality;
  candidate investigation, regression, exact-patch publication and delivery gates remain required.
  Threat detection inherits the same DeepSeek model and BYOK transport and remains a separate
  mandatory review of the completed patch before publication.
  Public refetches automatically compare body hashes with the matching attempt in
  `data/fetch-state.json`; failed transport attempts cannot establish identity using a retained
  older hash. The refresh summary does not duplicate those hashes. Review runs the
  actual parser before comparing output counts. Historical-byte identity establishes historical
  reproduction, while independently reproduced current-source defects remain repairable. One
  unresolved candidate does not prevent a validated independent repair commit; unresolved candidates
  are listed explicitly. A post-execution outcome check fails incomplete, missing-data, missing-tool,
  empty, unsupported, or contradictory final outputs even when the model process exits successfully.
  Incomplete admission errors include the bounded, JSON-escaped blocker reason so the failed-step
  log distinguishes an investigated source blocker from an unexplained engine failure.
  A `commit_repair` intent runs all four required validations and the portable package checks in
  deterministic post-execution steps. The actual working-tree patch is bounded to 100 files and
  4 MiB and admitted only for catalog TypeScript, unit-test files, reviewed fixtures, provider
  guides, and the manual semantic-disposition file. Repair infrastructure (including the public
  evidence helper and its tests), scripts, dependencies,
  workflows, generated data, executables, symlinks, and submodules cannot enter automatic repairs.
  New source hosts that require a network-policy change remain incomplete.
  Safe outputs run only after the complete agent job succeeds. Empty patches fail instead of
  being ignored. A trusted publication script is restored from the workflow's original commit;
  the candidate cannot edit that script. It binds the candidate artifact to its base commit and
  SHA-256 patch hash and rejects any change during validation.
  The publication job checks out latest `main`, applies that exact patch with Git's three-way
  conflict check, repeats complete validation against current data, and commits only the exact
  validated tree. Credentials are not persisted during checkout or exposed to validation steps.
  Only the final push and deployment steps receive the workflow token. A normal, non-force push
  rejects any concurrent update after validation. On the first non-fast-forward rejection,
  publication fetches current main into its clean disposable checkout, reapplies the same admitted
  patch, reinstalls frozen dependencies, and repeats full validation and exact-tree commit checks
  before retrying once. Validation never receives the push credential. Conflicts, validation
  failures, other push failures, or a second race fail the run and retry from current evidence on
  the next daily schedule. Repair commits record the Actions run
  in a `Kmodels-Repair-Run` trailer and explicitly dispatch `void-deploy.yml`, since the workflow
  token does not trigger push workflows. A final delivery job requires successful publication
  and deployment dispatch for every repair intent. A passing inference process or a textual report is not delivery.
  Failed or incomplete runs leave their diagnostics in Actions; the next daily run re-evaluates
  the latest committed refresh and retries remaining candidates. There is no issue-based queue,
  automatic success disposition, or immediate unbounded retry loop. DeepSeek inference uses
  `DEEPSEEK_API_KEY`, not Copilot's included inference allowance. The key is passed only to the
  API proxy, excluded from the agent container, and sent only to `https://api.deepseek.com`.
- Agentic workflow Markdown is the reviewed source and `gh aw compile` produces the matching
  `.lock.yml`; generated lock files are not reformatted or edited by hand. Use gh-aw v0.89.21
  for compilation, including its supported `threat-detection.report-as-issue` switch. Compile with
  `--action-mode action --action-tag v0.91.6` to preserve the reviewed setup-action update. Keep the
  generated action pins synchronized with that compiler; v0.87.10 cannot express this policy.
  Pin `sandbox.agent.version` to v0.28.27 so the Copilot Responses adapter normalizes replayed
  `apply_patch` item IDs from `ctc_` to `fc_` ([upstream fix](https://github.com/github/gh-aw-firewall/pull/8944)).
  Regenerate the lock file so the AWF binary, configuration schema, and container digests advance
  together; the compiler's default v0.28.23 retains invalid IDs and fails after the first patch.
  `.github/aw/actions-lock.json` supplies the v0.28.27 image digests from gh-aw v0.90.0's
  [published pins](https://github.com/github/gh-aw/blob/v0.90.0/pkg/actionpins/data/action_pins.json),
  keeping recompilation reproducible with the stable compiler.
  The same lock records the currently adopted explicit artifact-action refs. Framework-injected
  actions follow the pinned compiler's bundled versions; regenerate rather than editing their
  emitted pins independently of the manifest.
- Catalog repair installs the `package.json`-pinned Vite+ with its official installer into
  `VP_HOME=/tmp/kmodels-vite-plus`, which is shared by preparation steps and the AWF sandbox and
  stays outside the framework's log-redaction and artifact directories.
  Preparation, publication, and a separate ordinary-CI smoke job use the same local
  `.github/actions/setup-repair-toolchain` action. It sources the installer's generated `env`
  file and persists the complete PATH for subsequent steps, including Vite+ 1's `fallback-bin`
  directory. Adding only `VP_HOME/bin` leaves a seemingly usable CLI whose environment doctor
  fails before inference. The shared action verifies runtime installation, frozen dependencies,
  and `vp env doctor`; toolchain upgrades therefore exercise the actual repair bootstrap in CI
  without spending inference credits. A setup failure records an explicit environment-failure
  summary. Framework-generated missing-output/prompt-exhaustion messages cannot establish that
  an agent investigation ran; diagnose the first failed setup or execution step.
  The setup action's `~/.vite-plus` installation is outside AWF's mounted home subdirectories.
  Vite+ installs the Node.js version from `.node-version` and the frozen dependency graph before
  inference. Repair scripts use `vp node`, and validation uses global `vp`, so the sandbox's
  tool-cache PATH scan cannot select a different Node.js version for project commands.
  The agent checks its prepared environment before diagnosis and uses focused regression tests
  while repairing. After its final edit it formats explicit changed paths with `vp fmt` and runs
  `vp check`, resolving every failed command before staging its patch and requesting publication.
  The standalone `oxfmt` wrapper is IDE-only; `vp exec oxfmt --write` fails without formatting.
  `vp node scripts/catalog-repair-publication.ts stage` runs the complete sequential check, test,
  fixture, build, and portable-package suite before capturing the actual patch for framework
  threat detection. A failed command returns control to the agent, which diagnoses and corrects
  allowed changes and retries the complete gate, up to three attempts per run. Apparently
  transient failures get one diagnostic rerun; deterministic failures require a correction.
  Staging removes any stale detection patch first and rejects mutations during validation.
  Staging and publication admission also reject changes to manifest `min*`/`max*` limit
  declarations, including removal or replacement with an expression. Tests passing cannot justify
  lowering a count floor or raising a resource ceiling. Operator-reviewed source-contract migrations
  happen outside automatic repair; URL and extractor-version updates remain eligible.
  The agent requests `commit_repair` only after staging succeeds. The post-execution gate verifies
  that patch against the final working tree and uploads a separate validated candidate artifact
  only after all checks pass. Staging, post-execution, and latest-main publication share the same
  `validate` implementation; each independently runs the full suite. Repair infrastructure tests
  also run before inference so a broken harness does not consume a model run. An
  unavailable toolchain or blocked validation produces a structured incomplete report without a
  publication request. Automatic repair publication requires every repository validation command to pass.
  Preparation supplies deduplicated fetch commands built from reviewed public source IDs and a
  runner-owned repair-admission output. Admission requires investigation; it does not assert that
  a defect already exists. An admitted `noop` requires every candidate to have independently checked
  `not_a_defect` evidence, including successful actual parser replay and a concrete alternative
  diagnostic, and an empty patch. Source-level pricing/location and periodic provider reviews also
  require successful first-party navigation. The trusted terminal checker and outcome capture
  independently enforce this conclusion using the runner-restored checker. Blocked, pending or
  repaired candidates cannot be dismissed as a healthy no-op. Missing source evidence adds its own
  admission item so an unrelated healthy review cannot conceal acquisition failure. A reproduced
  defect still requires validated code, publication and deployment; an external blocker remains
  incomplete, never a fabricated repair or successful dismissal.
  If initial triage finds no repair, the agent must make a second diagnostic pass over hard
  rejections and owned contract omissions before declaring an external blocker. It must correct
  argument/decoding mistakes, inspect rejected rows and parser branches, and test alternative
  explanations. Hash identity proves persistence, and passing fallback tests prove fallback only.
  Neither can establish that a repair is impossible. Incomplete reports record the corrected
  commands, actual parser results, examined source sections and concrete remaining blockers.
  Preparation also writes a runner-owned admission containing every candidate ID (including failed
  refresh execution), the base commit, and a 20-minute investigation deadline. The agent updates
  `/tmp/gh-aw/agent/catalog-repair-review.json`, bound to that exact admission's SHA-256. Missing,
  duplicate, stale, or extra candidates fail the investigation check. Each reviewed candidate has
  source artifact hashes, explained diagnostic checks, and a `repaired`, `not_a_defect`, or
  `blocked` decision. Repairs require before/after actual parser replay and a passing regression;
  no-defect and blocked decisions require a concrete second diagnostic pass. Relocated sources or
  missing pricing/contracts also require successful first-party navigation inspection. Only an
  acquisition blocker with a failed fetch and no possible parser replay may omit navigation.
  A blocked refresh execution may instead use an `execution` diagnostic against its sanitized
  failed steps/log, without live collection or credentials; provider candidates cannot use this exception.
  A blocker names its source/contract/tooling/scope category and exact next action. Independent
  repaired candidates can publish alongside evidenced blockers; residual omissions remain explicit.
  Unfinished work stays `pending` and prevents publication. An incomplete outcome may retain pending
  candidates only after the prepared investigation deadline, or with a failed command receipt for
  an environment interruption. The agent must not spend unused time waiting for this deadline;
  it continues independent investigation or establishes actual blockers.
  `vp node scripts/catalog-repair-review.ts probe KIND PHASE -- VP_ARGUMENTS` runs a diagnostic,
  saves its stdout, stderr and exit status, and returns a check reference; add the observed `result`
  explanation to the review. `hash PATH` hashes a complete saved artifact, distinct from the source
  body hash inside public evidence files. `check` returns missing work to the agent while it can
  still investigate; `check-incomplete` permits only justified interrupted pending work. `stage`
  calls `check-repair` before full validation. A separate post-execution gate restores the review
  checker from the original workflow commit and cross-checks the final record before outcome
  admission. Evidence stays inside the agent evidence directory, with symlink escapes rejected;
  the admission and public/sanitized investigation directory are retained for 30 days even on failure.
  These checks establish coverage and consistency of saved evidence, not semantic correctness or
  independent attestation of agent-owned command receipts. They cannot guarantee that an agent
  chose the right command or correctly interpreted a source. Deterministic regression scenarios
  cover observed early-stop patterns; evaluating actual model investigation quality still requires
  inspecting real execution traces. An incomplete run stays failed rather than becoming green.
  Agent execution has an explicit 45-minute limit inside a 60-minute agent job. The
  [frontmatter timeout](https://github.github.com/gh-aw/reference/frontmatter/#run-configuration-run-name-runs-on-runs-on-slim-timeout-minutes)
  bounds inference and its tool calls; the job limit separately leaves time for setup,
  post-execution validation, and artifact upload. The agent budgets 20 minutes for evidence and
  focused repairs, 20 for complete validation and corrections, and 5 for final reporting. It
  completes candidate triage before staging and publishes promptly after a successful gate,
  without reopening independent work. Staging prints an explicit completion receipt only after
  saving the unchanged validated patch. An engine timeout or failure skips outcome capture,
  preserving the primary error instead of adding a missing-output-file error; publication still
  requires a successful agent job and a fully validated completed outcome.
  Publication unit tests use a private in-memory environment, never host credentials or native
  token mutation. AWF v0.28.27's [one-shot token cache](https://github.com/github/gh-aw-firewall/blob/v0.28.27/containers/agent/one-shot-token/src/lib.rs)
  caches the first `GH_TOKEN` read even when absent, so `vi.stubEnv` cannot reliably replace it
  inside the sandbox. A missing fake token must not strand an otherwise valid source repair.
- Public repair evidence is fetched through `vp node scripts/fetch-catalog-evidence.ts SOURCE_ID`
  (optionally followed by one exact fixed companion URL), using the reviewed manifest transport.
  For relocation research, `SOURCE_ID --linked FIXED_COMPANION_URL TARGET_URL` fetches the
  reviewed HTML companion afresh, requires an actual anchor to the target, and fetches just that
  target within the same public host/redirect boundary and a maximum 4 MiB response budget.
  `--index` may replace the parent URL for a supported raw index. The artifact records both
  parent bytes/hash and target bytes/hash with `scope: linked`; it has no whole-source baseline
  comparison and does not admit a new collection dependency. Never treat a fixed-companion
  rejection as evidence that a linked first-party contract is unavailable. Verify the successor
  content before changing its manifest URL and parser. A method reference may delegate its
  actual fields to linked parameter/result types; inspect those types before declaring omission.
  For a linked-document source without a custom transport, `SOURCE_ID --index` saves only its
  reviewed index when discovery rejects the bundle. The same host/redirect restrictions and the
  smaller source/document byte limit apply; collection count guards remain unchanged. Artifacts
  declare `scope` and use distinct filenames; index hashes compare with the `/index` dependency,
  not the bundle. A structural discovery failure is not classified as a network outage. Agents
  inspect the raw links and first-party successor evidence before abandoning repair, and describe
  missing pricing sections as unresolved until relocation or withdrawal is established. Passing an
  existing fallback test does not establish that a current contract omission is unrepairable.
  The prepared context is read directly inside the sandbox; rerunning the preparation CLI there
  attempts to write runner-only summary/output paths and is unsupported.
  Public manifest hosts are explicitly admitted by the repair sandbox network configuration; keep
  that list synchronized when adding source hosts. An unavailable tool/source or an unreproduced
  issue produces `report_incomplete`, not a no-op. Runtime sandbox connectivity must be verified in
  CI; local fetch success alone does not establish remote access.
  The evidence CLI distinguishes unknown source IDs and mistaken provider IDs from authenticated
  sources. A provider-ID error lists its reviewed public source IDs; for example Bedrock uses
  `bedrock-models`, not `amazon-bedrock`. Such errors must be corrected within the same run.
- Vite+ (`vp`) is the project command entry point. The pinned pnpm version and
  `pnpm-lock.yaml` remain authoritative underneath it, and CI installs the
  lockfile frozen.
- Only native dependencies allowlisted in `pnpm-workspace.yaml` may run install scripts.
- The pnpm 12 toolchain declares `node-gyp` as a development dependency so clean installs can
  compile the allowlisted `better-sqlite3` dependency without relying on a package-manager-bundled
  executable or a warm native build cache.
- TypeScript resolves to the exactly pinned `typescript-native-bridge` alias, with a workspace
  override keeping every consumer on the same package. Its tsgo 7 checker preserves the classic
  compiler API required by `vue-tsc` and the collectors' AST parsers; the upstream `typescript@7`
  package is not a compatible replacement for those consumers. Keep the alias and override pins
  synchronized. Native binaries arrive as optional platform packages, without install scripts.
  Local macOS and glibc-based Linux CI are supported; Alpine/musl is not. Editors must select
  `node_modules/typescript/lib` as the workspace TypeScript SDK to use the same bridge.
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
- Deployment uses the pinned `void` dependency, the Node.js version in `.node-version`, and GitHub
  OIDC. The workflow explicitly selects Void Cloud with `VOID_API_URL=https://api.void.cloud` before
  exchanging the GitHub token; a fresh runner has no local platform selection. `void.json` deploys
  static `dist/`; `VOID_PROJECT` is the only repository variable. Each fresh runner first
  registers `VOID_API_URL` with `void connect --no-login`, as required by the pinned CLI, then
  deploys using the existing short-lived GitHub OIDC authorization.
- Renovate uses the Shanghai timezone, a seven-day minimum release age, grouped automerge for
  non-major updates, and isolated manual major updates. Its custom package-manager matcher keeps
  the strict `devEngines.packageManager.version` pin synchronized with the standard
  `packageManager` pin.
