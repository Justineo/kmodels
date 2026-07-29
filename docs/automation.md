# Automation

Status: implemented

- GitHub Actions checks every push and pull request.
- Vite+ (`vp`) is the project command entry point. The pinned pnpm version and
  `pnpm-lock.yaml` remain authoritative underneath it, and CI installs the
  lockfile frozen.
- Only native dependencies allowlisted in `pnpm-workspace.yaml` may run install scripts.
- The scheduled refresh runs hourly with jitter and commits the five
  validated state files—`catalog.json`, `pricing.json.gz`, `fetch-state.json`,
  `quarantine.json`, and `refresh-summary.json`—using a `chore(data): ...`
  commit.
- The workflow schedules, validates, and commits a collection run; it does not
  interpret provider failures. The collector owns failure classification and
  the safe public status projection. A workflow failure before collection
  commits nothing and is reported only by GitHub Actions.
- The catalog and canonical pricing advance as one validated accepted pair. Collection
  stages immutable pair snapshots, advances one atomic pointer, repairs durable
  mirrors after interruption, and verifies the exact pair again during the
  production build.
- `KMODELS_PRICING_RELEASE_INPUT` is an optional reviewed manual-release input
  for explicit absence/removal/withdrawal intents and pair-bound safety
  findings. Scheduled source adapters cannot create it; an unresolved finding
  must be resupplied for every attempted build until a safe pair commits.
- Provider secrets are optional. Missing secrets skip only their scoped inventories.
- Deployment uses the pinned `void` dependency and GitHub OIDC. `void.json` deploys static `dist/`; `VOID_PROJECT` is the only repository variable.
- Renovate uses the Shanghai timezone, a seven-day minimum release age, grouped automerge for non-major updates, and isolated manual major updates.
