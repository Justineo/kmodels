# Amazon Bedrock

Status: current

## Sources and identity

- The exhaustive public bundle contains the official model-card index, every bounded publisher
  sub-index linked from it, reviewed same-host cards, Mantle service regions, three AWS Price List
  offers, the official Bedrock pricing page, and the exact AWS Marketplace product page for Cohere
  Embed 4. Publisher sub-indexes are necessary because AWS can
  publish a card there before adding it to the top-level table; this was observed for GPT-5.6 Sol,
  Terra, and Luna. The structured `current/index.json` inventories remain the primary billing
  denominator; the public pricing page is the current exact overlay for reviewed model/rate tables
  that can lead the structured feeds.
- Callable base IDs and inference-profile aliases come only from Programmatic Access tables. Never derive an ID from a display name.
- Runtime and Mantle IDs remain distinct unless their exact ID is identical. When both publish one identical endpoint label/path, emit that public fact once while retaining endpoint-specific price and availability conditions.
- Preserve an explicit per-card API path. GPT-5.6 uses `openai/v1/responses`, which must not be
  collapsed into the otherwise common Mantle `v1/responses` route.
- Optional `ListFoundationModels` in `us-east-1` is regional authenticated validation. It may enrich exact public IDs but cannot create rows, define global availability, or retain raw data.
- Enable it with `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN` for temporary credentials. The identity needs `bedrock:ListFoundationModels` on `Resource: "*"`.

## Mapping

- Bind API, lifecycle, capability, and availability facts to the matching programmatic ID. Unknown modality/API/endpoint labels reject the provider; negative API rows add no positive evidence.
- Keep exact `{region, deployment_type}` pairs. Runtime geo/global evidence requires its exact inference-profile alias. Mantle remains in-region and must intersect with the service-region table. Never form cross-products.
- `Legacy` is callable-but-restricted, not deprecated. An exact EOL date becomes canonical `retired` when effective even if a stale model card still says `Legacy`; “No sooner than” is not an exact retirement date and never triggers that transition.
- RAG is service-level. `Invoke` does not imply response streaming. Native Rerank additionally requires its model-specific sample.
- Price joins require one unique official identity or exact ID occurrence. If an inference product omits an identity attribute, match its usage-type tokens against the official card name only when that normalized family identifies one model; an explicit but different version/name never falls back to family matching. Repeated cards are equivalent only when their exact Programmatic Access IDs, endpoints, and deployment types agree.
- Preserve region, endpoint, routing class, tier, cache TTL, context threshold, media conditions, capacity direction, unit, and effective date. Preserve provider image subtypes such as standard and document images as operations when they select different rates.
- Keep `performanceConfig.latency=optimized` in canonical `speed=optimized`, independent of
  `service_tier`. Standard latency is completed only when an optimized alternative establishes that
  dimension. AWS can fall an optimized request back to standard latency and exposes the served
  configuration in the response, so gateways must price the resolved value. Recognize both
  `long-context` and Price List's `long-ctx` spelling as the `context_tokens >= 200001` tier.
- The three AWS Price List sources use `current/index.json`, which AWS defines as the latest service price-list version. Treat their returned terms as the current snapshot and retain each term's `effectiveDate` as raw audit evidence, not as a historical-only applicability qualifier. Conflicting same-scope terms still reject the provider candidate.
- Parse only reviewed model sections and exact region groups from the public pricing page. Page rows
  bind through current Programmatic Access identities and never create a model. They fill missing
  current structured rates and replace an unequal same-scope Price List value because AWS explicitly
  says the service pricing page is charged when it differs from an informational Price List file;
  that replacement receives its own reconciliation reason. Page-only identities remain visible as
  unbound reconciliation findings until a current model card supplies the callable ID.
- The reviewed page overlay currently owns exact OpenAI Frontier token/cache tables and Stability AI
  Image Services per-generation tables. Stability service rates retain their three published US
  regions and geo deployment scope; no model-name or region defaults are inferred outside that
  table.
- The Cohere Embed 4 Marketplace product page is an exact product/ID companion. Its current usage
  term contains 46 dynamically parsed rate cards: in-region and global input-token prices for 23
  regions. Duplicate hydrated copies are accepted only when their complete card sets are identical;
  changed identity, vendor, unit, region pairing, card count, or unequal copies reject refresh.
  These product-specific cards carry the reviewed
  `bedrock_marketplace_product_page_over_price_list` fact policy. They may supersede only a weaker
  overlapping bulk-feed value whose entire scope they cover; the bulk value remains informational
  audit evidence.
- `AmazonBedrockFoundationModels` is the Marketplace billing representation and omits the callable endpoint. AWS documents identical per-token pricing across Runtime and Mantle, so endpoint is not a commercial condition for its on-demand per-token facts; bind them to each exact Programmatic Access ID and supported deployment type without duplicating endpoint variants. Service per-token facts without an explicit Mantle SKU use the exact Runtime ID but likewise omit endpoint as a price condition, allowing Marketplace base prices and service-only context tiers to resolve together. Preserve explicit Mantle, batch, reserved, provisioned, and TPM endpoint distinctions from their SKU.
- Compare overlapping AWS decimal prices numerically rather than by source formatting, so `3.0000000000` and a converted `0.003` per 1K tokens agree without weakening unequal-price conflict detection.
- AWS unit labels are interpreted only with exact billing evidence. This includes `Search Units`, `Input Images`, `Text Requests`, and an `Embeddings` unit whose dimension explicitly says `InputTokenCount`; generic `Units` still requires its SKU/description to identify tokens, searches, seconds, images, requests, or capacity.
- Classify embedding prices by the commercial input being metered: token rates are `input_text`, processed images are `input_image`, and explicit audio/video duration rates are `input_audio`/`input_video`. Use the generic `embedding` meter for request-priced embedding operations and retain their explicit input modality. Product/model wording alone is not a modality condition, and a modality encoded by a directional meter is not duplicated as applicability.
- Keep reviewed TPM-hour and model-capacity hours as provider-qualified atomic capacity units. The Marketplace field `1M TPM Hour` is treated as a 1K-TPM-hour unit only when its own dimension description explicitly says “per 1K … TPM”; this resolves the source-field disagreement without converting the price.
- Every price-list dimension and every reviewed pricing-page cell receives one reconciliation
  disposition. Dimensions associated with a current model card, plus inference products that require
  usage-derived identity, must be normalized or deliberately excluded as
  customization/training/storage. Any other unmatched identity, target, unit, or meter rejects the
  fresh provider candidate, preserving the last valid snapshot instead of silently dropping price
  rows. Explicit price-list or page models absent from the current card catalog remain unbound because
  AWS billing surfaces can lead the callable catalog or retain stale products.
- Bedrock's provider-wide applicability budget is 64 MiB, matching the provider partition budget.
  The reviewed 2026-08-05 candidate required 33,716,751 bytes—only 162,319 bytes above the earlier
  32 MiB calibration—while remaining within the partition, selector-work, variant, and observation
  limits. Raising this aggregate budget preserves those independent safety bounds instead of
  discarding a complete, otherwise valid price book.
- A catalog model remains `unknown` when no current price product binds uniquely. Do not transfer prices from a similarly named generation, preview, or Stability utility operation.
- The current refresh deliberately leaves three callable rows unresolved.
  `amazon.titan-embed-g1-text-02` has an exact model card but no exact current pricing-page or Price
  List identity; do not copy the price from Titan Embeddings G1 Text or Titan Text Embeddings V2.
  `openai.gpt-5.5` and `openai.gpt-5.6-sol` are present in current OpenAI publisher cards, but neither
  the Bedrock pricing page nor the AWS Price List supplies an exact current rate for those callable
  IDs. OpenAI's direct-platform rates are a different commercial surface and cannot fill the gap.
- Map inventory enums only through reviewed semantics. New enum values fail closed. Regional streaming evidence remains scoped.
- Model-card dates are calendar-validated. A present but malformed launch, legacy, or exact EOL date
  rejects the provider candidate instead of disappearing as an unknown date.

## Public estimate and billed cost

- A gateway can produce a near-real-time public-list estimate from request and response facts. Keep
  the exact callable model or inference-profile ID, caller Region, endpoint, deployment scope,
  operation/batch mode, requested and resolved service tier, requested and served latency
  configuration, cache TTL, and all modality-specific usage. Do not choose a rate from the display
  name alone.
- `Converse` and `ConverseStream` return input, output, cache-read, and cache-write token counts;
  cache-aware `inputTokens` excludes cache reads and writes. They also return the served service
  tier. Latency-optimized inference returns the served latency configuration. `CountTokens` is a
  model-specific, no-charge preflight for input tokens, not a final billed-cost response.
- `InvokeModel` usage fields remain model-native rather than one uniform response schema. For
  `bedrock-runtime`, optional model invocation logging supplies per-request model ID, operation,
  Region, identity, input/output token counts, and cache counts; logging is disabled by default and
  does not cover `bedrock-mantle`. Mantle APIs instead expose their OpenAI- or Anthropic-compatible
  response usage, while Mantle CloudWatch token metrics are aggregate observations.
- The public pricing page and Price List APIs establish public commercial rates, not an account's
  net invoice. Private Marketplace offers, enterprise/private discounts, credits, free-tier
  eligibility, tax, refund timing, and the allocation or amortization of Reserved/Provisioned
  commitments require the account's AWS billing data or an operator policy. Reserved overflow must
  be priced from the resolved tier; a fixed reservation cannot be truthfully allocated to one call
  without a chosen cost-allocation rule.
- Cost Explorer is not a request-path signal: current-month data appears in about 24 hours and is
  refreshed at least daily, with some upstream data later. CUR aggregates Bedrock by usage type over
  an hour or day and carries no per-request ID. Use response/log usage plus the public book for hot
  path estimation and cost-aware routing; reconcile later against CUR/Cost Explorer. Never use a
  billing API as the load-balancer's per-request cost oracle.

## First-party conflicts

- AWS's per-request metadata page contains a stale consideration that says to join invocation logs
  to CUR on `requestId`. The same page's reconciliation section and the dedicated CUR guide state
  that neither classic CUR nor CUR 2.0 contains a per-request identifier. Follow the latter explicit
  schema boundary: join only at model, usage-type, and time grain, with logs retaining request detail.
- AWS Price List documentation calls its Query/Bulk data informational and says the service pricing
  page controls when they differ. The normalizer therefore records a reviewed page-over-Price-List
  replacement instead of silently accepting both values or rejecting fresh data.
- The Cohere Embed 4 product page publishes USD 0.12 per million input tokens consistently across
  its 46 regional/global cards. Three bulk-feed `Embeddings` dimensions instead decode to USD
  0.0000000200 per input token for narrower Runtime regions. The exact product page wins through the
  same fact-local containment rule; the three unequal bulk values are retained as
  `superseded_value`, so this upstream disagreement no longer makes the model commercially
  incomplete and is still auditable.

## External comparison

- ccusage is not a Bedrock billing catalog or Bedrock invocation-log reader. Its calculated costs use
  an embedded/refreshed LiteLLM snapshot and optional user overrides, so it adds no independent AWS
  evidence.
- The current LiteLLM map covers many Bedrock IDs but flattens much of AWS's region, endpoint,
  routing, context, and capacity surface. Its `amazon.titan-embed-g1-text-02` value copies a simple
  token rate without an exact first-party binding, and its zero rates for
  `anthropic.claude-mythos-preview` must not be interpreted as free service.
- The current models.dev Bedrock provider lists the GPT-5.6 family with public token/cache rates but
  omits the two unresolved models above and primarily models language-model SDK use rather than the
  complete AWS billing denominator. It does not replace the Price List's regional/tier variants.
- These sources remain read-only drift checks. No third-party identity, price, alias, date, or
  fallback enters collection.

## Kong AI Gateway

- Compatibility requires exact model/API evidence for Converse, InvokeModel, provider-specific invocation, StartAsyncInvoke, or native surfaces plus region and endpoint scope.
- Batch, files, and RAG are service-level. Native rerank also depends on format.
- Do not infer support for audio transcription, moderation, realtime, or other tasks from Bedrock membership.
- Permission-denied optional inventory remains an explicit account-availability gap; fix IAM rather than weakening collection.
- Cost-based routing uses the request's prospective public rate and, after completion, the resolved
  response usage/configuration. Account-net-cost routing is possible only with an explicit local
  contract/commitment model; delayed Cost Explorer or CUR totals can calibrate that model but cannot
  select the current request's route.
