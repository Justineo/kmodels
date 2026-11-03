import { z } from "zod";
import { isCredentialLikeIdentifier, modelIdSchema } from "./identity.ts";
import { baseModel, modelRouteKey } from "./model.ts";
import { assertItemCount } from "./source-contract.ts";
import { orderedTasks, providerTasks } from "./task.ts";
import type { ParsedProviderModel } from "./pricing-source.ts";
import type { SourceParseInput } from "./source-parse.ts";
import type { Modality, ModelRoute, ModelTask } from "./schema.ts";

interface TaskFacts {
  tasks: ModelTask[];
  input: Modality[];
  output: Modality[];
}

const hubIdSchema = modelIdSchema.refine((value) => {
  const parts = value.split("/");
  return parts.length <= 2 && parts.every((part) => /^[a-z0-9][a-z0-9._-]*$/i.test(part));
}, "Expected a Hugging Face repository ID");
const hubSchema = z.object({ models: z.array(z.unknown()) });
const hubItemSchema = z.object({
  id: hubIdSchema,
  lastModified: z.unknown().optional(),
  inferenceProviderMapping: z.array(z.unknown()),
});
const liveMappingSchema = z.object({
  provider: z.literal("hf-inference"),
  status: z.literal("live"),
  type: z.literal("single-model").optional(),
  providerId: modelIdSchema,
  task: z.string().trim().min(1).max(128),
});
const modifiedDateSchema = z.iso.datetime({ offset: true });

function modalityEntries(
  tasks: readonly string[],
  input: Modality[],
  output: Modality[],
): [string, Pick<TaskFacts, "input" | "output">][] {
  return tasks.map((task) => [task, { input, output }]);
}

const taskModalities = new Map([
  ...modalityEntries(
    [
      "conversational",
      "fill-mask",
      "question-answering",
      "summarization",
      "table-question-answering",
      "text-classification",
      "text-generation",
      "text-to-text-generation",
      "token-classification",
      "translation",
      "zero-shot-classification",
    ],
    ["text"],
    ["text"],
  ),
  ...modalityEntries(
    ["document-question-answering", "image-text-to-text"],
    ["text", "image"],
    ["text"],
  ),
  ...modalityEntries(
    [
      "image-classification",
      "image-to-text",
      "visual-question-answering",
      "zero-shot-image-classification",
    ],
    ["image"],
    ["text"],
  ),
  ...modalityEntries(["feature-extraction"], ["text"], ["embedding"]),
  ...modalityEntries(["sentence-similarity", "text-ranking"], ["text"], []),
  ...modalityEntries(["audio-classification", "automatic-speech-recognition"], ["audio"], ["text"]),
  ...modalityEntries(["text-to-audio", "text-to-speech"], ["text"], ["audio"]),
  ...modalityEntries(["audio-to-audio"], ["audio"], ["audio"]),
  ...modalityEntries(["text-to-image"], ["text"], ["image"]),
  ...modalityEntries(["image-segmentation", "image-to-image"], ["image"], ["image"]),
  ...modalityEntries(["text-to-video"], ["text"], ["video"]),
  ...modalityEntries(["image-text-to-video"], ["text", "image"], ["video"]),
  ...modalityEntries(["image-to-video"], ["image"], ["video"]),
  ...modalityEntries(["object-detection"], ["image"], []),
  ...modalityEntries(["tabular-classification"], [], ["text"]),
]);

function facts(task: string): TaskFacts {
  const modalities = taskModalities.get(task) ?? { input: [], output: [] };
  return { tasks: providerTasks(task), ...modalities };
}

export function parseHuggingFaceHub(input: SourceParseInput): ParsedProviderModel[] {
  const config = input.source.extractor;
  if (config.kind !== "huggingface-hub") throw new Error("Invalid Hugging Face Hub extractor");
  const { models: items } = hubSchema.parse(JSON.parse(input.body));
  const repositories = new Map<string, { routes: Map<string, ModelRoute>; date?: string }>();
  for (const rawItem of items) {
    const item = hubItemSchema.safeParse(rawItem);
    if (!item.success || isCredentialLikeIdentifier(item.data.id)) continue;
    const { id, lastModified, inferenceProviderMapping } = item.data;
    const repository = repositories.get(id) ?? { routes: new Map<string, ModelRoute>() };
    let hasLiveMapping = false;
    for (const rawMapping of inferenceProviderMapping) {
      const mapping = liveMappingSchema.safeParse(rawMapping);
      if (!mapping.success || isCredentialLikeIdentifier(mapping.data.providerId)) continue;
      const route: ModelRoute = {
        source_ref: input.source.id,
        provider: mapping.data.provider,
        provider_model_id: mapping.data.providerId,
        task: mapping.data.task,
        status: mapping.data.status,
      };
      repository.routes.set(modelRouteKey(route), route);
      hasLiveMapping = true;
    }
    if (!hasLiveMapping) continue;
    const observedDate = modifiedDateSchema.safeParse(lastModified);
    const date = observedDate.success ? observedDate.data.slice(0, 10) : undefined;
    if (date !== undefined && (repository.date === undefined || date > repository.date))
      repository.date = date;
    repositories.set(id, repository);
  }
  assertItemCount(
    "Hugging Face live HF Inference models",
    repositories.size,
    config.minModels,
    config.maxModels,
  );
  const models = [...repositories].map(([id, { routes, date }]): ParsedProviderModel => {
    const sortedRoutes = [...routes.values()].sort((left, right) =>
      modelRouteKey(left).localeCompare(modelRouteKey(right)),
    );
    const observed = sortedRoutes.map(({ task }) => facts(task));
    return {
      ...baseModel({
        providerId: input.provider.id,
        id,
        name: id,
        sourceId: input.source.id,
        observedAt: input.observedAt,
      }),
      status: "active",
      routes: sortedRoutes,
      tasks: orderedTasks(observed.flatMap(({ tasks }) => tasks)),
      modalities: {
        input: [...new Set(observed.flatMap(({ input }) => input))],
        output: [...new Set(observed.flatMap(({ output }) => output))],
      },
      ...(date === undefined ? {} : { updated_date: date }),
    };
  });
  return models.sort((left, right) => left.uid.localeCompare(right.uid));
}
