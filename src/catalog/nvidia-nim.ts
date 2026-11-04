import { z } from "zod";
import { modelIdSchema } from "./identity.ts";
import { baseModel } from "./model.ts";
import { parseSourceJson, assertSourceConstraint } from "./source-contract.ts";
import type { SourceParseInput } from "./source-parse.ts";

const modelsSchema = z.object({
  object: z.literal("list"),
  data: z
    .array(z.object({ object: z.literal("model"), id: modelIdSchema }))
    .min(1)
    .max(2_000),
});

export function parseNvidiaNimModels(input: SourceParseInput) {
  const { data } = modelsSchema.parse(parseSourceJson(input.body, "NVIDIA hosted model list"));
  assertSourceConstraint(
    "NVIDIA hosted model list repeated a model ID",
    new Set(data.map(({ id }) => id)).size === data.length,
    data,
  );
  return data.map(({ id }) =>
    baseModel({
      providerId: input.provider.id,
      id,
      name: id,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
  );
}
