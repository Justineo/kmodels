POST https://api.cohere.com/v2/embed

## Response

### 200

OK

- `id` (string, required)
- `meta` (ApiMeta, optional)

## Types

### ApiMeta

- `billed_units` (ApiMetaBilledUnits, optional)

### ApiMetaBilledUnits

- `input_tokens` (double, optional) — The number of billed input tokens.
- `image_tokens` (double, optional) — The number of billed image tokens.
- `output_tokens` (double, optional) — The number of billed output tokens.
