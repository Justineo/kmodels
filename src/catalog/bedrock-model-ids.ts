import { modelIdSchema } from "./identity.ts";

export type BedrockEndpoint = "bedrock-runtime" | "bedrock-mantle";

const profileGeographies = new Map([
  ["US", "us"],
  ["EU", "eu"],
  ["APAC", "apac"],
  ["India", "in"],
  ["IN", "in"],
  ["CA", "ca"],
  ["Japan", "jp"],
  ["JP", "jp"],
  ["Australia", "au"],
  ["AU", "au"],
]);
const geographyCodes = new Set(profileGeographies.values());

export function bedrockProfileGeography(label: string): string | undefined {
  return profileGeographies.get(label);
}

export function bedrockAliasGeographies(aliases: ReadonlySet<string>): Set<string> {
  const result = new Set<string>();
  for (const alias of aliases) {
    const [prefix] = alias.split(".", 1);
    if (prefix !== undefined && geographyCodes.has(prefix)) result.add(prefix);
  }
  return result;
}

export function bedrockGeoProfiles(regional: string) {
  const headings = [...regional.matchAll(/^\*\*Geo: ([^*\n]+)\*\*$/gm)];
  const profiles = new Map<string, { geography: string; body: string } | undefined>();
  for (const [index, heading] of headings.entries()) {
    const body = regional.slice(heading.index + heading[0].length, headings[index + 1]?.index);
    const ids = [...body.matchAll(/^Geo [Ii]nference ID: `([^`]+)`\s*$/gm)];
    const id = ids.length === 1 ? ids[0]?.[1] : undefined;
    const geography = bedrockProfileGeography(heading[1] ?? "");
    if (id !== undefined)
      profiles.set(
        id,
        profiles.has(id) || geography === undefined ? undefined : { geography, body },
      );
  }
  return profiles;
}

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
