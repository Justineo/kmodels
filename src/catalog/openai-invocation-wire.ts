import { openApiYamlSchemaReader } from "./openapi-yaml.ts";
import type { ModelTask } from "./schema.ts";
import { yamlPath } from "./yaml.ts";

// Only direct requests with a model selector belong to these surfaces. Batch uploads,
// WebSocket events and resource creation require their own wire contracts.
export const openAiDirectOperations: readonly {
  path: string;
  name: string;
  operation: string;
  task: ModelTask;
  media?: readonly ("application/json" | "multipart/form-data")[];
}[] = [
  { path: "/responses", name: "Responses", operation: "createResponse", task: "text_generation" },
  {
    path: "/chat/completions",
    name: "Chat Completions",
    operation: "createChatCompletion",
    task: "text_generation",
  },
  {
    path: "/completions",
    name: "Completions (legacy)",
    operation: "createCompletion",
    task: "text_generation",
  },
  { path: "/embeddings", name: "Embeddings", operation: "createEmbedding", task: "embeddings" },
  { path: "/moderations", name: "Moderation", operation: "createModeration", task: "moderation" },
  {
    path: "/images/generations",
    name: "Image generation",
    operation: "createImage",
    task: "image_generation",
  },
  {
    path: "/audio/speech",
    name: "Speech generation",
    operation: "createSpeech",
    task: "speech_synthesis",
  },
  { path: "/decisions", name: "Decisions", operation: "createDecision", task: "classification" },
  {
    path: "/audio/transcriptions",
    name: "Transcription",
    operation: "createTranscription",
    task: "transcription",
    media: ["multipart/form-data"],
  },
  {
    path: "/audio/translations",
    name: "Translation",
    operation: "createTranslation",
    task: "translation",
    media: ["multipart/form-data"],
  },
  {
    path: "/images/edits",
    name: "Image edit",
    operation: "createImageEdit",
    task: "image_generation",
    media: ["application/json", "multipart/form-data"],
  },
  {
    path: "/videos",
    name: "Videos",
    operation: "createVideo",
    task: "video_generation",
    media: ["application/json", "multipart/form-data"],
  },
];

export interface OpenAiDirectWire {
  path: string;
  name: string;
  task: ModelTask;
  requestSchema: string;
  media: "application/json" | "multipart/form-data";
  deprecated?: true;
}

/** Recognize owned request paths rather than borrowing a response's model field. */
export function openAiDirectWires(body: string): OpenAiDirectWire[] {
  if (
    yamlPath(body, ["servers"])?.trim() !== "servers:\n  - url: https://api.openai.com/v1" ||
    yamlPath(body, ["security"])?.trim() !== "security:\n  - ApiKeyAuth: []" ||
    yamlPath(body, ["components", "securitySchemes", "ApiKeyAuth"])?.trim() !==
      "ApiKeyAuth:\n      type: http\n      scheme: bearer"
  )
    return [];
  const read = openApiYamlSchemaReader(body);
  return openAiDirectOperations.flatMap(
    ({ path, name, operation, task, media = ["application/json"] }) => {
      const route = yamlPath(body, ["paths", path]);
      const post = yamlPath(body, ["paths", path, "post"]);
      const lifecycle =
        post?.split(/\r?\n/).filter((line) => /^      ["']?deprecated["']?:/.test(line)) ?? [];
      if (
        route === undefined ||
        post === undefined ||
        lifecycle.length > 1 ||
        lifecycle.some((line) => !/^      deprecated: (?:true|false)$/.test(line)) ||
        // An override, including duplicate or quoted keys, cannot inherit the global contract.
        hasWireOverride(route, 4) ||
        hasWireOverride(post, 6) ||
        post
          .split(/\r?\n/)
          .filter((line) => line.startsWith("      operationId:"))
          .join("\n") !== `      operationId: ${operation}`
      )
        return [];
      return media.flatMap((media) => {
        const schema = yamlPath(body, [
          "paths",
          path,
          "post",
          "requestBody",
          "content",
          media,
          "schema",
        ]);
        const requestSchema = schema
          ?.trim()
          .match(
            /^schema:\n              \$ref: ["']#\/components\/schemas\/([A-Za-z0-9_-]+)["']$/,
          )?.[1];
        if (requestSchema === undefined) return [];
        const types = read(requestSchema, ["model"]);
        if (types.length !== 1 || types[0] !== "string") return [];
        return [
          {
            path: `/v1${path}`,
            name,
            task,
            requestSchema,
            media,
            ...(lifecycle[0] === "      deprecated: true" ? { deprecated: true as const } : {}),
          },
        ];
      });
    },
  );
}

function hasWireOverride(block: string, indent: number): boolean {
  const prefix = " ".repeat(indent);
  const entries = block
    .split(/\r?\n/)
    .filter((line) =>
      new RegExp(`^${prefix}["']?(?:servers|security|parameters)["']?:`).test(line),
    );
  // An explicitly empty parameter list has no effect on the inherited addressing contract.
  return entries.length > 1 || entries.some((line) => line !== `${prefix}parameters: []`);
}
