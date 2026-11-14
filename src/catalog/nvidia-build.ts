import { z } from "zod";
import { parseSourceJson, assertSourceConstraint } from "./source-contract.ts";

export const nvidiaEndpointBase = "https://api.ngc.nvidia.com/v2/endpoints/qc69jvmznzxy/";
export function nvidiaBuildUrl(page = 0): URL {
  const url = new URL("https://api.ngc.nvidia.com/v2/search/catalog/resources/ENDPOINT");
  url.searchParams.set(
    "q",
    JSON.stringify({
      query: 'orgName:"qc69jvmznzxy"',
      page,
      pageSize: 100,
      scoredSize: 100,
      groupBy: "resourceType",
      filters: [
        { field: "resourceType", value: "endpoint" },
        { field: "label", value: "-blueprint" },
      ],
      orderBy: [
        { field: "dateCreated", value: "DESC" },
        { field: "resourceId", value: "ASC" },
      ],
    }),
  );
  url.searchParams.set("group-labels-by-labelset", "true");
  return url;
}
const label = z.object({
  key: z.string(),
  values: z.array(z.string()),
  unresolvedValues: z.array(z.string()),
});
const pageSchema = z.object({
  params: z.object({ page: z.number().int().min(0), pageSize: z.literal(100) }),
  resultPageTotal: z.number().int().min(1).max(10),
  resultTotal: z.number().int().min(1).max(1000),
  results: z
    .array(z.object({ groupValue: z.string(), resources: z.array(z.unknown()).max(100) }))
    .max(4),
});
const endpointSchema = z.object({
  resourceType: z.literal("ENDPOINT"),
  resourceId: z.string().regex(/^qc69jvmznzxy\/[a-z0-9._-]+$/u),
  name: z.string().regex(/^[a-z0-9._-]+$/u),
  labels: z.array(label).optional(),
});

export function nvidiaBuildPage(body: string, page: number) {
  const value = pageSchema.parse(parseSourceJson(body, "NVIDIA Build catalog API"));
  const groups = value.results.filter(({ groupValue }) => groupValue === "ENDPOINT");
  assertSourceConstraint(
    "NVIDIA Build changed its pagination or endpoint group",
    value.params.page === page &&
      value.resultPageTotal === Math.ceil(value.resultTotal / 100) &&
      groups.length === 1,
    page,
  );
  const resources = groups[0]?.resources.map((row) => endpointSchema.parse(row));
  assertSourceConstraint(
    "NVIDIA Build omitted endpoint resources",
    resources !== undefined && resources.length === Math.min(100, value.resultTotal - page * 100),
    page,
  );
  const slugs = resources.flatMap((resource) => {
    assertSourceConstraint(
      "NVIDIA Build resource identity disagreed",
      resource.resourceId === `qc69jvmznzxy/${resource.name}`,
      resource.name,
    );
    const publishers =
      resource.labels?.filter(({ key }) => key === "publisher").flatMap(({ values }) => values) ??
      [];
    const preview = resource.labels?.some(
      ({ key, unresolvedValues }) =>
        key === "nimType" && unresolvedValues.includes("nim_type_preview"),
    );
    if (!preview) return [];
    assertSourceConstraint(
      "NVIDIA Build hosted endpoint lost its publisher",
      publishers.length === 1 && /^[a-z0-9._-]+$/u.test(publishers[0] ?? ""),
      resource.name,
    );
    return [`${publishers[0]}/${resource.name}`];
  });
  return {
    slugs,
    names: resources.map(({ name }) => name),
    total: value.resultTotal,
    pages: value.resultPageTotal,
  };
}

export const nvidiaEndpointMetadataSchema = z.object({
  artifact: z.object({
    artifactType: z.literal("ENDPOINT"),
    orgName: z.literal("qc69jvmznzxy"),
    name: z.string(),
    publisher: z.string(),
    isPublic: z.boolean(),
    displayName: z.string(),
    shortDescription: z.string(),
    updatedDate: z.iso.datetime({ offset: true }),
    labels: z.array(z.string()),
    attributes: z.array(z.object({ key: z.string(), value: z.string() })),
  }),
});
export const nvidiaEndpointSpecSchema = z.object({
  artifactName: z.string(),
  artifactType: z.literal("ENDPOINT"),
  namespace: z.literal("qc69jvmznzxy"),
  attributes: z.string(),
  openAPISpec: z.string().nullish(),
  nvcfFunctionId: z.string().nullish(),
  nvcfInferencePath: z.string().nullish(),
});
