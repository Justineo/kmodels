# Kmodels

A credential-free, auditable catalog of AI models and public pricing across providers.

[Explore the catalog](https://kmodels.void.app) · [JSON exports](#json-exports) · [Design decisions](./design.md)

Kmodels collects reviewed official sources into one versioned, static dataset. Model identity stays exact at `(provider_id, model_id, version)` granularity; pricing retains the conditions that change a rate.

## JSON exports

Every profile is generated from the same validated catalog snapshot and carries its version and generation time.

| Profile          | Best for                                                                      | JSON                                                                    |
| ---------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **IDs**          | Small provider → model ID lookup                                              | [`catalog/ids.json`](https://kmodels.void.app/catalog/ids.json)         |
| **Summary**      | Flat rows with provider, ID, version, tasks, and status                       | [`catalog/summary.json`](https://kmodels.void.app/catalog/summary.json) |
| **Models**       | Default semantic catalog, grouped by provider and model ID with every version | [`catalog/models.json`](https://kmodels.void.app/catalog/models.json)   |
| **Full catalog** | Audit-rich model, source, coverage, warning, and provenance data              | [`catalog/index.json`](https://kmodels.void.app/catalog/index.json)     |
| **Providers**    | Provider metadata and provider-scoped coverage                                | [`providers/index.json`](https://kmodels.void.app/providers/index.json) |
| **Pricing**      | Canonical price books, conditions, validity, and source observations          | [`pricing/index.json`](https://kmodels.void.app/pricing/index.json)     |

Provider-specific exports are available at:

```text
https://kmodels.void.app/providers/<provider>/index.json
https://kmodels.void.app/providers/<provider>/models/index.json
```

Profiles never guess a “latest” version. Pricing is bound to the exact catalog snapshot; an absent price is unknown, not free.

## Reliability

- Official hosts and parsing rules are reviewed in [`src/catalog/manifests.ts`](./src/catalog/manifests.ts).
- Refreshes validate schema drift, model drops, price changes, and provenance per provider.
- A failed provider refresh retains its last validated partition instead of publishing partial data.
- Raw responses and credentials are never published. Optional account-scoped sources cannot redefine the public catalog.

## Development

```sh
vp install
vp run collect
vp dev
```

| Command                  | Purpose                                                         |
| ------------------------ | --------------------------------------------------------------- |
| `vp run collect`         | Refresh catalog, pricing, projections, and the semantic summary |
| `vp run compile:pricing` | Recompile canonical pricing offline from retained parsed inputs |
| `vp run prepare:assets`  | Regenerate UI and export assets from the accepted pair          |
| `vp check`               | Format, lint, and type-check                                    |
| `vp test --run`          | Run fixtures, drift guards, and behavior tests                  |
| `vp run build`           | Build the static site and materialize validated JSON exports    |

GitHub Actions refreshes public sources hourly and commits only validated output. Deployment and optional source credentials are documented in [`docs/automation.md`](./docs/automation.md).
