# Databricks

Status: current

## Sources and identity

- The public AWS regional catalog is one atomic bundle rooted at the supported-model details page and fixed task, region, lifecycle, limit, API, priority-mode, pricing, and release references.
- Databricks explicitly delegates Gemini image-model amounts to two anchored sections of Google's official Gemini price book. Those sections are part of the same reviewed bundle; no other Google prices are imported.
- Callable IDs come only from labeled endpoint names. The source is exhaustive only for the reviewed AWS regional page.
- General purpose and Embeddings task sets must exactly cover the catalog IDs and agree across responsive copies. Unknown IDs, changed routes, or structural drift reject the provider.
- Optional `GET /api/2.0/serving-endpoints` is workspace-scoped. Its host must be an allowlisted Databricks HTTPS origin; it cannot create/remove rows or retain raw workspace data.
- Enable the optional inventory with `DATABRICKS_HOST` and `DATABRICKS_TOKEN`.

## Mapping

- General purpose and Embeddings sets supply task evidence and exact `/serving-endpoints/{name}/invocations` routes. Image-output rows may also remain text generation when listed as General purpose.
- Display-name joins must resolve uniquely. Release dates require an exact release-feed link to a supported-model label; page metadata is not a model date.
- Deprecated models remain callable only for existing workspaces and map to canonical `deprecated`; inaccessible models map to `retired`. If Databricks explicitly keeps an old partner ID callable by redirecting it after the partner retirement date, the formal migration interval remains canonical `deprecated`, and `retired_at` is the redirect end when requests begin to fail.
- Keep Databricks price-book amounts in DBU. Preserve input, output, cache, embedding, batch, capacity, endpoint geography, context, promotion, and effective-date conditions. Never apply an assumed DBU-to-USD conversion.
- The only denomination exception is a model section that states Google pass-through pricing and links an exact official Google section. Normalize its Standard paid input-text, input-image, output-text, and output-image token rates in USD, while requiring Databricks' global-endpoint and pay-per-token applicability statements. Do not inherit Google's free, Batch, Flex, Priority, grounding, or caching terms because Databricks does not publish those routes for these endpoints.
- Pricing rows join only to unique normalized catalog labels; rows for models outside the reviewed regional catalog do not create model identities. Blank, `n/a`, and `Coming soon` cells mean that no rate is published. Any other non-decimal value or unequal rate for the same commercial scope rejects the source.
- Promotion percentages, validity dates, launch targets, and referenced standard-rate families come from the pricing footnotes. Every matched starred row must be explained by a parsed footnote; the adapter does not hard-code model IDs or dates.
- Standard pay-per-token rows use canonical `service_tier=standard`. Priority support comes from the exact endpoint-ID table and maps the request value to `service_tier=priority`. Qwen 3.5's published Priority DBU row is numeric and retains its `ap-south-1` and account-enablement conditions. For partner models, Databricks publishes that Priority is more expensive but no exact amount; preserve one `unknown_amount` raw fact per supported model instead of copying an upstream-provider price.
- Priority capacity can fall back to Standard and is then billed at Standard rates. A requested or echoed `service_tier=priority` therefore does not by itself prove the billed tier.
- At least 80% of non-retired catalog models must retain a price after the joins. The threshold allows models that Databricks lists without a price while rejecting broad table or identity drift. A model absent from the official pricing tables remains unknown.

## Public estimate and account-exact cost

- Public data is enough to calculate published DBU consumption when the gateway knows the actual model, Standard/Priority/Batch/capacity route, Global/In-geo endpoint, context tier, token category, cache category, promotion date, and image/text modality. Output usage and a possible Priority fallback are not known before the request completes.
- `system.billing.list_prices` provides historical published list prices by SKU, cloud, currency, and effective interval. It can convert a DBU quantity to list cost, but its documented `pricing` field is explicitly list/promotional pricing, not a negotiated net rate.
- `system.billing.usage` is the account billable-usage ledger: DBU quantity, SKU, workspace, endpoint metadata, and correction records. Join it with `list_prices` for account list-cost reconciliation. Contract discounts, committed-use terms, custom requirements, credits, taxes, and invoice adjustments remain account/invoice facts; the usage dashboard explicitly says actual cost varies by contract and lets an administrator override cost-per-DBU for an estimate.
- The public scraper therefore stores DBU and delegated pass-through USD rates without an invented universal USD conversion. An authenticated billing integration may enrich an account-specific view, but must not overwrite the public catalog or claim invoice-exact cost from list prices alone.

## Request, response, and freshness

- Foundation Model responses expose `prompt_tokens`, `completion_tokens`, `total_tokens`, and, where applicable, `reasoning_tokens`; `prompt_tokens` includes server-added text. The response also echoes Priority when it was requested, otherwise Default. The direct response contract does not publish cache-read/cache-write token fields.
- `system.ai_gateway.usage` adds request-level `token_details`, including cache-read, cache-creation, and output-reasoning tokens. It is a post-request system table and has documented coverage limits for non-streaming, non-embedding responses larger than 1 MiB.
- System tables do not support real-time monitoring and are updated throughout the day. External-model spend is hourly aggregated and explicitly only an estimate from published upstream prices. Neither signal is suitable for synchronous cost-based load balancing.
- A gateway should route from a local first-party rate book plus request parameters and predicted output; use response usage for immediate post-request estimation, then reconcile asynchronously against AI Gateway usage and billing tables. Cost-based routing must carry uncertainty for output length, cache behavior, Priority fallback, and account-specific net price.

## Extraction and reconciliation

- Each open-model row, partner-model row, promotion note, Priority support entry, delegated image-price section, and account-specific-discount boundary receives a source-item disposition. Rows outside the reviewed callable catalog are explicitly excluded; missing exact Priority amounts are raw; numeric rows are normalized. Unbound, ambiguous, unsupported, or unresolved source items fail the refresh report.
- The current public catalog leaves only Inkling without a first-party current amount. A retired model may also remain unknown without reducing current-model coverage. Absence of a price is not converted to `not_published` unless Databricks says so explicitly.
- ccusage, LiteLLM, and models.dev are comparison-only diagnostics. ccusage inherits LiteLLM's price snapshot; LiteLLM converts Databricks DBU values with an assumed USD-per-DBU value; models.dev mixes authenticated inventory with upstream/manual USD costs. Their values are not used to fill catalog gaps because they collapse Databricks conditions and cannot establish account-exact cost.

## Kong AI Gateway

- Project chat candidates from active, acceptable-maturity rows in the exact General purpose set, not name heuristics.
- Deployment compatibility still requires workspace and region availability.
- Embedding and image-generation operations are outside Kong's current Databricks matrix. An image-output row may still qualify through its independently observed chat operation.
