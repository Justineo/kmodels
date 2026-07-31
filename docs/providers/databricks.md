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
- Pricing rows join only to unique normalized catalog labels; rows for models outside the reviewed regional catalog do not create model identities. Blank, `n/a`, and `Coming soon` cells mean that no rate is published. Any other non-decimal value or unequal rate for the same commercial scope rejects the source.
- Promotion percentages, validity dates, launch targets, and referenced standard-rate families come from the pricing footnotes. Every matched starred row must be explained by a parsed footnote; the adapter does not hard-code model IDs or dates.
- At least 80% of non-retired catalog models must retain a price after the joins. The threshold allows models that Databricks lists without a price while rejecting broad table or identity drift. A model absent from the official pricing tables remains unknown.

## Kong AI Gateway

- Project chat candidates from active, acceptable-maturity rows in the exact General purpose set, not name heuristics.
- Deployment compatibility still requires workspace and region availability.
- Embedding and image-generation operations are outside Kong's current Databricks matrix. An image-output row may still qualify through its independently observed chat operation.
