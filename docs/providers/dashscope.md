# Alibaba Cloud Model Studio

Status: current

## Sources and identity

- Nine official model-inventory pages are independent non-exhaustive regional catalogs. Only their Recommended, All, and Legacy model sections define rows; specification tables and full-width section labels do not. IDs come only from labeled model fields, without a product-prefix allowlist.
- Union exact rows across sources while retaining every source reference.
- The lifecycle-and-updates tables are a non-creating release overlay. A model's earliest exact regional entry is its global `release_date`; later regional availability does not imply that the model itself was updated.
- The recommended page is a bounded, non-creating route overlay. A card adds facts only when all IDs agree and region, host, protocol, path, and complete request URL are reviewed.
- Unknown card data rejects the provider. Keep endpoint and region as separate positive facts; never create a host/region/endpoint Cartesian product.
- Optional Singapore deployment inventory is account/region scoped and one complete bounded page. It may add exact `mu`, `cu`, `ptu`, `ptu_v2`, or `lora` plans but cannot create/remove rows or retain private data.
- Enable the optional inventory with `DASHSCOPE_API_KEY`.

## Mapping

- The pricing page may create rows only from labeled callable IDs.
- Parse merged and comma-separated model cells structurally. Each amount retains its own region, deployment, thinking, context, modality, resolution, promotion, operation, and native unit; combined input/output video charges become both meters.
- Published free trials and limited-time-free rates are numeric promotional zeroes; trials retain their account-eligibility condition. Published discontinuations are retired and not applicable for pricing. Any other pricing row without a supported numeric value or explicit disposition rejects the refresh instead of silently becoming unknown.
- Derive discounts/cache rates only from published rules for exact supported IDs and regions.
- Do not flatten the Token Plan subscription allowance into model rates. Do not publish free output amounts without an observed billing unit.
- The decommissioning policy owns historical lifecycle. “Legacy,” page timestamps, dates in IDs, and non-exact release labels do not establish lifecycle or dates.

## Kong AI Gateway

- Kong supports chat generation, embeddings, and image operations only.
- Candidates require active lifecycle, acceptable maturity, and exact endpoint plus host/region evidence. Broad task evidence is insufficient.
- Audio, speech, transcription, translation, video, realtime, rerank, OCR, and classification remain outside its Dashscope matrix.
- Historical or absent Kong examples never restore rows. Do not manufacture route tuples while the schema stores endpoint and region separately.
