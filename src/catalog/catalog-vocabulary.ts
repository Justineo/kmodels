export const modelTasks = [
  "text_generation",
  "embeddings",
  "reranking",
  "image_generation",
  "video_generation",
  "audio_generation",
  "speech_synthesis",
  "transcription",
  "translation",
  "speech_to_speech",
  "moderation",
  "classification",
  "ocr",
  "object_detection",
  "segmentation",
] as const;

export const deliveryModes = ["streaming", "realtime", "batch", "async"] as const;
export const modalities = ["text", "image", "audio", "video", "pdf", "embedding"] as const;
export const modelLifecycles = ["active", "legacy", "deprecated", "retired", "unknown"] as const;
export const modelReleaseStages = ["stable", "preview", "experimental", "unknown"] as const;
export const modelScopes = ["global_catalog", "regional_catalog", "runtime_observation"] as const;
