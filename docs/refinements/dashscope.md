# Alibaba Cloud Model Studio refinement

Status: reviewed against catalog snapshot `2026-07-22T17:04:19.221Z` and Kong AI Gateway 2.0

## Catalog assessment

The 379 rows are plausible because the regional catalog unions eleven independent official capability, pricing, and lifecycle pages across text, vision, image, video, speech, omni, embeddings, and reranking. Sixty-one rows expose multiple operation types. The snapshot contains 308 active, 47 deprecated, 17 retired, and seven preview rows, with 3,069 condition-preserving price rates.

This is a regional, non-exhaustive catalog. Thirty-five rows lack pricing, 264 lack context limits, and model release/update dates are mostly unavailable. The optional Singapore deployment inventory was skipped, so deployability for a specific account remains unknown.

## Kong AI Gateway 2.0

The Kong source of truth is `app/ai-gateway/ai-providers/dashscope.md` and the Dashscope entry in `app/_data/ai-gateway/v2/providers.yaml`.

Kong supports only chat generation, embeddings, and image operations against the mainland or international Dashscope hosts. Kmodels also correctly catalogs audio generation, speech, transcription, translation, video, realtime, rerank, OCR, and classification, but those operations are outside this Kong provider matrix.

The Kong examples `qwen-plus` and `qwen-image-plus` are active. `text-embedding-v1` is absent from the reviewed Kmodels catalog; current exact embedding IDs are newer entries such as `text-embedding-v3` and `text-embedding-v4`. This may be Kong documentation drift or a Kmodels source-coverage gap and must remain a warning until one official source resolves it.

Region is part of compatibility. A model observed on one official regional page must not be assumed to work on both `dashscope.aliyuncs.com` and `dashscope-intl.aliyuncs.com`. Broad `image` also needs an exact mapping to one of Kong's two documented image upstreams.

## Refinement decision

1. Keep all 379 regional catalog facts and conditional prices.
2. Derive Kong candidates only for generate, embeddings, and image with exact host/region and endpoint evidence.
3. Investigate `text-embedding-v1` without manufacturing it from the Kong example.
4. Keep the missing deployment API and sparse date coverage visible.
