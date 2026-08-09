# Data residency

The `inference_geo` parameter is supported on Claude 4.6 and later models. Older models return a 400 error.

The response `usage` object includes an `inference_geo` field. Workspaces configure `allowed_inference_geos` and `default_inference_geo`.
