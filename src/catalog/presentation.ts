import type { ModelLifecycle, ModelTask, ModelReleaseStage, ProviderModel } from "./schema.ts";

type VersionedModel = Pick<ProviderModel, "model_id" | "provider_id" | "uid" | "version">;
type StatusModel = Pick<ProviderModel, "release_stage" | "status">;
type TaskModel = Pick<ProviderModel, "tasks">;

const compactNumber = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const relativeTimeUnits = [
  [365 * 24 * 60 * 60 * 1_000, "year"],
  [30 * 24 * 60 * 60 * 1_000, "month"],
  [7 * 24 * 60 * 60 * 1_000, "week"],
  [24 * 60 * 60 * 1_000, "day"],
  [60 * 60 * 1_000, "hour"],
  [60 * 1_000, "minute"],
  [1_000, "second"],
] as const;

export function formatCount(value: number): string {
  return new Intl.NumberFormat("en").format(value);
}

export function formatLocalDateTime(
  value: string,
  timeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "long",
        timeZone,
      }).format(timestamp)
    : value;
}

export function formatRelativeTime(value: string, now = Date.now()): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "at an unknown time";
  const difference = timestamp - now;
  const absoluteDifference = Math.abs(difference);
  const [duration, unit] =
    relativeTimeUnits.find(([candidate]) => absoluteDifference >= candidate) ??
    ([1_000, "second"] as const);
  return relativeTime.format(Math.round(difference / duration), unit);
}

export function versionBadgeModelUids(models: readonly VersionedModel[]): Set<string> {
  const counts = new Map<string, number>();
  for (const model of models) {
    const key = JSON.stringify([model.provider_id, model.model_id]);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set(
    models
      .filter((model) => (counts.get(JSON.stringify([model.provider_id, model.model_id])) ?? 0) > 1)
      .map((model) => model.uid),
  );
}

export function formatTokenCount(value: number | undefined): string {
  return value === undefined ? "—" : compactNumber.format(value);
}

export function formatModelTask(value: ModelTask): string {
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

export function formatTableTask(value: ModelTask): string {
  switch (value) {
    case "audio_generation":
      return "Audio";
    case "classification":
      return "Classify";
    case "embeddings":
      return "Embed";
    case "image_generation":
      return "Image";
    case "moderation":
      return "Moderate";
    case "object_detection":
      return "Detect";
    case "ocr":
      return "OCR";
    case "reranking":
      return "Rerank";
    case "segmentation":
      return "Segment";
    case "speech_synthesis":
      return "TTS";
    case "speech_to_speech":
      return "S2S";
    case "text_generation":
      return "Text";
    case "transcription":
      return "STT";
    case "translation":
      return "Translate";
    case "video_generation":
      return "Video";
  }
}

export function modelTaskList(model: TaskModel): string {
  if (model.tasks.length === 0) return "Not published";
  return model.tasks.map(formatModelTask).join(", ");
}

export function primaryStatus(model: StatusModel): ModelLifecycle | ModelReleaseStage {
  return model.status === "active" && model.release_stage !== "unknown"
    ? model.release_stage
    : model.status;
}

export function formatSnakeCase(value: string): string {
  return value.replaceAll("_", " ");
}

export function formatSentenceCase(value: string): string {
  const text = formatSnakeCase(value);
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
