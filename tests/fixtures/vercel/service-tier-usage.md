<!-- Reviewed excerpts from https://vercel.com/docs/ai-gateway/models-and-providers/service-tiers.md, 2026-09-19. -->

## Reading the applied service tier

The AI SDK exposes the applied tier as `providerMetadata.gateway.serviceTier`. Chat Completions, Messages, and OpenResponses responses expose AI Gateway metadata under `provider_metadata.gateway.serviceTier`; OpenAI-compatible responses can also include `service_tier`. The Python beta may omit routing metadata, so inspect request logs when it is unavailable. AI Gateway only sets this field when the request was served at `flex` or `priority`. If the provider reports the standard tier, AI Gateway omits this field. If your client omits provider metadata, use request logs to confirm the applied tier.

AI Gateway bills the request at the tier the provider actually served, not the tier you requested.
