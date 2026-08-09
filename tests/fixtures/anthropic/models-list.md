## List Models

**get** `/v1/models`

- `after_id: optional string`

  ID of the object to use as a cursor for pagination.

- `limit: optional number`

  Defaults to `20`. Ranges from `1` to `1000`.

- `capabilities: ModelCapabilities`
  - `batch: CapabilitySupport`
  - `citations: CapabilitySupport`
  - `code_execution: CapabilitySupport`
  - `context_management: ContextManagementCapability`
  - `effort: EffortCapability`
  - `image_input: CapabilitySupport`
  - `pdf_input: CapabilitySupport`
  - `structured_outputs: CapabilitySupport`
  - `thinking: ThinkingCapability`
