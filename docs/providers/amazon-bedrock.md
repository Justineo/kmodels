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
- The three AWS Price List sources use `current/index.json`, which AWS defines as the latest service price-list version. Treat their returned terms as the current snapshot and retain each term's `effectiveDate` as raw audit evidence, not as a historical-only applicability qualifier. Conflicting same-scope terms still reject the provider candidate.
- `AmazonBedrockFoundationModels` is the Marketplace billing representation and omits the callable endpoint. AWS documents identical per-token pricing across Runtime and Mantle, so endpoint is not a commercial condition for its on-demand per-token facts; bind them to each exact Programmatic Access ID and supported deployment type without duplicating endpoint variants. Service per-token facts without an explicit Mantle SKU use the exact Runtime ID but likewise omit endpoint as a price condition, allowing Marketplace base prices and service-only context tiers to resolve together. Preserve explicit Mantle, batch, reserved, provisioned, and TPM endpoint distinctions from their SKU.
- Compare overlapping AWS decimal prices numerically rather than by source formatting, so `3.0000000000` and a converted `0.003` per 1K tokens agree without weakening unequal-price conflict detection.
- The AWS Price List label `Units` is source spelling, not a semantic unit. Disambiguate tokens, searches, seconds, images, requests, and capacity only from exact SKU/product attributes; otherwise leave the unit unnormalized.
- Keep `1K TPM Hour` and reviewed model-capacity hours as provider-qualified atomic capacity units. They are exact prices that can be selected and displayed, but they are not ordinary token-throughput rates and are never converted to tokens.
- Map inventory enums only through reviewed semantics. New enum values fail closed. Regional streaming evidence remains scoped.

## Kong AI Gateway

- Compatibility requires exact model/API evidence for Converse, InvokeModel, provider-specific invocation, StartAsyncInvoke, or native surfaces plus region and endpoint scope.
- Batch, files, and RAG are service-level. Native rerank also depends on format.
- Do not infer support for audio transcription, moderation, realtime, or other tasks from Bedrock membership.
- Permission-denied optional inventory remains an explicit account-availability gap; fix IAM rather than weakening collection.
