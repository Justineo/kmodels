# Databricks refinement

Status: reviewed against the live AWS regional catalog and current Kong Databricks provider documentation on 2026-07-23

## Catalog assessment

The 48 rows exactly match the reviewed AWS regional serving catalog. Their IDs come from labeled `Endpoint name` fields, which are the Databricks request identities. The live result contains 40 active, four preview, three deprecated, and one retired row. The official task matrix classifies 45 endpoints as general-purpose generation and three as embeddings; two general-purpose rows additionally produce images.

All 48 rows have exact model-specific `/serving-endpoints/{name}/invocations` route evidence. Forty-four rows have published DBU pricing and four remain unknown. The 456 live rates retain endpoint, context tier, batch, cache-read, provisioned entry/scaling capacity, promotion, and effective date. DBU is not converted to USD. The workspace inventory remains optional, so a documented endpoint is not proof that a particular workspace or region exposes it.

The source is exhaustive only for the reviewed AWS regional page. The task matrix must cover exactly the same endpoint IDs, and pricing tables must retain their reviewed semantic columns; drift fails the provider atomically rather than publishing shifted rates or inferred routes. This is not a cross-cloud Databricks completeness claim.

## Kong AI Gateway 2.0

The current Kong provider page documents Chat Completions support with streaming and an upstream `/serving-endpoints/v1/chat/completions` path.

The Kmodels ID shape aligns because it uses Databricks endpoint names. The documented Kong example `databricks-gpt-oss-20b` is active and appears in Databricks' General purpose task set.

Embedding operations are outside Kong's documented Databricks capability. Image-output rows may participate only through their separately evidenced General purpose/chat operation; the image-generation operation itself is not a Kong compatibility claim. Deployment compatibility still requires active/preview lifecycle and workspace/region availability.

## Refinement decision

1. Keep the exact endpoint-name identities and DBU-native prices.
2. Use the exact General purpose task set, not name heuristics, when projecting active or preview chat endpoints to Kong.
3. Require workspace-scoped validation before claiming deployment availability.
4. Exclude embedding and image-generation operations from the Kong intersection; do not exclude an image-output model's independently documented chat operation.
