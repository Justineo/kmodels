# Kmodels

A credential-free, auditable catalog of AI provider model offerings and a static website for reading it.

```sh
pnpm install
pnpm collect
pnpm dev
```

The collector reads only the official hosts reviewed in `src/catalog/manifests.ts`. It stores content-addressed raw snapshots, validates drift per provider, and retains the last valid provider catalog when a refresh fails. See [`design.md`](./design.md) for the current repository decisions and data semantics.

## Commands

- `pnpm collect` refreshes static JSON in `data/` and `public/v1/`.
- `pnpm check` formats, lints and type-checks with Vite+.
- `pnpm test` replays adapter fixtures and drift checks.
- `pnpm build` builds the plain HTML/CSS site.
- `pnpm run deploy` deploys the prebuilt `dist/` directory to Void.

## Automation

GitHub Actions checks sources every 30 minutes and commits only validated output. Collection needs no secret. Void deployment uses GitHub OIDC: set the repository variable `VOID_PROJECT`, then connect the repository once from an authenticated workstation:

```sh
void github connect "$VOID_PROJECT" \
  --repo OWNER/REPOSITORY \
  --branch main \
  --executor github_actions \
  --workflow .github/workflows/void-deploy.yml
```

Catalog presence is not account availability. Prices are public list prices with their published conditions; missing prices are not treated as free.
