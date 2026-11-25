# Autonomous self-healing contract

Status: current

Kmodels keeps catalog maintenance automated through **physical credential isolation**, **4-job
privilege separation**, **trusted budget reservation & settlement**, and a **deterministic
verification gate**.

## Security boundaries

1. **Sealed credential transport (`src/catalog/transport/`)**:
   - `auth-fetch.ts` and `sagemaker-fetch.ts` are the sole owners of authenticated cloud/provider
     requests and `@aws-sdk/*` / `@smithy/*` clients.
   - `auth-fetch.ts` enforces an internal credential-to-host allowlist on clean HTTPS origins so raw
     credentials never leave `src/catalog/transport/` and cannot be transmitted to unreviewed hosts.
   - Zero imports of `cheerio`, `manifests.ts`, `fetch.ts`, or provider parsers (enforced by
     `tests/architecture-boundaries.test.ts`).
   - Protected by `.github/CODEOWNERS` and hard-forbidden by `scripts/self-heal/gate.ts`.
2. **Zero provider secrets in self-heal**:
   - None of the 22 cloud/provider credentials exist in `.github/workflows/self-heal.yml`.
3. **4-job privilege separation in `.github/workflows/self-heal.yml`** (all workflow artifacts stay
   in `${{ runner.temp }}/self-heal/`, strictly outside the git checkout):
   - **`triage`** (`contents: read`, `actions: read`, `pull-requests: read`): Queries all artifact
     pages via `gh api --paginate --slurp`, searches non-expired `Refresh catalog` report bundles
     in descending attempt order (`catalog.yml` only uploads `catalog-refresh-*` when
     `refresh-report.json` actually exists; transient report or required shard download failures
     retry 3 times and fail explicitly rather than silently falling back or ignoring missing
     shards), and validates `refresh-evidence-manifest.json` (`report_attempt`, shard identity,
     `shard.attempt <= report_attempt`, and exact GitHub `artifact_id` + `artifact_name` match,
     allowing legal reuse of earlier successful shards). On `workflow_dispatch`, fetches reviewed
     public evidence via `scripts/fetch-catalog-evidence.ts` and materializes paired public catalog
     context from `data/catalog.json` (excluding `azure-retail-prices`). Preserves all merged,
     source+dependency, and quarantine obligations per provider; refuses transport-layer
     `dependency_parse_failure` targets (whose failed raw dependency payloads are not preserved in
     the assembled source bundle), rejects legacy redacted/truncated `source_parse_failure` targets
     lacking `error_fingerprint` or `source_hash` before paid generation (shared with `generate` and
     `verify`), does not trigger `source_contract_change` when producer summaries prove all
     truncated findings are benign `accept_with_signal` `unknown_field` extensions
     (`contract_findings_extensions_only: true`), filters discovered evidence strictly by target
     `source_hash` when present (shared with `generate` prompts and verification), verifies every
     discovered evidence body via `verifiedCatalogEvidence()` and paired context via
     `parseReplayContext()` (shared with `scripts/replay-catalog-evidence.ts`; `sagemaker-pricing`
     is self-contained and requires no external catalog context) before admitting any target.
   - **`generate`** (`contents: read`, `persist-credentials: false`, **no write `GH_TOKEN`**):
     Holds only `SELF_HEAL_API_KEY`. Re-checks both the rolling budget ledger AND provider cooldowns
     before invoking any paid agent (emitting `status: "deferred"`, `attempts: 0`, `$0` when
     blocked pre-call so cooldowns and rolling run slots are never disturbed) and refuses
     unsupported/unverifiable triggers or missing/hash-mismatched/invalid replay context at `$0`.
     Checks out pinned `base_sha`, passes only hash-matched evidence into the agent prompt, strips
     `GH_TOKEN`/`GITHUB_TOKEN` from the agent subprocess, runs at most 2 bounded generation attempts
     while accumulating raw spend and rounding totals at 6-decimal precision (`roundUsd`) with
     overflow guards (`isValidUsd`, dropping corrupt values like `1e303` without losing valid token
     counts), passing **remaining** `SELF_HEAL_MAX_RUN_USD` / `SELF_HEAL_MAX_RUN_TOKENS` to each
     attempt (stopping immediately without retrying if attempt 1 did not report complete usage),
     independently preserving every valid numeric field (`input_tokens`, `output_tokens` checked
     with `Number.isSafeInteger`, and `estimated_usd`), enforcing post-attempt per-run caps
     unconditionally on reported spend/tokens, and always emitting `usage.json` (tagged with
     `generate_run_attempt`) plus `candidate.patch` and `proposal.json` when ready (exporting
     `proposal_artifact_id` and `generate_attempt`).
   - **`verify`** (`contents: read`, `persist-credentials: false`, **no write `GH_TOKEN`**, **no
     `SELF_HEAL_API_KEY`**): Downloads upstream artifacts by immutable `artifact-id` (surviving
     GitHub "Re-run failed jobs"). The sole job that executes untrusted candidate code,
     symlinked-worktree before/after evidence replay (verifying evidence & context SHA-256 digests,
     passing identical public replay context to baseline and candidate, enforcing trigger-matched
     verification: `source_parse_failure` requires non-null, non-zero baseline exit emitting a
     structured `stage: "parse_error"` JSON payload for the exact `source_id` carrying both
     pre-throw accumulated contract diagnostics and final exception diagnostics/fingerprint,
     matching every targeted structured `SourceContractError` `kind:path` diagnostic (including
     `disposition: "reject"` `unknown_field` paths from strict schemas) AND independently verifying
     the case-preserving final terminating exception message—checking raw pre-normalized text for
     redaction placeholders or 1,024-char truncation and requiring matching `error_fingerprint` /
     `source_hash` when present—plus clean candidate parse with zero unresolved/new drift,
     `reject`-disposition, or reconciliation diagnostics (allowing a fixed `reject / unknown_field`
     path to downgrade to a harmless `accept_with_signal / unknown_field` hint, matching the
     repository's reviewed extension policy, and allowing benign `accept_with_signal`
     `unknown_field` extensions even beyond the 16-finding display cap when complete replay counts
     confirm zero drift/rejects); summary triggers require baseline exit `0` and compare full
     unbounded `contract_diagnostic_counts` collected _before_ both the 8-diagnostic and 16-finding
     summary caps so neither new regressions beyond #8 nor surviving findings beyond #8/#16 are
     misclassified), automatic Playwright Chromium installation whenever `validate-changes.ts --plan` schedules `test:e2e` or
     `test:pricing-performance`, and `vp node scripts/validate-changes.ts <base_sha>`. Emits an
     exact-patch `verification-receipt.json` (exporting `verify_artifact_id`).
   - **`publish`** (`if: always()`, `contents: write`, `pull-requests: write`, `actions: write`,
     **no `SELF_HEAL_API_KEY`**, **never executes candidate code**): Downloads upstream artifacts by
     immutable `artifact-id`. Leaves the budget ledger untouched on verified zero-call pre-flight
     refusals (`deferred` / pre-call `no_patch` with `attempts: 0` and `$0`), and settles the
     trusted budget & cooldown ledger keyed by `(run_id, generate_attempt)` — comparing USD sums
     and caps at 6-decimal precision (`roundUsd`) and looking up existing runs across the full
     retained ledger (not just the last 24h) so >24h re-runs keep their original timestamp outside
     the current rolling window while still enforcing merged per-run observed spend/token floors
     and keeping `observed_usd` separate from conservative `maxRunUsd` reserves. Requires both
     `needs.verify.result == 'success'` (`VERIFY_JOB_RESULT`) and `receipt.ok == true`, verifies
     `verification-receipt.json` + exact patch SHA-256 + reverse-dependency ownership, applies
     `candidate.patch` via `git apply`, stages only `receipt.changed_files`, pushes `HEAD:main`
     (confirming remote `main` adopted the commit SHA) or opens a Draft PR, and triggers
     `catalog.yml` only on verified `auto_push`.

## Production cutover prerequisites

Before enabling automated self-heal in production, configure and verify in GitHub repository settings:

- Repository variable `SELF_HEAL_AGENT_CMD`: the bounded agent invocation command. Because
  `generate.ts` checks cumulative spend after each subprocess returns, the configured command MUST
  enforce `SELF_HEAL_MAX_RUN_USD` and `SELF_HEAL_MAX_RUN_TOKENS` **before** issuing billable model
  requests (pre-request cap enforcement) and write exact token/USD usage to `SELF_HEAL_USAGE_FILE`.
  The repository ships a built-in OpenAI Codex adapter (`vp node scripts/self-heal/adapters/codex.ts`,
  defaulting to `gpt-6.2-sol` and overridable via `vars.SELF_HEAL_MODEL`). Rather than maintaining a
  hardcoded rate table, the adapter consumes Kmodels' own SHA-256-verified published pricing data
  (`data/export-assets.json` + `data/export-assets.pack`, hydrated before generation — with
  hydration failures emitting a verified `$0` / `attempts: 0` `deferred` receipt so transient
  snapshot download errors never consume paid budget or start provider cooldown — and loaded once
  into immutable parent memory via `createInferencePriceLookup`), evaluating exact rational standard
  `v1/responses` rates (`completion_window: "ordinary"`, `deployment_scope: "global_processing"`,
  context thresholds, and cache tiers) and failing closed at `$0` for any uncatalogued (including
  uncatalogued dated snapshots) or ambiguous model. When configured with the built-in adapter, `generate.ts` invokes `runCodexAdapter` directly
  in-process from already-loaded immutable modules (never reloading scripts or `node_modules` from
  the writable workspace on retry), runs static diff/path/safety checks plus deterministic candidate
  evidence replay inside a secret-free, read-only, network-disabled `codex sandbox` (so parse errors
  on attempt 1 feed back into attempt 2 while the separate secret-free `verify` job remains
  authoritative for before/after replay and full validation), stores trusted parent files
  (`usage.json`, prompts, `codex-model.json`, and SHA-256-verified cached `bin/codex`) strictly
  outside `/tmp`, the repo checkout, and the Codex subprocess's private `TMPDIR`, and strips all API
  keys/tokens from every untrusted subprocess. The loopback metering proxy enforces worst-case
  byte-bounded pre-request USD/token caps, writes pending/unsettled usage (`estimated_usd: null`)
  before dispatching any upstream POST so pre-header disconnects, kills, or ambiguous `5xx`/`408`
  gateway errors (such as `502`/`504`) never leave a retryable `$0` receipt (only confirmed
  pre-execution HTTP rejections restore known spend), and atomically settles verified Responses SSE
  usage into `SELF_HEAL_USAGE_FILE`.
- Repository secret `SELF_HEAL_API_KEY` (only passed to the isolated `generate` job).
- Optional budget override variables: `SELF_HEAL_MAX_RUN_USD`, `SELF_HEAL_MAX_RUN_TOKENS`,
  `SELF_HEAL_MAX_WINDOW_USD`, `SELF_HEAL_MAX_WINDOW_RUNS`, `SELF_HEAL_COOLDOWN_HOURS`.

When `SELF_HEAL_AGENT_CMD` is unset, `triage` still detects actionable drift and uploads the
triage packet, emits a workflow warning and job summary explaining the missing configuration, and
skips `generate`, `verify`, and `publish`.

## Deterministic verification gate (`scripts/self-heal/gate.ts`)

- **Hard-forbidden paths (`rejected`)**: `.github/**`, `scripts/self-heal/**`,
  `scripts/validate-changes.ts`, `scripts/deployment-receipt.ts`, `src/catalog/transport/**`,
  `data/**`, `packages/**`, `package.json`, `pnpm-lock.yaml`, `vite.config.ts`, `tsconfig*.json`.
- **Provider-scoped + reverse-dependency auto-push allowlist (`auto_push`)**: Only files strictly
  owned by the target `provider_id` that have **zero cross-provider importers** in `src/catalog/`
  (computed via `moduleDependencies()`). Shared provider files (such as `gemini.ts` imported by
  `databricks.ts`, or `anthropic-price-row.ts` imported by `azure.ts`) automatically route to
  `draft_pr`.
- **Full-tree anti-weakening audit**: Handles >1 MiB fixtures (`128 MiB` buffer), audits tracked
  diffs and newly created untracked files, rejects lowered or deleted per-source
  `minModels`/`minDocuments`/`minProducts`/`minCards`/`minModelDocuments` thresholds,
  `.skip`/`.only`/`.todo`, `any`, lint/type suppressions, and `process.env` reads outside
  `src/catalog/transport/`.
- **Mandatory before/after evidence replay**: Requires bound evidence for source-level failures,
  verifies file SHA-256 against the triage packet, replays `.json.gz` / `.json` captures on a
  clean `base_sha` worktree with symlinked `node_modules` vs the candidate checkout, rejects
  environment/dependency errors on baseline, and requires baseline failure reproduction or strict
  reduction of repairable contract/reconciliation diagnostics.
