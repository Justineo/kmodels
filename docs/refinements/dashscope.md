# Alibaba Cloud Model Studio refinement

Status: reviewed against catalog snapshot `2026-07-22T17:04:19.221Z` and Kong AI Gateway 2.0; exact recommended-model route overlay implemented 2026-07-23

## Catalog assessment

The 379 rows are plausible because the regional catalog unions eleven independent official capability, pricing, and lifecycle pages across text, vision, image, video, speech, omni, embeddings, and reranking. Sixty-one rows expose multiple operation types. The snapshot contains 308 active, 47 deprecated, 17 retired, and seven preview rows, with 3,069 condition-preserving price rates.

This is a regional, non-exhaustive catalog. Thirty-five rows lack pricing, 264 lack context limits, and model release/update dates are mostly unavailable. The optional Singapore deployment inventory was skipped, so deployability for a specific account remains unknown.

The narrow “Recommended models” page remains unsuitable for presence, but its per-model cards are useful as an overlay. The current page names 21 exact IDs, 53 region/model-API availability pairs, and 12 complete request URLs across nine reviewed paths. Kmodels validates the card ID, region label, URL host, protocol, and path; it publishes only exact matching rows already established by the full catalogs. Base URLs and protocol tabs do not become inferred endpoints.

## Kong AI Gateway 2.0

The Kong source of truth is `app/ai-gateway/ai-providers/dashscope.md` and the Dashscope entry in `app/_data/ai-gateway/v2/providers.yaml`.

Kong supports only chat generation, embeddings, and image operations against the mainland or international Dashscope hosts. Kmodels also correctly catalogs audio generation, speech, transcription, translation, video, realtime, rerank, OCR, and classification, but those operations are outside this Kong provider matrix.

The Kong examples `qwen-plus` and `qwen-image-plus` are active, but neither appears in the current recommended-card overlay with a complete request URL, so their broad type and lifecycle facts alone do not make them endpoint candidates. The current overlay does publish exact international embedding evidence for `text-embedding-v4` and exact image evidence for `qwen-image-2.0-pro`.

`text-embedding-v1` is absent from the current embedding catalog and decommissioning page. A legacy Alibaba model-overview document last updated in 2024 confirms that the ID once existed, but it does not establish current availability. The Kong example is therefore historical documentation drift rather than a reason to restore a current Kmodels row.

Region is part of compatibility. A model observed on one official regional page must not be assumed to work on both `dashscope.aliyuncs.com` and `dashscope-intl.aliyuncs.com`. Broad `image` also needs an exact mapping to one of Kong's two documented image upstreams.

## Refinement decision

1. Keep all 379 regional catalog facts and conditional prices.
2. Derive Kong candidates only for generate, embeddings, and image with exact host/region and endpoint evidence. The current schema does not bind a host to an availability pair, so separately observed endpoint and region arrays must not be multiplied into route tuples.
3. Treat `text-embedding-v1` as historical until a current official catalog or deployment inventory observes it; do not manufacture it from the Kong example.
4. Keep the missing deployment API and sparse date coverage visible.

Implementation outcome: the recommended page is now a bounded, non-creating overlay. Duplicate cards merge exact region and endpoint evidence; unknown card IDs, regions, hosts, protocols, and paths reject the provider refresh so the last validated catalog is retained. This adds route evidence without changing the 379-row catalog or using the landing page as a presence source.
