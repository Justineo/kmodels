# Kmodels

A credential-free, auditable catalog of AI provider model offerings and a static website for reading it.

```sh
pnpm install
pnpm collect
pnpm dev
```

The collector reads only the official hosts reviewed in `src/catalog/manifests.ts`. It validates drift per provider, stores no raw responses, and retains the last valid provider catalog when a refresh fails. See [`design.md`](./design.md) for the current repository decisions and data semantics.

## Commands

- `pnpm collect` refreshes the durable catalog and semantic summary in `data/`.
- `pnpm check` formats, lints and type-checks with Vite+.
- `pnpm test` replays adapter fixtures and drift checks.
- `pnpm build` builds the site and derives its static JSON endpoints in `dist/`.
- `pnpm run deploy` deploys the prebuilt `dist/` directory to Void.

## Automation

GitHub Actions checks sources every 30 minutes and commits only validated output. Public catalogs need no secret; optional scoped inventories use the named provider credentials documented in `design.md`. Void deployment uses GitHub OIDC: set the repository variable `VOID_PROJECT`, then connect the repository once from an authenticated workstation:

```sh
void github connect "$VOID_PROJECT" \
  --repo OWNER/REPOSITORY \
  --branch main \
  --executor github_actions \
  --workflow .github/workflows/void-deploy.yml
```

Catalog presence is not account availability. Prices are public list prices with their published conditions; missing prices are not treated as free.
