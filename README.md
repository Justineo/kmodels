# Kmodels

A credential-free, auditable catalog of AI provider model offerings and a static website for reading it.

```sh
vp install
vp run collect
vp dev
```

The collector reads only the official hosts reviewed in `src/catalog/manifests.ts`. It validates drift per provider, stores no raw responses, and retains the last valid provider catalog when a refresh fails. [`design.md`](./design.md) indexes the current shared and provider-specific decisions.

## Commands

- `vp run collect` refreshes the durable catalog, pricing, and semantic summary in `data/`.
- `vp check` formats, lints and type-checks.
- `vp test --run` replays adapter fixtures and drift checks.
- `vp run build` builds the site and derives its static JSON endpoints in `dist/`.
- `vp run deploy` deploys the prebuilt `dist/` directory to Void.

## Automation

GitHub Actions checks sources hourly and commits only validated output. Public catalogs need no secret; optional scoped inventories use the credentials documented in the matching provider file in the [`design.md` index](./design.md#providers). Void deployment uses GitHub OIDC: set the repository variable `VOID_PROJECT`, then connect the repository once from an authenticated workstation:

```sh
void github connect "$VOID_PROJECT" \
  --repo OWNER/REPOSITORY \
  --branch main \
  --executor github_actions \
  --workflow .github/workflows/void-deploy.yml
```

Catalog presence is not account availability. Prices are public list prices with their published conditions; missing prices are not treated as free.
