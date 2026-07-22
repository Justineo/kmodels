import type { ModelType, ProviderModel } from "./schema.ts";

export function classifyModelTask(input: {
  modelId: string;
  name: string;
  rawType: string | undefined;
  modalities: ProviderModel["modalities"];
  fallback: ModelType;
}): ModelType {
  const identity = `${input.modelId} ${input.name}`.toLowerCase();
  if (
    /(?:^|[./:_ -])(?:embed(?:ding|dings)?|text-embedding|multimodal-embedding|gte)(?:$|[./:_ -])/.test(
      identity,
    )
  )
    return "embedding";
  if (/(?:^|[./:_ -])rerank(?:$|[./:_ -])/.test(identity)) return "rerank";
  if (/(?:moderation|safeguard|(?:^|[./:_ -])guard(?:$|[./:_ -]))/.test(identity))
    return "moderation";
  if (/(?:^|[./:_ -])ocr(?:$|[./:_ -])/.test(identity)) return "ocr";
  if (/(?:^|[./:_ -])tts(?:$|[./:_ -])|text-to-speech|cosyvoice/.test(identity))
    return "text_to_speech";
  if (
    /(?:transcrib|whisper|paraformer|(?:^|[./:_ -])stt(?:$|[./:_ -])|chirp|voxtral)/.test(identity)
  )
    return "speech_to_text";
  if (
    /(?:realtime|(?:^|[./:_ -])audio(?:$|[./:_ -])|sonic|(?:^|[./:_ -])voice(?:$|[./:_ -]))/.test(
      identity,
    )
  )
    return "speech_to_speech";
  if (/(?:video|sora|veo|reel|(?:^|[./:_ -])wan\d)/.test(identity)) return "video_generation";
  if (/(?:image|dall-e|imagen|flux|canvas)/.test(identity)) return "image_generation";
  if (/computer-use/.test(identity)) return "computer_use";
  if (/(?:^|[./:_ -])classif(?:ier|ication)?(?:$|[./:_ -])/.test(identity)) return "classifier";

  switch (input.rawType) {
    case "language":
      return "text_generation";
    case "embedding":
      return "embedding";
    case "reranking":
      return "rerank";
    case "image":
    case "image-generation":
      return "image_generation";
    case "video":
      return "video_generation";
    case "transcription":
      return "speech_to_text";
    case "speech":
      return "text_to_speech";
    case "realtime":
      return "speech_to_speech";
  }

  if (input.modalities.output.includes("embedding")) return "embedding";
  if (input.modalities.output.includes("video")) return "video_generation";
  if (input.modalities.output.includes("image")) return "image_generation";
  if (input.modalities.output.includes("audio"))
    return input.modalities.input.includes("audio") ? "speech_to_speech" : "text_to_speech";
  return input.fallback;
}

export function normalizeModelTask(model: ProviderModel): ProviderModel {
  const fallback = model.types.find((type) => type !== "other") ?? "text_generation";
  return {
    ...model,
    types: [
      classifyModelTask({
        modelId: model.model_id,
        name: model.name,
        rawType: model.raw_type,
        modalities: model.modalities,
        fallback,
      }),
    ],
  };
}
