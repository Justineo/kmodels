import { modelTypeSchema, type ModelType, type ProviderModel } from "./schema.ts";

const order = new Map(modelTypeSchema.options.map((type, index) => [type, index]));

function unique(types: ModelType[]): ModelType[] {
  const observed = [...new Set(types)];
  const known = observed.filter((type) => type !== "other");
  return (known.length > 0 ? known : observed).sort(
    (left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0),
  );
}

export function classifyModelTypes(input: {
  modelId: string;
  name: string;
  rawType: string | undefined;
  modalities: ProviderModel["modalities"];
  fallback: ModelType;
}): ModelType[] {
  const identity = `${input.modelId} ${input.name}`.toLowerCase();
  const types: ModelType[] = [];
  if (/(?:lyria|music-generation|audio-generation)/.test(identity)) types.push("audio_generation");
  const embedding =
    /(?:^|[./:_ -])(?:embed(?:ding|dings)?|text-embedding|multimodal-embedding|bge|gte)(?:$|[./:_ -])/.test(
      identity,
    );
  if (embedding) types.push("embeddings");
  if (/(?:^|[./:_ -])rerank(?:$|[./:_ -])/.test(identity)) types.push("rerank");
  if (/(?:moderation|safeguard|(?:^|[./:_ -])guard(?:$|[./:_ -]))/.test(identity))
    types.push("moderation");
  if (/(?:^|[./:_ -])ocr(?:$|[./:_ -])/.test(identity)) types.push("ocr");
  const speech = /(?:^|[./:_ -])tts(?:$|[./:_ -])|text-to-speech|cosyvoice/.test(identity);
  if (speech) types.push("audio_speech");
  if (
    !speech &&
    /(?:transcrib|whisper|paraformer|(?:^|[./:_ -])stt(?:$|[./:_ -])|chirp|voxtral)/.test(identity)
  )
    types.push("audio_transcription");
  if (/(?:^|[./:_ -])translat(?:e|ion)(?:$|[./:_ -])/.test(identity))
    types.push("audio_translation");
  if (/(?:realtime|sonic|(?:^|[./:_ -])voice(?:$|[./:_ -]))/.test(identity)) types.push("realtime");
  const image = /(?:image|dall-e|imagen|flux|canvas)/.test(identity);
  if (
    !embedding &&
    (/(?:video|sora|veo|reel)/.test(identity) || (!image && /(?:^|[./:_ -])wan\d/.test(identity)))
  )
    types.push("video");
  if (!embedding && image) types.push("image");
  if (/computer-use/.test(identity)) types.push("agentic");
  if (/(?:^|[./:_ -])classif(?:ier|ication)?(?:$|[./:_ -])/.test(identity))
    types.push("classification");

  switch (input.rawType) {
    case "language":
      types.push("generate");
      break;
    case "embedding":
      types.push("embeddings");
      break;
    case "reranking":
      types.push("rerank");
      break;
    case "image":
    case "image-generation":
      types.push("image");
      break;
    case "video":
      types.push("video");
      break;
    case "transcription":
      types.push("audio_transcription");
      break;
    case "speech":
      types.push("audio_speech");
      break;
    case "realtime":
      types.push("realtime");
  }

  if (types.length === 0) {
    if (input.modalities.output.includes("embedding")) types.push("embeddings");
    else if (input.modalities.output.includes("video")) types.push("video");
    else if (input.modalities.output.includes("image")) types.push("image");
    else if (input.modalities.output.includes("audio"))
      types.push(input.modalities.input.includes("audio") ? "realtime" : "audio_speech");
    else types.push(input.fallback);
  }
  return unique(types);
}

export function normalizeModelTypes(model: ProviderModel): ProviderModel {
  const observed = model.types.filter((type) => type !== "other");
  if (observed.length > 0) return { ...model, types: unique(observed) };
  return {
    ...model,
    types: classifyModelTypes({
      modelId: model.model_id,
      name: model.name,
      rawType: model.raw_type,
      modalities: model.modalities,
      fallback: "other",
    }),
  };
}
