import { bedrockCardIdentity, bedrockGeoProfiles, bedrockPublicIds } from "./bedrock-model-ids.ts";
import {
  bedrockAvailabilityBlocks,
  bedrockAvailabilitySupported,
  bedrockAvailabilityTable,
  bedrockProgrammaticSection,
  bedrockRegionalSection,
  markdownTable,
} from "./bedrock-markdown.ts";
import { markdownProse, markdownSection } from "./markdown.ts";
import { uniqueCanonicalValues } from "./canonical-value.ts";
import { contractExtensionEvidence } from "./source-contract.ts";
import type { SourceParseInput } from "./source-parse.ts";
import type { ParsedProviderModel, SourcePricingFacts } from "./pricing-source.ts";
import type { ProviderAtomRegistryEntry } from "./pricing-schema.ts";

interface Document {
  url: string;
  body: string;
}
type Rule = NonNullable<SourcePricingFacts["inference_prices"]>[number];
type Fixed = Partial<Record<"endpoint" | "deployment_scope" | "inference_geo" | "region", string>>;
const root = "https://docs.aws.amazon.com/bedrock/latest/";

function prose(body: string): string {
  return markdownProse(body.replaceAll("\r\n", "\n"))
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n");
}

function hasInRegionId(regional: string, endpoint: string): boolean {
  const blocks = bedrockAvailabilityBlocks(regional).filter(
    (block) => block.endpoint === undefined || block.endpoint === endpoint,
  );
  const block = blocks.length === 1 ? blocks[0] : undefined;
  const table = block === undefined ? undefined : bedrockAvailabilityTable(block.body);
  return (
    table?.rows.some((row) => bedrockAvailabilitySupported(row[table.inRegion] ?? "")) ?? false
  );
}

/** Price associations use the card's literal IDs, independently of request protocols and capabilities. */
export function bedrockInferencePrices(
  input: Pick<SourceParseInput, "source" | "onContractFinding">,
  models: readonly ParsedProviderModel[],
  documents: readonly Document[],
): { inference_prices: Rule[]; vocabulary: ProviderAtomRegistryEntry[] } {
  const rules: Rule[] = [];
  const vocabulary: ProviderAtomRegistryEntry[] = [];
  const byUrl = new Map<string, Document | null>();
  for (const doc of documents) byUrl.set(doc.url, byUrl.has(doc.url) ? null : doc);
  const modelsById = new Map(models.map((model) => [model.model_id, model]));
  const report = (path: string) => input.onContractFinding?.(contractExtensionEvidence([path]));
  const crossRegion = byUrl.get(`${root}userguide/cross-region-inference.md`);
  const sourceRegionBilling = prose(crossRegion?.body ?? "").includes(
    "The price is calculated based on the Region from which you call an inference profile.",
  );
  function add(model: ParsedProviderModel, model_id: string, fixed: Fixed, docs: Document[]) {
    const conditions = [
      ...model.price_facts,
      ...model.raw_price_facts,
      ...(model.state_facts ?? []),
    ]
      .filter(({ conditions }) => conditions.service_tier !== "batch")
      .map(({ conditions }) => conditions);
    // An unidentified profile geography must never become a caller-selected tariff.
    if (
      fixed.deployment_scope === "geo_cross_region" &&
      fixed.inference_geo === undefined &&
      conditions.some((condition) => condition.inference_geo !== undefined)
    ) {
      report(`/inference-pricing/profile-geography/${model_id}`);
      return;
    }
    if (
      fixed.deployment_scope !== "in_region" &&
      fixed.region === undefined &&
      conditions.some((condition) => condition.region !== undefined) &&
      !sourceRegionBilling
    ) {
      report(`/inference-pricing/source-region-billing/${model_id}`);
      return;
    }
    const fixed_selectors: Rule["fixed_selectors"] = [];
    for (const key of ["endpoint", "deployment_scope", "inference_geo", "region"] as const) {
      const value = fixed[key];
      if (value === undefined || !conditions.some((condition) => condition[key] !== undefined))
        continue;
      const dimension = { namespace: "kmodels" as const, value: key };
      fixed_selectors.push({
        kind: "categorical",
        dimension,
        value: { namespace: "provider", provider_id: "amazon-bedrock", value },
      });
      vocabulary.push({
        kind: "categorical_value",
        key: value,
        dimension,
        definition: `Provider-published ${key} value ${JSON.stringify(value)}`,
      });
    }
    rules.push({
      model_id,
      model_ref: model.uid,
      source_ref: input.source.id,
      offer_key: "on-demand",
      fixed_selectors,
      evidence: docs.map(({ url }) => ({
        source_ref: input.source.id,
        locator: { kind: "fragment", value: `${url}#inference-price-id: ${model_id}` },
      })),
    });
  }
  for (const [url, doc] of byUrl) {
    if (
      !/^https:\/\/docs\.aws\.amazon\.com\/bedrock\/latest\/userguide\/model-card-[a-z0-9-]+\.md$/.test(
        url,
      )
    )
      continue;
    if (doc === null) {
      report(`/inference-pricing/duplicate-card/${url}`);
      continue;
    }
    const body = prose(doc.body);
    const access = bedrockProgrammaticSection(body);
    if (
      access === undefined ||
      !/(?:To call this model from code, use the following model IDs and endpoint URLs\.|Use the following model IDs? and endpoint URLs? to access this model programmatically\.|Use these model IDs and endpoint URLs to call the model\.)/.test(
        access,
      )
    ) {
      report(`/inference-pricing/request-id-meaning/${doc.url}`);
      continue;
    }
    try {
      const table = markdownTable(access, ["Endpoint", "Model ID", "In-Region endpoint URL"]);
      if (table === undefined || new Set(table.header).size !== table.header.length)
        throw new Error("Ambiguous ID table");
      const seen = new Set<string>();
      const pending: Array<{ model: ParsedProviderModel; id: string; fixed: Fixed }> = [];
      const regional = bedrockRegionalSection(body) ?? "";
      const profilesById = bedrockGeoProfiles(regional);
      for (const row of table.rows) {
        const cell = (header: string) => row[table.header.indexOf(header)] ?? "";
        const endpoint = cell("Endpoint");
        if (endpoint !== "bedrock-runtime" && endpoint !== "bedrock-mantle") continue;
        const profiles = ["Geo inference ID", "Global inference ID"].flatMap((key) =>
          bedrockPublicIds(cell(key)),
        );
        const identity = bedrockCardIdentity(doc.url, endpoint, cell("Model ID"), profiles);
        if (identity === undefined) continue;
        const key = `${endpoint}:${identity.modelId}`;
        if (seen.has(key)) throw new Error("Duplicate ID row");
        seen.add(key);
        const model = modelsById.get(identity.modelId);
        if (model === undefined) continue;
        if (
          identity.idKind === "api_id" &&
          cell("In-Region endpoint URL").startsWith("https://") &&
          hasInRegionId(regional, endpoint)
        )
          pending.push({
            model,
            id: identity.modelId,
            fixed: { endpoint, deployment_scope: "in_region" },
          });
        for (const [column, deployment_scope] of [
          ["Geo inference ID", "geo_cross_region"],
          ["Global inference ID", "global_cross_region"],
        ] as const) {
          for (const id of bedrockPublicIds(cell(column))) {
            const geography =
              deployment_scope === "global_cross_region"
                ? "global"
                : profilesById.get(id)?.geography;
            pending.push({
              model,
              id,
              fixed: {
                endpoint,
                deployment_scope,
                ...(geography === undefined ? {} : { inference_geo: geography }),
              },
            });
          }
        }
      }
      for (const { model, id, fixed } of pending)
        add(model, id, fixed, [
          doc,
          ...(fixed.deployment_scope !== "in_region" && sourceRegionBilling && crossRegion
            ? [crossRegion]
            : []),
        ]);
    } catch {
      report(`/inference-pricing/id-table/${doc.url}`);
    }
  }
  const field = byUrl.get(
    `${root}APIReference/API_agent-runtime_BedrockRerankingModelConfiguration.md`,
  );
  const use = byUrl.get(`${root}userguide/rerank-use.md`);
  if (field && use) {
    const contents = prose(markdownSection(field.body, 2, "Contents") ?? "");
    const definition = contents.match(/\*\*\s*modelArn\s*\*\*([\s\S]*?)(?=\n\s*\*\*|$)/)?.[1];
    const example = markdownSection(use.body, 4, "[ Node.js ]") ?? "";
    const ids = [
      ...example.matchAll(
        /modelArn: "(arn:aws:bedrock:([a-z0-9-]+)::foundation-model\/([^"/]+))"/g,
      ),
    ];
    const id = ids.length === 1 ? ids[0] : undefined;
    const model = models.find(
      ({ model_id, tasks }) => model_id === id?.[3] && tasks.includes("reranking"),
    );
    if (
      definition?.includes("The ARN of the reranker model.") &&
      definition.includes("Required: Yes") &&
      /rerankingConfiguration: \{\s*type: "BEDROCK_RERANKING_MODEL"/.test(example) &&
      model &&
      id?.[1] &&
      id[2]
    )
      add(
        model,
        id[1],
        { endpoint: "bedrock-agent-runtime", deployment_scope: "in_region", region: id[2] },
        [field, use],
      );
    else report("/inference-pricing/rerank-model-arn");
  }
  return {
    inference_prices: uniqueCanonicalValues(rules),
    vocabulary: uniqueCanonicalValues(vocabulary),
  };
}
