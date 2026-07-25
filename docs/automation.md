# Automation

Status: implemented

- GitHub Actions checks every push and pull request.
- pnpm is the only package manager. Its version is pinned in `package.json`; `pnpm-lock.yaml` is authoritative and CI uses it frozen.
- Only native dependencies allowlisted in `pnpm-workspace.yaml` may run install scripts.
- The scheduled refresh runs every 30 minutes with jitter and commits only the four validated `data/` state files using a `chore(data): ...` commit.
- Provider secrets are optional. Missing secrets skip only their scoped inventories.
- Deployment uses the pinned `void` dependency and GitHub OIDC. `void.json` deploys static `dist/`; `VOID_PROJECT` is the only repository variable.
- Renovate uses the Shanghai timezone, a seven-day minimum release age, grouped automerge for non-major updates, and isolated manual major updates.
