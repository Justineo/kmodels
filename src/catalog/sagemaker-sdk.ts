import { compare, valid } from "@renovatebot/pep440";
import { z } from "zod";
import { modelIdSchema } from "./identity.ts";
import { modelCardSchema, deploymentSpecSchema } from "./model-metadata.ts";
import { baseModel } from "./model.ts";
import { modalitySchema, type Provider } from "./schema.ts";
import type { SourceManifest } from "./manifests.ts";
import { packageVersion, sagemakerTasks, type SageMakerRow } from "./sagemaker.ts";

const headerSchema = z.object({
  model_id: modelIdSchema,
  version: packageVersion,
  spec_key: z.string().max(512),
  deprecated: z.boolean().optional(),
  search_keywords: z.array(z.string()).optional(),
});

export function sagemakerOpenSpecs(body: string, rows: readonly SageMakerRow[]) {
  const headers = z.array(headerSchema).min(1).max(100_000).parse(JSON.parse(body));
  const groups = new Map<string, typeof headers>();
  for (const header of headers) {
    const group = groups.get(header.model_id) ?? [];
    group.push(header);
    groups.set(header.model_id, group);
  }
  const admitted = new Set(rows.filter((row) => !row.proprietary).map((row) => row.id));
  for (const id of admitted) {
    if (!groups.has(id)) throw new Error("SageMaker SDK manifest omitted an admitted model");
  }
  return [...groups.values()]
    .flatMap((versions) => {
      const semantic = versions.every((header) => valid(header.version) !== null);
      const latest = versions.reduce((a, b) =>
        (semantic ? compare(a.version, b.version) > 0 : a.version > b.version) ? a : b,
      );
      if (
        !admitted.has(latest.model_id) &&
        (latest.deprecated !== false || !latest.search_keywords?.includes("Foundation Models"))
      )
        return [];
      const paths = [
        `community_models/${latest.model_id}/specs_v${latest.version}.json`,
        `models/${latest.model_id}/specs_v${latest.version}.json`,
      ];
      if (!paths.includes(latest.spec_key))
        throw new Error("SageMaker SDK spec path changed identity");
      return [latest];
    })
    .sort((a, b) => a.model_id.localeCompare(b.model_id));
}

export function sagemakerModalities(values: string[] | undefined) {
  return [
    ...new Set(
      (values ?? []).flatMap((value) => {
        const normalized = value.toLowerCase();
        const parsed = modalitySchema.safeParse(
          normalized === "embeddings" ? "embedding" : normalized,
        );
        return parsed.success ? [parsed.data] : [];
      }),
    ),
  ];
}

const text = z.string().max(2048);
const settingsSchema = z.record(z.string(), z.unknown());
const componentSchema = z.object({
  default_inference_instance_type: text.nullish(),
  supported_inference_instance_types: z.array(text).max(512).optional(),
  hosting_ecr_specs: z
    .object({ framework: text.optional(), framework_version: text.optional() })
    .optional(),
  inference_environment_variables: z
    .array(z.object({ name: text, default: z.unknown().optional() }))
    .optional(),
  hosting_instance_type_variants: z
    .object({
      variants: z
        .record(
          z.string(),
          z.object({
            properties: z.object({ environment_variables: settingsSchema.optional() }).optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});
const specSchema = componentSchema.extend({
  model_id: modelIdSchema,
  version: packageVersion,
  provider: text.optional(),
  license: text.optional(),
  model_size: text.optional(),
  context_window: text.optional(),
  languages: z.array(text).max(512).optional(),
  huggingface_id: text.optional(),
  model_access: text.optional(),
  ml_framework: text.optional(),
  input_modalities: z.array(text).optional(),
  output_modalities: z.array(text).optional(),
  fine_tuning_supported: z.boolean().optional(),
  inference_configs: z.record(z.string(), z.object({ component_names: z.array(text) })).optional(),
  inference_config_components: z.record(z.string(), componentSchema).optional(),
});

// Keep only published context controls, never arbitrary environment values or resource paths.
const contextControls = new Set([
  "MAX_MODEL_LEN",
  "OPTION_MAX_MODEL_LEN",
  "SM_VLLM_MAX_MODEL_LEN",
  "MAX_INPUT_LENGTH",
  "MAX_TOTAL_TOKENS",
  "MAX_INPUT_TOKENS",
  "MAX_OUTPUT_TOKENS",
  "SM_MAX_INPUT_LENGTH",
  "SM_MAX_TOTAL_TOKENS",
]);
function contextSettings(values: Record<string, unknown>, instanceType?: string) {
  return Object.entries(values)
    .flatMap(([name, value]) => {
      if (
        !contextControls.has(name) ||
        !(
          (typeof value === "number" && Number.isFinite(value)) ||
          (typeof value === "string" && /^-?\d+$/.test(value))
        )
      )
        return [];
      return [
        { name, value, ...(instanceType === undefined ? {} : { instance_type: instanceType }) },
      ];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function profile(
  name: string,
  component: z.infer<typeof componentSchema>,
  configurations: string[],
) {
  const defaults = Object.fromEntries(
    (component.inference_environment_variables ?? []).map((item) => [item.name, item.default]),
  );
  return {
    name,
    configurations,
    instance_types: [...new Set(component.supported_inference_instance_types ?? [])].sort(),
    ...(component.default_inference_instance_type
      ? { default_instance_type: component.default_inference_instance_type }
      : {}),
    ...(component.hosting_ecr_specs?.framework
      ? { framework: component.hosting_ecr_specs.framework }
      : {}),
    ...(component.hosting_ecr_specs?.framework_version
      ? { framework_version: component.hosting_ecr_specs.framework_version }
      : {}),
    context_settings: [
      ...contextSettings(defaults),
      ...Object.entries(component.hosting_instance_type_variants?.variants ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .flatMap(([instance, variant]) =>
          contextSettings(variant.properties?.environment_variables ?? {}, instance),
        ),
    ],
  };
}

export const sagemakerSdkModelSchema = z.object({
  id: modelIdSchema,
  tasks: z.array(text),
  input: z.array(modalitySchema),
  output: z.array(modalitySchema),
  fine_tuning: z.boolean().optional(),
  model_card: modelCardSchema,
  deployment: deploymentSpecSchema,
});

export function projectSagemakerSpec(
  body: string,
  header: { model_id: string; version: string; search_keywords?: string[] | undefined },
) {
  const spec = specSchema.parse(JSON.parse(body));
  if (spec.model_id !== header.model_id || spec.version !== header.version)
    throw new Error("SageMaker metadata spec identity changed");
  const profiles = [profile("default", spec, [])];
  for (const [name, component] of Object.entries(spec.inference_config_components ?? {}).sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    const configurations = Object.entries(spec.inference_configs ?? {})
      .filter(([, config]) => config.component_names.includes(name))
      .map(([key]) => key)
      .sort();
    profiles.push(profile(name, component, configurations));
  }
  for (const config of Object.values(spec.inference_configs ?? {})) {
    if (
      config.component_names.some((name) => spec.inference_config_components?.[name] === undefined)
    )
      throw new Error("SageMaker inference configuration omitted a component");
  }
  return sagemakerSdkModelSchema.parse({
    id: spec.model_id,
    tasks: header.search_keywords ?? [],
    input: sagemakerModalities(spec.input_modalities),
    output: sagemakerModalities(spec.output_modalities),
    ...(spec.fine_tuning_supported === undefined
      ? {}
      : { fine_tuning: spec.fine_tuning_supported }),
    model_card: Object.fromEntries(
      [
        ["publisher", spec.provider],
        ["license", spec.license],
        ["size", spec.model_size],
        ["context_window", spec.context_window],
        ["languages", spec.languages],
        ["upstream_id", spec.huggingface_id],
        ["access", spec.model_access],
        ["framework", spec.ml_framework],
      ].filter(([, value]) => value !== undefined && value !== ""),
    ),
    deployment: {
      ...(/\barn:/i.test(spec.version) ? {} : { package_version: spec.version }),
      region: "us-west-2",
      profiles,
    },
  });
}

export function parseSagemakerSdk(input: {
  provider: Provider;
  source: SourceManifest;
  body: string;
  observedAt: string;
}) {
  const rows = z.array(sagemakerSdkModelSchema).min(1).max(3000).parse(JSON.parse(input.body));
  const seen = new Set<string>();
  return rows.map((row) => {
    if (seen.has(row.id)) throw new Error("SageMaker metadata repeated an identity");
    seen.add(row.id);
    const model = baseModel({
      providerId: input.provider.id,
      id: row.id,
      name: row.id,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    });
    model.model_card = row.model_card;
    model.deployment = row.deployment;
    model.modalities = { input: row.input, output: row.output };
    model.capabilities.fine_tuning = row.fine_tuning ?? "unknown";
    model.tasks = [...new Set(row.tasks.flatMap((task) => sagemakerTasks(row.id, task)))];
    model.task_evidence = row.tasks.flatMap((label) =>
      sagemakerTasks(row.id, label).map((task) => ({
        task,
        source_ref: input.source.id,
        namespace: "sagemaker.sdk.search_keywords",
        raw_value: label,
        kind: "provider_task" as const,
      })),
    );
    if (row.tasks.includes("Text") && row.tasks.includes("Generation")) {
      if (!model.tasks.includes("text_generation")) model.tasks.push("text_generation");
      model.task_evidence.push({
        task: "text_generation",
        source_ref: input.source.id,
        namespace: "sagemaker.sdk.search_keywords",
        raw_value: JSON.stringify(["Text", "Generation"]),
        kind: "provider_type",
      });
    }
    if (row.tasks.includes("Reasoning")) model.capabilities.reasoning = true;
    model.service_families = ["SageMaker JumpStart"];
    return model;
  });
}
