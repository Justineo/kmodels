import type {
  ModelLifecycle,
  ModelOperation,
  ModelReleaseStage,
  PriceRate,
  ProviderModel,
} from "./schema.ts";
import { scaleDecimal } from "./pricing.ts";

const compactNumber = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export type TableRateSlot = "input" | "cached" | "output";

const inputMeters: readonly PriceRate["meter"][] = [
  "input_text",
  "input_image",
  "input_audio",
  "input_video",
];
const cachedMeters: readonly PriceRate["meter"][] = [
  "cache_read_text",
  "cache_read_image",
  "cache_read_audio",
  "cache_read_video",
  "cache_write_text",
  "cache_write_image",
  "cache_write_audio",
  "cache_write_video",
  "cache_storage",
];
const defaultOutputMeters: readonly PriceRate["meter"][] = [
  "output_text",
  "output_image",
  "output_audio",
  "output_video",
  "image_generation",
  "video_generation",
  "embedding",
  "rerank_request",
  "tool_call",
  "realtime_client_message",
  "realtime_session_duration",
  "batch_inference",
  "gpu_hour",
  "provisioned_throughput",
];

export function formatCount(value: number): string {
  return new Intl.NumberFormat("en").format(value);
}

export function formatTokenCount(value: number | undefined): string {
  return value === undefined ? "—" : compactNumber.format(value);
}

export function formatModelOperation(value: ModelOperation): string {
  switch (value) {
    case "audio_generation":
      return "Audio generation";
    case "speech_synthesis":
      return "Text to speech";
    case "speech_to_speech":
      return "Speech to speech";
    case "transcription":
      return "Transcription";
    case "text_generation":
      return "Text generation";
    case "image_generation":
      return "Image generation";
    case "video_generation":
      return "Video generation";
    case "object_detection":
      return "Object detection";
    case "ocr":
      return "OCR";
    default:
      return value.charAt(0).toLocaleUpperCase() + value.slice(1);
  }
}

export function modelOperationList(model: ProviderModel): string {
  if (model.operations.length === 0) return "Not published";
  return model.operations.map(formatModelOperation).join(", ");
}

export function primaryStatus(model: ProviderModel): ModelLifecycle | ModelReleaseStage {
  return model.status === "active" && model.release_stage !== "unknown"
    ? model.release_stage
    : model.status;
}

export function preferredRate(
  model: ProviderModel,
  meter: PriceRate["meter"],
): PriceRate | undefined {
  return (
    model.pricing.find(
      (item) => item.meter === meter && Object.keys(item.conditions).length === 0,
    ) ?? model.pricing.find((item) => item.meter === meter)
  );
}

function operationOutputMeters(model: ProviderModel): readonly PriceRate["meter"][] {
  if (model.operations.includes("image_generation"))
    return ["image_generation", "output_image", ...defaultOutputMeters];
  if (model.operations.includes("video_generation"))
    return ["video_generation", "output_video", ...defaultOutputMeters];
  if (model.operations.includes("embeddings")) return ["embedding", ...defaultOutputMeters];
  if (model.operations.includes("reranking")) return ["rerank_request", ...defaultOutputMeters];
  if (
    model.operations.includes("audio_generation") ||
    model.operations.includes("speech_synthesis") ||
    model.operations.includes("speech_to_speech")
  )
    return ["output_audio", ...defaultOutputMeters];
  return defaultOutputMeters;
}

export function representativeTableRate(
  model: ProviderModel,
  slot: TableRateSlot,
): PriceRate | undefined {
  const meters =
    slot === "input"
      ? inputMeters
      : slot === "cached"
        ? cachedMeters
        : operationOutputMeters(model);
  for (const meter of new Set(meters)) {
    const rate = preferredRate(model, meter);
    if (rate !== undefined) return perMillionTokenRate(rate);
  }
  return undefined;
}

export function perMillionTokenRate(rate: PriceRate | undefined): PriceRate | undefined {
  if (rate === undefined || rate.unit === "million_tokens") return rate;
  const places = rate.unit === "token" ? 6 : rate.unit === "thousand_tokens" ? 3 : undefined;
  if (places === undefined) return rate;
  return {
    ...rate,
    price: scaleDecimal(rate.price, places),
    unit: "million_tokens",
  };
}

function formatDecimal(value: string): string {
  const decimalPoint = value.indexOf(".");
  if (decimalPoint === -1) return value;
  const fraction = value.slice(decimalPoint + 1).replace(/0+$/, "");
  return fraction.length === 0
    ? value.slice(0, decimalPoint)
    : `${value.slice(0, decimalPoint)}.${fraction}`;
}

export function formatPrice(rate: PriceRate | undefined): string {
  if (rate === undefined) return "—";
  const amount = formatDecimal(rate.price);
  return rate.currency === "USD" ? `$${amount}` : `${rate.currency} ${amount}`;
}

export function formatRateUnit(rate: PriceRate | undefined): string {
  if (rate === undefined) return "";
  switch (rate.unit) {
    case "thousand_tokens":
      return "/1K tokens";
    case "million_tokens":
      return "/1M tokens";
    case "million_characters":
      return "/1M characters";
    case "thousand_characters":
      return "/1K characters";
    case "thousand_pages":
      return "/1K pages";
    case "thousand_requests":
      return "/1K requests";
    case "thousand_search_units":
      return "/1K search units";
    default:
      return `/${formatSnakeCase(rate.unit)}`;
  }
}

export function formatTableRateUnit(rate: PriceRate | undefined): string {
  if (rate === undefined || rate.unit === "million_tokens") return "";
  switch (rate.unit) {
    case "character":
      return "/char";
    case "gpu_hour":
      return "/GPU·hr";
    case "image":
      return "/img";
    case "million_characters":
      return "/1M chars";
    case "million_tokens_per_hour":
      return "/1M tok·hr";
    case "minute":
      return "/min";
    case "request":
      return "/req";
    case "second":
      return "/sec";
    case "thousand_characters":
      return "/1K chars";
    case "thousand_requests":
      return "/1K req";
    case "thousand_search_units":
      return "/1K search";
    case "thousand_tokens_per_minute_hour":
      return "/1K TPM·hr";
    case "unit_hour":
      return "/unit·hr";
    case "unit_month":
      return "/unit·mo";
    default:
      return formatRateUnit(rate);
  }
}

export function formatTableRateLabel(rate: PriceRate): string {
  return `${formatSnakeCase(rate.meter)} · ${formatPrice(rate)} ${formatRateUnit(rate)}`;
}

export function formatSnakeCase(value: string): string {
  return value.replaceAll("_", " ");
}
