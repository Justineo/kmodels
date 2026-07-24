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
  return rate?.unit === "million_tokens" ? "" : formatRateUnit(rate);
}

export function formatSnakeCase(value: string): string {
  return value.replaceAll("_", " ");
}
