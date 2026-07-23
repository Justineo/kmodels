# xAI refinement

Status: stale snapshot reviewed against Kong AI Gateway 2.0; collector repair required

## Catalog assessment

The retained snapshot has 20 rows: nine active, two preview, one deprecated, and eight retired. It covers generation, agentic, image, video, and realtime models, with 12 rows carrying published prices and eight historical rows remaining unknown.

The current refresh is stale because xAI removed token-price fields from audio-model entries and the strict structured adapter rejected the changed payload. Failure-closed retention worked as designed, but no current compatibility claim should be generated until the schema change is reviewed and a fresh atomic refresh succeeds.

The overall count is plausible for a lifecycle catalog. The public structured model payload plus exact official pricing/lifecycle text is the right source design; the problem is a narrow schema assumption for operation-specific pricing, not a reason to weaken validation globally.

## Kong AI Gateway 2.0

The Kong source of truth is `app/ai-gateway/ai-providers/xai.md` and the xAI entry in `app/_data/ai-gateway/v2/providers.yaml`.

Kong supports non-streaming chat generation, image generation, and agentic Responses. It does not support the xAI video or realtime voice operations recorded by Kmodels.

The Kong examples have drifted: `grok-3` is retired, and `grok-2-image` is absent from the retained catalog. Current image rows use `grok-imagine-*` IDs, but no alias should be invented between those names. Because the provider snapshot is stale, this mismatch is a warning rather than a final lifecycle judgment.

## Refinement decision

1. Repair the audio schema using operation-specific optional pricing fields while preserving strict validation of the fields that are present.
2. Require a fresh provider refresh before publishing a Kong compatibility projection.
3. Limit the Kong intersection to generate, image, and agentic endpoint evidence.
4. Keep video and realtime facts in Kmodels but outside Kong's xAI matrix.
