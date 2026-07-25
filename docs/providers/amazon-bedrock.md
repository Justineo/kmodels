# Amazon Bedrock

Status: current

## Sources and identity

- The exhaustive public bundle contains the official model-card index, reviewed same-host cards, Mantle service regions, and three AWS Price List offers.
- Callable base IDs and inference-profile aliases come only from Programmatic Access tables. Never derive an ID from a display name.
- Runtime and Mantle IDs remain distinct unless their exact ID is identical. When both publish one identical endpoint label/path, emit that public fact once while retaining endpoint-specific price and availability conditions.
- Optional `ListFoundationModels` in `us-east-1` is regional authenticated validation. It may enrich exact public IDs but cannot create rows, define global availability, or retain raw data.
- Enable it with `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN` for temporary credentials. The identity needs `bedrock:ListFoundationModels` on `Resource: "*"`.

## Mapping

- Bind API, lifecycle, capability, and availability facts to the matching programmatic ID. Unknown modality/API/endpoint labels reject the provider; negative API rows add no positive evidence.
- Keep exact `{region, deployment_type}` pairs. Runtime geo/global evidence requires its exact inference-profile alias. Mantle remains in-region and must intersect with the service-region table. Never form cross-products.
- `Legacy` is callable-but-restricted, not deprecated. “No sooner than” is not an exact retirement date.
- RAG is service-level. `Invoke` does not imply response streaming. Native Rerank additionally requires its model-specific sample.
- Price joins require one unique official identity or exact ID occurrence. Preserve region, endpoint, routing class, tier, cache TTL, context threshold, media conditions, capacity direction, unit, and effective date.
- Map inventory enums only through reviewed semantics. New enum values fail closed. Regional streaming evidence remains scoped.

## Kong AI Gateway

- Compatibility requires exact model/API evidence for Converse, InvokeModel, provider-specific invocation, StartAsyncInvoke, or native surfaces plus region and endpoint scope.
- Batch, files, and RAG are service-level. Native rerank also depends on format.
- Do not infer support for audio transcription, moderation, realtime, or other tasks from Bedrock membership.
- Permission-denied optional inventory remains an explicit account-availability gap; fix IAM rather than weakening collection.
