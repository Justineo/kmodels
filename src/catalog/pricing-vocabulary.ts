export const standardPriceDimensions = [
  "model",
  "region",
  "endpoint",
  "deployment_type",
  "deployment_scope",
  "service_tier",
  "requested_service_tier",
  "served_service_tier",
  "speed",
  "inference_geo",
  "route_provider",
  "context_tier",
  "modality",
  "operation",
  "resolution",
  "quality",
  "search_effort",
  "style",
  "capacity",
  "billing_period",
  "billing_currency",
  "account_eligibility",
  "request_audio",
  "voice_control",
  "video_input",
  "promotion",
  "cache_ttl_seconds",
  "context_tokens",
  "input_tokens",
  "output_tokens",
  "duration_seconds",
] as const;

export const standardBillingUnits = [
  "token",
  "character",
  "byte",
  "pixel",
  "request",
  "event",
  "item",
  "image",
  "page",
  "frame",
  "second",
  "billing_day",
  "billing_month",
  "billing_year",
  "seat",
  "instance",
  "replica",
  "accelerator",
  "capacity_unit",
] as const;

export const standardPriceMeters = [
  "input_text",
  "output_text",
  "cache_read_text",
  "cache_write_text",
  "input_audio",
  "output_audio",
  "input_image",
  "output_image",
  "input_video",
  "output_video",
  "image_generation",
  "video_generation",
  "embedding",
  "rerank",
  "transcription",
  "speech_generation",
  "web_search",
  "image_search",
  "maps_search",
  "file_search",
  "retrieval",
  "grounded_generation",
  "code_execution",
  "container_runtime",
  "session_runtime",
  "storage",
  "data_transfer",
  "content_safety",
  "custom_reporting",
  "training_input",
  "training_compute",
  "evaluation",
  "compute",
  "provisioned_capacity",
  "subscription",
  "acquisition",
] as const;

export const standardUsageSignals = [
  "input_tokens",
  "uncached_input_tokens",
  "cached_input_tokens",
  "cache_write_tokens",
  "output_tokens",
  "reasoning_output_tokens",
  "input_characters",
  "processed_pages",
  "processed_images",
  "processed_audio_seconds",
  "accepted_requests",
  "completed_result_items",
  "successful_web_searches",
  "generated_items",
  "generated_images",
  "generated_seconds",
  "active_seconds",
  "stored_byte_seconds",
  "transferred_bytes",
] as const;

export const applicabilityResolutionPhases = [
  "publication",
  "request",
  "outcome",
  "account",
] as const;

interface StandardUsageSignalDetails {
  label: string;
  definition: string;
  resolution_phase: (typeof applicabilityResolutionPhases)[number];
}

function outcomeSignal(label: string, definition: string): StandardUsageSignalDetails {
  return { label, definition, resolution_phase: "outcome" };
}

export const standardUsageSignalDetails = {
  input_tokens: outcomeSignal("Input tokens", "Provider-reported full billable input tokens"),
  uncached_input_tokens: outcomeSignal(
    "Uncached input tokens",
    "Billable input tokens excluding the provider-reported cached partition",
  ),
  cached_input_tokens: outcomeSignal(
    "Cached input tokens",
    "Provider-reported cached-input partition",
  ),
  cache_write_tokens: outcomeSignal(
    "Cache-write tokens",
    "Provider-reported cache-creation partition",
  ),
  output_tokens: outcomeSignal("Output tokens", "Provider-reported billable output tokens"),
  reasoning_output_tokens: outcomeSignal(
    "Reasoning output tokens",
    "Provider-reported reasoning-token subset of billable output tokens",
  ),
  input_characters: outcomeSignal(
    "Input characters",
    "Provider-reported billable input characters",
  ),
  processed_pages: outcomeSignal("Processed pages", "Provider-reported billable document pages"),
  processed_images: outcomeSignal("Processed images", "Provider-reported billable input images"),
  processed_audio_seconds: outcomeSignal(
    "Processed audio duration",
    "Provider-reported billable audio duration in canonical seconds",
  ),
  accepted_requests: outcomeSignal(
    "Accepted requests",
    "Requests the provider accepted as billable",
  ),
  completed_result_items: outcomeSignal(
    "Completed result items",
    "Completed result items with independently billable usage",
  ),
  successful_web_searches: outcomeSignal(
    "Successful web searches",
    "Provider-confirmed successful web-search executions; errors are excluded",
  ),
  generated_items: outcomeSignal("Generated items", "Provider-reported completed generated items"),
  generated_images: outcomeSignal(
    "Generated images",
    "Provider-reported completed generated images",
  ),
  generated_seconds: outcomeSignal(
    "Generated duration",
    "Provider-reported completed media duration",
  ),
  active_seconds: outcomeSignal("Active runtime", "Provider-reported active runtime"),
  stored_byte_seconds: {
    label: "Stored data over time",
    definition: "Officially integrated retained bytes over time",
    resolution_phase: "account",
  },
  transferred_bytes: outcomeSignal("Transferred data", "Provider-reported transferred bytes"),
} satisfies Record<(typeof standardUsageSignals)[number], StandardUsageSignalDetails>;

export const standardResourceKinds = [
  "service",
  "plan",
  "capacity",
  "distribution",
  "account_resource_template",
] as const;

export const publishedTimePrecisions = ["year", "month", "date", "datetime"] as const;
export const pricingRefreshFailureCodes = [
  "source_unavailable",
  "source_schema_changed",
  "pricing_validation_failed",
  "provider_refresh_failed",
  "pricing_not_observed",
] as const;
export const priceStates = [
  "numeric",
  "free",
  "included",
  "externally_billed",
  "custom_quote",
  "not_published",
] as const;
export const enrollmentStates = [
  "open",
  "waitlist",
  "closed_to_new",
  "private_preview",
  "account_scoped",
] as const;
export const rawPricingImpacts = ["base_price", "allowance", "informational"] as const;
