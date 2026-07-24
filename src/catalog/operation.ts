import { modelOperationSchema, type ModelOperation, type ProviderModel } from "./schema.ts";

const order = new Map(modelOperationSchema.options.map((operation, index) => [operation, index]));

export function orderedOperations(operations: ModelOperation[]): ModelOperation[] {
  return [...new Set(operations)].sort(
    (left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0),
  );
}

export function classifyModelOperations(input: {
  modelId: string;
  name: string;
  rawType: string | undefined;
  modalities: ProviderModel["modalities"];
  fallback?: ModelOperation;
}): ModelOperation[] {
  const identity = `${input.modelId} ${input.name}`.toLowerCase();
  const operations: ModelOperation[] = [];
  if (/(?:lyria|music-generation|audio-generation)/.test(identity))
    operations.push("audio_generation");
  const embedding =
    /(?:^|[./:_ -])(?:embed(?:ding|dings)?|text-embedding|multimodal-embedding|bge|gte)(?:$|[./:_ -])/.test(
      identity,
    );
  if (embedding) operations.push("embeddings");
  if (/(?:^|[./:_ -])rerank(?:$|[./:_ -])/.test(identity)) operations.push("reranking");
  if (/(?:moderation|safeguard|(?:^|[./:_ -])guard(?:$|[./:_ -]))/.test(identity))
    operations.push("moderation");
  if (/(?:^|[./:_ -])ocr(?:$|[./:_ -])/.test(identity)) operations.push("ocr");
  if (/object[-_ ]detection/.test(identity)) operations.push("object_detection");
  if (/segmentation/.test(identity)) operations.push("segmentation");
  const speech = /(?:^|[./:_ -])tts(?:$|[./:_ -])|text-to-speech|cosyvoice/.test(identity);
  if (speech) operations.push("speech_synthesis");
  const transcription =
    !speech &&
    /(?:transcrib|whisper|paraformer|(?:^|[./:_ -])stt(?:$|[./:_ -])|chirp|voxtral)/.test(identity);
  if (transcription) operations.push("transcription");
  if (/(?:^|[./:_ -])translat(?:e|ion)(?:$|[./:_ -])/.test(identity))
    operations.push("translation");
  const liveAudio =
    !speech &&
    !transcription &&
    !/(?:computer[-_ ]use)/.test(identity) &&
    input.modalities.input.includes("audio") &&
    input.modalities.output.includes("audio") &&
    /(?:realtime|sonic|(?:^|[./:_ -])voice(?:$|[./:_ -]))/.test(identity);
  if (liveAudio) operations.push("speech_to_speech");
  const image = /(?:image|dall-e|imagen|flux|canvas)/.test(identity);
  if (
    !embedding &&
    (/(?:video|sora|veo|reel)/.test(identity) || (!image && /(?:^|[./:_ -])wan\d/.test(identity)))
  )
    operations.push("video_generation");
  if (!embedding && image) operations.push("image_generation");
  if (/(?:^|[./:_ -])classif(?:ier|ication)?(?:$|[./:_ -])/.test(identity))
    operations.push("classification");

  switch (input.rawType) {
    case "language":
      operations.push("text_generation");
      break;
    case "embedding":
      operations.push("embeddings");
      break;
    case "reranking":
      operations.push("reranking");
      break;
    case "image":
    case "image-generation":
      operations.push("image_generation");
      break;
    case "video":
      operations.push("video_generation");
      break;
    case "transcription":
      operations.push("transcription");
      break;
    case "speech":
      operations.push("speech_synthesis");
      break;
    case "realtime":
      if (input.modalities.input.includes("audio") && input.modalities.output.includes("audio"))
        operations.push("speech_to_speech");
  }

  if (operations.length === 0) {
    if (input.modalities.output.includes("embedding")) operations.push("embeddings");
    else if (input.modalities.output.includes("video")) operations.push("video_generation");
    else if (input.modalities.output.includes("image")) operations.push("image_generation");
    else if (input.fallback !== undefined) operations.push(input.fallback);
  }
  return orderedOperations(operations);
}

export function normalizeModelOperations(model: ProviderModel): ProviderModel {
  if (model.operations.length > 0)
    return { ...model, operations: orderedOperations(model.operations) };
  return {
    ...model,
    operations: classifyModelOperations({
      modelId: model.model_id,
      name: model.name,
      rawType: model.raw_type,
      modalities: model.modalities,
    }),
  };
}
