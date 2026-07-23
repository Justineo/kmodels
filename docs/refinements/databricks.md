# Databricks refinement

Status: reviewed against catalog snapshot `2026-07-22T17:04:19.221Z` and Kong AI Gateway 2.0

## Catalog assessment

The 49 rows are reasonable for the reviewed AWS regional serving catalog. Their IDs come from exact `Endpoint name` fields, which is the right Databricks request identity. The snapshot contains 40 active, four preview, three deprecated, one retired, and one unknown-state row. Its operation distribution is 44 generation, three embeddings, and two image rows.

Forty-two rows have published DBU pricing and seven remain unknown. The 445 rates retain region, endpoint, context tier, batch, provisioned throughput, promotion, and effective date. DBU is not converted to USD. The workspace inventory was skipped, so a documented endpoint name is not proof that a given workspace exposes it.

The source calls itself exhaustive only for the reviewed AWS regional page; it is not a cross-cloud Databricks completeness claim.

## Kong AI Gateway 2.0

The Kong source of truth is `app/ai-gateway/ai-providers/databricks.md` and the Databricks entry in `app/_data/ai-gateway/v2/providers.yaml`.

Kong supports only streaming chat generation through `/serving-endpoints/v1/chat/completions`. The Kmodels ID shape aligns well because it already uses Databricks endpoint names. The documented example `databricks-gpt-oss-20b` is active in the reviewed catalog.

Embedding and image rows are valid Databricks facts but are not supported by Kong's Databricks provider. Even among `generate` rows, compatibility requires explicit chat-completions support and workspace/region availability.

## Refinement decision

1. Keep the exact endpoint-name identities and DBU-native prices.
2. Project only active or preview chat-completions endpoints to Kong.
3. Require workspace-scoped validation before claiming deployment availability.
4. Do not include Databricks embedding or image rows in the Kong 2.0 intersection.
