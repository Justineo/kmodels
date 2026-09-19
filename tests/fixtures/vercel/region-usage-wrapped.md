<!-- Reviewed excerpts from https://vercel.com/docs/ai-gateway/security-and-compliance/regional-inference.md, 2026-09-19. Original prose wrapping retained. -->

Not every provider serves every region, so coverage varies by provider and model
(see Current limits). Don't assume a request ran where you
asked; confirm the resolved region from the response (see Confirming where a
request ran).

## Regional pricing

You only take on a region's rate when you set `inferenceRegion`. Leave it unset
(the `global` default) to route at the provider's standard rate.

Read `inferenceEndpoint.geoRegion` (here `us`) and compare it against the region
you asked for; `finalProvider` names the provider that served the request. When
you don't pin a region, `inferenceEndpoint` is `null`, matching the `global`
default, which doesn't pin a region.
