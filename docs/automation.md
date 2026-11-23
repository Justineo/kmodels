# Automation

Status: implemented

## Continuous integration (`.github/workflows/ci.yml`)

- GitHub Actions runs `vp node scripts/validate-changes.ts` on every push and pull request.
- Affected-surface planning selects only the checks required by changed files:
  - `vp check` (format, Oxlint, TypeScript)
  - Unit tests (`--project unit` or `vitest related`)
  - Generated data tests (`--project generated`) when catalog/pricing inputs change
  - Production site build (`vp run build`: `vue-tsc --noEmit`, `vp build`, and
    `scripts/check-price-assets.ts`) and browser E2E smoke (`vp run test:e2e`) when website/data
    inputs change
  - Portable package build and Node/browser conformance (`vp run package:build` and
    `vp run package:check`) when `@kmodels/pricing` inputs change; CI never publishes to npm
  - Browser pricing interaction performance gate (`vp run test:pricing-performance`) when pricing
    UI or data inputs change

## Scheduled catalog refresh (`.github/workflows/catalog.yml`)

- Runs on schedule and manual dispatch in sharded collection jobs (`collect-shard`) followed by a
  final assembly/publication job (`publish`).
- Preserves failed provider partitions from the last accepted snapshot, records provider quarantine
  and structured refresh telemetry (`refresh-summary.json`, `quarantine.json`), and uploads
  captured public evidence shards as workflow artifacts.
- Publishes mutually consistent `catalog.json`, `pricing.json.gz`, `inference-pricing.json`,
  `website-assets.{json,pack}`, and `export-assets.{json,pack}` as one immutable archive in the
  `catalog-snapshots` GitHub Release and commits the updated `data/catalog-snapshot.json` pointer.

## Static deployment (`.github/workflows/void-deploy.yml`)

- Runs on pushes to `main` and manual dispatch.
- Hydrates the checked-out `data/catalog-snapshot.json` pointer, builds `dist/`, runs the browser
  pricing performance gate (`vp run test:pricing-performance`), deploys `dist/` to Void, and runs
  `vp node scripts/deployment-receipt.ts` to upload a 30-day `catalog-deployment-<run>-attempt-<n>`
  artifact recording `run_id`, `run_attempt`, `revision`, `snapshot_sha256`, and `deployed_at`.
- The former orphan-branch maintenance ledger (`record-deployment` job / `scripts/repair/maintenance.ts`)
  is retired; deployment identity lives in the uploaded GitHub Actions receipt artifacts.

## Autonomous self-healing (`.github/workflows/self-heal.yml`)

- Triggered automatically after `Refresh catalog` completes on `main` (or via manual dispatch).
- Uses a 4-job privilege-separated pipeline (`triage` → `generate` → `verify` → `publish`) with
  zero access to the 22 cloud/provider API credentials, reverse-dependency provider ownership
  enforcement, trusted budget reservation and failure settlement, anti-starvation scheduling, and
  before-vs-after `.json.gz` evidence replay proof.
- See [Autonomous self-healing contract](self-heal.md) for the exact security, budget, evidence,
  and delivery boundaries.
- The former `gh-aw` / AWF dual-engine harness, Jev manual semantic-audit experiment, and daily
  proactive rotation schedule are retired.
