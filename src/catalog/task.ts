import { modelTasks } from "./catalog-vocabulary.ts";
import type { ModelTask, ProviderModel, TaskEvidence } from "./schema.ts";

const order = new Map(modelTasks.map((task, index) => [task, index]));
const providerTaskMappings = new Map<string, readonly ModelTask[]>([
  ["conversational", ["text_generation"]],
  ["text-generation", ["text_generation"]],
  ["summarization", ["text_generation"]],
  ["question-answering", ["text_generation"]],
  ["table-question-answering", ["text_generation"]],
  ["fill-mask", ["text_generation"]],
  ["document-question-answering", ["text_generation"]],
  ["image-to-text", ["text_generation"]],
  ["visual-question-answering", ["text_generation"]],
  ["feature-extraction", ["embeddings"]],
  ["sentence-similarity", ["embeddings"]],
  ["text-ranking", ["reranking"]],
  ["automatic-speech-recognition", ["transcription"]],
  ["text-to-speech", ["speech_synthesis"]],
  ["text-to-audio", ["audio_generation"]],
  ["audio-to-audio", ["audio_generation"]],
  ["text-to-image", ["image_generation"]],
  ["image-to-image", ["image_generation"]],
  ["text-to-video", ["video_generation"]],
  ["image-to-video", ["video_generation"]],
  ["audio-classification", ["classification"]],
  ["image-classification", ["classification"]],
  ["zero-shot-image-classification", ["classification"]],
  ["text-classification", ["classification"]],
  ["token-classification", ["classification"]],
  ["zero-shot-classification", ["classification"]],
  ["tabular-classification", ["classification"]],
  ["image-segmentation", ["segmentation"]],
  ["object-detection", ["object_detection"]],
]);

export function orderedTasks(tasks: ModelTask[]): ModelTask[] {
  return [...new Set(tasks)].sort(
    (left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0),
  );
}

function evidenceKey(evidence: TaskEvidence): string {
  return [
    evidence.task,
    evidence.source_ref,
    evidence.namespace,
    evidence.raw_value,
    evidence.kind,
  ].join("\0");
}

function taskEvidence(model: ProviderModel, tasks: ModelTask[]): TaskEvidence[] {
  const evidence = new Map((model.task_evidence ?? []).map((item) => [evidenceKey(item), item]));
  const [sourceRef] = model.source_refs;
  if (model.raw_type !== undefined && sourceRef !== undefined && model.source_refs.length === 1) {
    for (const task of tasks) {
      const item: TaskEvidence = {
        task,
        source_ref: sourceRef,
        namespace: `${model.provider_id}.type`,
        raw_value: model.raw_type,
        kind: "provider_type",
      };
      evidence.set(evidenceKey(item), item);
    }
  }
  for (const route of model.routes ?? []) {
    for (const task of providerTaskMappings.get(route.task) ?? []) {
      if (!tasks.includes(task)) continue;
      const item: TaskEvidence = {
        task,
        source_ref: route.source_ref,
        namespace: `${model.provider_id}.task`,
        raw_value: route.task,
        kind: "provider_task",
      };
      evidence.set(evidenceKey(item), item);
    }
  }
  return [...evidence.values()].sort(
    (left, right) =>
      (order.get(left.task) ?? 0) - (order.get(right.task) ?? 0) ||
      evidenceKey(left).localeCompare(evidenceKey(right)),
  );
}

export function classifyModelTasks(input: {
  modelId: string;
  name: string;
  rawType: string | undefined;
  modalities: ProviderModel["modalities"];
  fallback?: ModelTask;
}): ModelTask[] {
  const identity = `${input.modelId} ${input.name}`.toLowerCase();
  const tasks: ModelTask[] = [];
  if (/(?:lyria|music-generation|audio-generation)/.test(identity)) tasks.push("audio_generation");
  const embedding =
    /(?:^|[./:_ -])(?:embed(?:ding|dings)?|text-embedding|multimodal-embedding|bge|gte)(?:$|[./:_ -])/.test(
      identity,
    );
  if (embedding) tasks.push("embeddings");
  if (/(?:^|[./:_ -])rerank(?:$|[./:_ -])/.test(identity)) tasks.push("reranking");
  if (/(?:moderation|safeguard|(?:^|[./:_ -])guard(?:$|[./:_ -]))/.test(identity))
    tasks.push("moderation");
  if (/(?:^|[./:_ -])ocr(?:$|[./:_ -])/.test(identity)) tasks.push("ocr");
  if (/object[-_ ]detection/.test(identity)) tasks.push("object_detection");
  if (/segmentation/.test(identity)) tasks.push("segmentation");
  const speech = /(?:^|[./:_ -])tts(?:$|[./:_ -])|text-to-speech|cosyvoice/.test(identity);
  if (speech) tasks.push("speech_synthesis");
  const transcription =
    !speech &&
    /(?:transcrib|whisper|paraformer|(?:^|[./:_ -])stt(?:$|[./:_ -])|chirp|voxtral)/.test(identity);
  if (transcription) tasks.push("transcription");
  if (/(?:^|[./:_ -])translat(?:e|ion)(?:$|[./:_ -])/.test(identity)) tasks.push("translation");
  const liveAudio =
    !speech &&
    !transcription &&
    !/(?:computer[-_ ]use)/.test(identity) &&
    input.modalities.input.includes("audio") &&
    input.modalities.output.includes("audio") &&
    /(?:realtime|sonic|(?:^|[./:_ -])voice(?:$|[./:_ -]))/.test(identity);
  if (liveAudio) tasks.push("speech_to_speech");
  const image = /(?:image|dall-e|imagen|flux|canvas)/.test(identity);
  if (
    !embedding &&
    (/(?:video|sora|veo|reel)/.test(identity) || (!image && /(?:^|[./:_ -])wan\d/.test(identity)))
  )
    tasks.push("video_generation");
  if (!embedding && image) tasks.push("image_generation");
  if (/(?:^|[./:_ -])classif(?:ier|ication)?(?:$|[./:_ -])/.test(identity))
    tasks.push("classification");

  switch (input.rawType) {
    case "language":
      tasks.push("text_generation");
      break;
    case "embedding":
      tasks.push("embeddings");
      break;
    case "reranking":
      tasks.push("reranking");
      break;
    case "image":
    case "image-generation":
      tasks.push("image_generation");
      break;
    case "video":
      tasks.push("video_generation");
      break;
    case "transcription":
      tasks.push("transcription");
      break;
    case "speech":
      tasks.push("speech_synthesis");
      break;
    case "realtime":
      if (input.modalities.input.includes("audio") && input.modalities.output.includes("audio"))
        tasks.push("speech_to_speech");
  }

  if (tasks.length === 0) {
    if (input.modalities.output.includes("embedding")) tasks.push("embeddings");
    else if (input.modalities.output.includes("video")) tasks.push("video_generation");
    else if (input.modalities.output.includes("image")) tasks.push("image_generation");
    else if (input.fallback !== undefined) tasks.push(input.fallback);
  }
  return orderedTasks(tasks);
}

export function normalizeModelTasks<T extends ProviderModel>(model: T): T & ProviderModel {
  const tasks =
    model.tasks.length > 0
      ? orderedTasks(model.tasks)
      : classifyModelTasks({
          modelId: model.model_id,
          name: model.name,
          rawType: model.raw_type,
          modalities: model.modalities,
        });
  const evidence = taskEvidence(model, tasks);
  return {
    ...model,
    tasks,
    task_evidence: evidence.length === 0 ? undefined : evidence,
  };
}
