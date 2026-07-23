# Kimi refinement

Status: reviewed against catalog snapshot `2026-07-23T14:06:42.164Z`, live Kimi public and authenticated APIs, and current Kong AI Gateway provider documentation

## Catalog assessment

Nineteen rows are reasonable as the union of current OpenAPI model discriminators, current and retired model tables, pricing tables, and exact changelog matches. The snapshot contains four active, seven deprecated, seven retired, and one unknown-state row. All are generation models. The twelve IDs in the OpenAPI discriminator receive the exact `/v1/chat/completions` route; rows observed only in historical or pricing sources do not inherit it.

Eleven rows have 36 published CNY rates and eight historical or unmatched rows remain unknown. The pricing model keeps cached input, uncached input, output, and Batch tiers separate. Exact Batch pricing rows now retain the reviewed POST `/v1/batches` route after validating the companion create-batch API reference; models outside that table do not inherit it. The catalog is not declared exhaustive. The authenticated inventory returns 12 models with the documented schema from the international `api.moonshot.ai` origin. Its support flags are sparse positive facts, so omitted image, video, or reasoning fields remain unknown rather than false.

Kimi also publishes a `￥0.03` web-search tool charge, but the same page explicitly says that the feature is being upgraded and the document is outdated. It is therefore not current pricing evidence. Independently, the proposed offer-based pricing model is needed before a service add-on can be attached without creating invalid model/rate combinations.

## Kong AI Gateway 2.0

Kong's current official provider catalog has no Kimi entry, and its provider source directory has no `kimi.md`.

Kimi documents an OpenAI-compatible streaming route, but protocol compatibility is not evidence that Kong's OpenAI provider accepts Kimi identities or targets Kimi's upstream. Therefore no Kimi row is currently a Kong-native candidate.

## Refinement decision

1. Keep all independently observed source references and lifecycle history.
2. Attach the Chat Completions route only to exact current OpenAPI members, and the Batch route only to exact Batch pricing rows backed by the reviewed API reference.
3. Reject route drift atomically instead of deriving an endpoint from the generic Batch capability.
4. Exclude the explicitly outdated web-search charge.
5. Report no Kong-native intersection until Kong publishes one.
6. Leave account availability and non-exhaustive completeness explicit.
7. Preserve CNY and pricing conditions without conversion or cross-provider inheritance.
