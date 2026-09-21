import { load } from "cheerio";
import { compare, valid } from "@renovatebot/pep440";
import { z } from "zod";
import { htmlTables, htmlText } from "./html.ts";
import { modelIdSchema } from "./identity.ts";
import type { SourceManifest } from "./manifests.ts";
import { baseModel } from "./model.ts";
import type { ParsedProviderModel } from "./pricing-source.ts";
import type { ModelTask, Provider } from "./schema.ts";
import { assertItemCount } from "./source-contract.ts";

export const sagemakerCatalogUrl =
  "https://docs.aws.amazon.com/sagemaker/latest/dg/jumpstart-foundation-models-latest.html";
export const sagemakerCacheUrl =
  "https://jumpstart-cache-prod-us-west-2.s3.us-west-2.amazonaws.com/";
export const sagemakerManifestUrl = `${sagemakerCacheUrl}proprietary-sdk-manifest.json`;
export const sagemakerPricesUrl =
  "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonSageMaker/current/index.json";

export interface SageMakerRow {
  id: string;
  name: string;
  task: string;
  fineTuning: boolean | "unknown";
  proprietary: boolean;
}

export function sagemakerRows(body: string): SageMakerRow[] {
  const $ = load(body);
  const result: SageMakerRow[] = [];
  const seen = new Set<string>();
  for (const section of ["open-weight-models", "proprietary-models"]) {
    const panels = $("dd[tab-id]").filter((_index, element) =>
      new RegExp(`^${section}-\\(\\d+\\)$`).test($(element).attr("tab-id") ?? ""),
    );
    if (panels.length !== 1) throw new Error("SageMaker foundation catalog section changed");
    const tables = htmlTables(panels.html() ?? "");
    const table = tables[0];
    if (tables.length !== 1 || table === undefined)
      throw new Error("SageMaker foundation table was not unique");
    const columns = ["Model ID", "Model Name", "Task", "Fine-tunable"].map((name) => {
      const indexes = table.headers.flatMap((header, index) => (header === name ? [index] : []));
      if (indexes.length !== 1 || indexes[0] === undefined)
        throw new Error("SageMaker foundation table header changed");
      return indexes[0];
    });
    const count = Number(panels.attr("tab-id")?.match(/\((\d+)\)$/)?.[1]);
    if (table.rows.length !== count) throw new Error("SageMaker foundation table was incomplete");
    for (const row of table.rows) {
      const [id, name, task, fineTuning] = columns.map((column) => row[column]?.text ?? "");
      const parsedId = modelIdSchema.parse(id);
      if (!name || !task || seen.has(parsedId))
        throw new Error("SageMaker foundation identity was missing or duplicated");
      seen.add(parsedId);
      result.push({
        id: parsedId,
        name: htmlText(name),
        task: htmlText(task),
        fineTuning: fineTuning === "Yes" ? true : fineTuning === "No" ? false : "unknown",
        proprietary: section === "proprietary-models",
      });
    }
  }
  assertItemCount("SageMaker foundation catalog", result.length, 1, 3000);
  return result;
}

// These are source task labels, not model-name or publisher allowlists.
const taskMap = new Map<string, ModelTask[]>([
  ["text generation", ["text_generation"]],
  ["reasoning", ["text_generation"]],
  ["text summarization", ["text_generation"]],
  ["text2text generation", ["text_generation"]],
  ["image-text-to-text", ["text_generation"]],
  ["image2text generation", ["text_generation"]],
  ["text embedding", ["embeddings"]],
  ["rerank", ["reranking"]],
  ["optical character recognition", ["ocr"]],
  ["text-to-image", ["image_generation"]],
  ["text to image", ["image_generation"]],
  ["image-to-image", ["image_generation"]],
  ["image-text-to-image", ["image_generation"]],
  ["text-to-speech", ["speech_synthesis"]],
  ["text to audio", ["audio_generation"]],
  ["automatic speech recognition", ["transcription"]],
  ["translation", ["translation"]],
  ["zero-shot classification", ["classification"]],
  ["text classification", ["classification"]],
  ["token classification", ["classification"]],
  ["classification", ["classification"]],
  ["image segmentation", ["segmentation"]],
  ["object detection", ["object_detection"]],
]);

export function parseSagemakerCatalog(input: {
  provider: Provider;
  source: SourceManifest;
  body: string;
  observedAt: string;
}): ParsedProviderModel[] {
  return sagemakerRows(input.body).map((row) => {
    const model = baseModel({
      providerId: input.provider.id,
      id: row.id,
      name: row.name,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    });
    model.raw_type = row.task;
    model.tasks = [...(taskMap.get(row.task.toLowerCase()) ?? [])];
    model.task_evidence = model.tasks.map((task) => ({
      task,
      source_ref: input.source.id,
      namespace: "sagemaker.jumpstart.task",
      raw_value: row.task,
      kind: "provider_task",
    }));
    model.capabilities.fine_tuning = row.fineTuning;
    if (row.task === "Reasoning") model.capabilities.reasoning = true;
    model.service_families = ["SageMaker JumpStart"];
    // The source explicitly lists currently available models, but neither GA nor account access.
    model.status = "active";
    return model;
  });
}

const packageVersion = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[\x20-\x7e]+$/);
const manifestHeaderSchema = z.object({
  model_id: modelIdSchema,
  version: packageVersion,
  spec_key: z.string().max(512),
});

export const sagemakerSpecSchema = z.object({
  model_id: modelIdSchema,
  version: packageVersion,
  listing_id: z.string().regex(/^prodview-[a-z0-9]+$/),
});

export function sagemakerPricingSpecs(body: string, rows: readonly SageMakerRow[]) {
  const admitted = new Set(rows.filter((row) => row.proprietary).map((row) => row.id));
  const headers = z.array(manifestHeaderSchema).max(10_000).parse(JSON.parse(body));
  const byModel = new Map<string, Map<string, z.infer<typeof manifestHeaderSchema>>>();
  for (const header of headers) {
    if (!admitted.has(header.model_id)) continue;
    if (
      header.spec_key !==
      `proprietary-models/${header.model_id}/proprietary_specs_${header.version}.json`
    )
      throw new Error("SageMaker SDK spec path changed identity");
    const versions =
      byModel.get(header.model_id) ?? new Map<string, z.infer<typeof manifestHeaderSchema>>();
    versions.set(header.version, header);
    byModel.set(header.model_id, versions);
  }
  if (byModel.size !== admitted.size)
    throw new Error("SageMaker proprietary pricing manifest omitted an admitted model");
  return [...byModel]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, headers]) => {
      const versions = [...headers.values()];
      // Mirror the official SDK's get_latest_version resolver: PEP 440 when every
      // value is valid, otherwise Python's lexical max. This only discovers a
      // Marketplace link; it makes no global model-version or capability claim.
      const semantic = versions.every((header) => valid(header.version) !== null);
      return versions.reduce((current, header) => {
        const newer = semantic
          ? compare(header.version, current.version) > 0
          : header.version > current.version;
        return newer ? header : current;
      });
    });
}
