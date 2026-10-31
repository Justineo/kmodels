import { modelIdSchema } from "./identity.ts";

export type BedrockEndpoint = "bedrock-runtime" | "bedrock-mantle";

export function bedrockPublicIds(cell: string): string[] {
  if (/\barn:|https?:\/\//i.test(cell)) return [];
  return [...new Set(cell.match(/\b[a-z][a-z0-9-]*\.[a-z0-9][a-z0-9.:-]*/g) ?? [])].filter(
    (value) => modelIdSchema.safeParse(value).success,
  );
}

export function bedrockCardIdentity(
  url: string | undefined,
  endpoint: BedrockEndpoint,
  modelId: string | undefined,
  profiles: readonly string[],
): { modelId: string; idKind: "api_id" | "source_generated" } | undefined {
  if (modelId !== undefined && bedrockPublicIds(modelId)[0] === modelId)
    return { modelId, idKind: "api_id" };
  if (modelId !== "N/A" || profiles.length === 0 || url === undefined) return;
  const slug = url.match(
    /^https:\/\/docs\.aws\.amazon\.com\/bedrock\/latest\/userguide\/(model-card-[a-z0-9-]+)\.md$/,
  )?.[1];
  if (slug === undefined) return;
  return { modelId: `${slug}/${endpoint}`, idKind: "source_generated" };
}
