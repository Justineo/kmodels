# Amazon Bedrock refinement

Status: reviewed against catalog snapshot `2026-07-23T10:16:16.151Z` and Kong AI Gateway 2.0

## Catalog assessment

The 128 rows are plausible for Bedrock because the catalog intentionally includes current and historical base-model IDs plus distinct Runtime, Mantle, regional, geo, and global programmatic identities. They are not 128 interchangeable deployments. IDs come from the official Programmatic Access tables; display names are never converted into request IDs.

The snapshot contains 112 active, 15 deprecated, and one preview row. It has 12,526 price rates because region, routing scope, endpoint, service tier, cache policy, media variant, and effective date remain separate conditions. That large rate count is expected and preferable to flattening them. Twenty-two rows lack context limits and 17 lack published pricing. The optional `us-east-1` `ListFoundationModels` inventory currently reaches AWS with configured credentials, but the IAM identity lacks `bedrock:ListFoundationModels`; regional account availability therefore remains unknown.

The source design remains sound: model cards, the Mantle service-region table, and AWS Price List data form one atomic catalog, while the authenticated regional API is only a scoped overlay. The same 128 rows and 12,526 rates carry 260 unique positive API facts and 1,913 exact region/endpoint/routing pairs. One row intentionally has no `api_endpoints`: its current card publishes a Runtime ID while marking every listed API unsupported, so the collector preserves the identity without inventing a route.

DeepSeek V3.2 exposes the same exact `deepseek.v3.2` ID through both Runtime and Mantle, and both endpoint families publish the same Chat Completions label and relative path. The adapter retains both endpoint-family observations during the card join, then collapses the identical public `{name, path}` fact once on the model row. This is lossless for the current schema: endpoint-specific availability and price conditions remain separate, while emitting the same public endpoint twice would be invalid and caused the provider to remain stale.

## Kong AI Gateway 2.0

The Kong source of truth is `app/ai-gateway/ai-providers/bedrock.md` and the Amazon Bedrock entry in `app/_data/ai-gateway/v2/providers.yaml`.

| Kong capability  | Upstream surface                                | Kmodels candidates                                                        |
| ---------------- | ----------------------------------------------- | ------------------------------------------------------------------------- |
| `generate`       | Converse / ConverseStream                       | `generate` rows explicitly documented for Converse in the selected region |
| `completions`    | Provider-specific invocation                    | Generative rows with matching invocation-format evidence                  |
| `embeddings`     | InvokeModel                                     | `embeddings` rows with matching Runtime identity                          |
| `image`          | InvokeModel                                     | `image` rows with an exact supported operation                            |
| `video`          | StartAsyncInvoke                                | `video` rows with async-invocation evidence                               |
| Native `bedrock` | Converse, Invoke, RAG, rerank, async invocation | Exact API-specific model or service evidence                              |

Batch and files are service-level capabilities and must not be copied onto every model. Native reranking is documented even though normalized Kong `rerank` is false, so compatibility also depends on `llm_format`. Audio transcription, moderation, and realtime rows in Kmodels are not supported merely because they are Bedrock models.

## Refinement decision

1. Keep the 128 exact catalog identities and all 12,526 conditional price rates.
2. Retain positive model-card API evidence for `Invoke`, `Converse`, `Responses`, `Chat Completions`, `Messages`, `StartAsyncInvoke`, and `InvokeModelWithBidirectionalStream` on each matching Runtime or Mantle ID. Chat Completions uses its documented path on both endpoint families; when both families use one exact ID, the identical public endpoint fact is emitted once. Messages uses the native Messages path on Mantle and the model invocation path on Runtime. Native `Rerank` additionally requires the model-specific sample-code heading. Unknown labels fail the atomic refresh.
3. Retain the official regional matrix as exact endpoint/routing pairs. Runtime geo and global pairs require the corresponding inference-profile ID from Programmatic Access. Mantle pairs are in-region only and require membership in the separately published Mantle service-region table; independent region, route, and endpoint columns are never cross-producted.
4. Do not infer service-level RAG on a model. Do not infer `InvokeModelWithResponseStream` from the broader `Invoke` label: the optional regional inventory's `responseStreamingSupported` remains a scoped capability until route evidence can retain that scope.
5. Treat deprecated rows as history and a skipped or permission-denied `us-east-1` inventory as an explicit account-availability gap. Fix the IAM policy externally rather than weakening the scoped-source contract.
