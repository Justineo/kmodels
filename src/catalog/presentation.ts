import type { ModelType, PriceRate, ProviderModel } from "./schema.ts";

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

export function formatModelType(value: ModelType): string {
  switch (value) {
    case "audio_generation":
      return "Audio generation";
    case "audio_speech":
      return "Text to speech";
    case "audio_transcription":
      return "Transcription";
    case "audio_translation":
      return "Audio translation";
    case "ocr":
      return "OCR";
    default:
      return value.charAt(0).toLocaleUpperCase() + value.slice(1);
  }
}

export function modelTypeList(model: ProviderModel): string {
  return model.types.map(formatModelType).join(", ");
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
  return rate === undefined ? "" : `/${formatSnakeCase(rate.unit)}`;
}

export function formatSnakeCase(value: string): string {
  return value.replaceAll("_", " ");
}

export function searchableModelText(model: ProviderModel): string {
  return [
    model.name,
    model.model_id,
    model.version ?? "",
    model.provider_id,
    ...model.types,
    ...(model.service_families ?? []),
    ...(model.api_endpoints ?? []).flatMap(({ name, path }) => [name, path]),
  ]
    .join(" ")
    .toLocaleLowerCase();
}
