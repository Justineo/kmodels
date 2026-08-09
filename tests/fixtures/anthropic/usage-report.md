## Get Messages Usage Report

**get** `/v1/organizations/usage_report/messages`

- `bucket_width: optional "1d" or "1h" or "1m"`
- `group_by: optional array`
  - `"api_key_id"`
  - `"context_window"`
  - `"inference_geo"`
  - `"model"`
  - `"service_tier"`
  - `"speed"`
  - `"workspace_id"`
- `cache_creation: object`
- `output_tokens: number`
- `uncached_input_tokens: number`
