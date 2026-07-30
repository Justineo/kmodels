# Databricks

Status: current

## Sources and identity

- The public AWS regional catalog is one atomic bundle rooted at the supported-model details page and fixed task, region, lifecycle, limit, API, pricing, and release references.
- Callable IDs come only from labeled endpoint names. The source is exhaustive only for the reviewed AWS regional page.
- General purpose and Embeddings task sets must exactly cover the catalog IDs and agree across responsive copies. Unknown IDs, changed routes, or structural drift reject the provider.
- Optional `GET /api/2.0/serving-endpoints` is workspace-scoped. Its host must be an allowlisted Databricks HTTPS origin; it cannot create/remove rows or retain raw workspace data.
- Enable the optional inventory with `DATABRICKS_HOST` and `DATABRICKS_TOKEN`.

## Mapping

- General purpose and Embeddings sets supply task evidence and exact `/serving-endpoints/{name}/invocations` routes. Image-output rows may also remain text generation when listed as General purpose.
- Display-name joins must resolve uniquely. Release dates require an exact release-feed link to a supported-model label; page metadata is not a model date.
- Keep prices in DBU. Preserve input, output, cache, embedding, batch, capacity, context, promotion, and effective-date conditions. Never convert DBU to USD or infer shifted columns.
- When an otherwise identical unequal promotional row is explicit, the unqualified companion row is the reviewed non-promotional base. Promotion validity remains attached to the published rate.

## Kong AI Gateway

- Project chat candidates from active, acceptable-maturity rows in the exact General purpose set, not name heuristics.
- Deployment compatibility still requires workspace and region availability.
- Embedding and image-generation operations are outside Kong's current Databricks matrix. An image-output row may still qualify through its independently observed chat operation.
