import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { parseSource } from "../src/catalog/adapters.ts";
import { sha256, stableJson } from "../src/catalog/io.ts";
import { manifests, type SourceManifest } from "../src/catalog/manifests.ts";
import { sourcePriceFactSchema, parsedPricingStateSchema } from "../src/catalog/pricing-source.ts";
import { isPricingDependencySource } from "../src/catalog/pricing-adapter.ts";
import { providerModelSchema } from "../src/catalog/schema.ts";
import { createContractFindingCollector } from "../src/catalog/source-contract.ts";
import {
  sourcePricingReconciliation,
  type PricingReconciliationItem,
} from "../src/catalog/pricing-reconciliation.ts";

const evidenceSchema = z.object({
  source_id: z.string(),
  scope: z.literal("source"),
  source_url: z.url(),
  observed_at: z.iso.datetime({ offset: true }),
  source_hash: z.string().regex(/^[a-f0-9]{64}$/),
  body: z.string(),
});
const contextSchema = z.array(
  providerModelSchema
    .extend({
      pricing_state: parsedPricingStateSchema.optional(),
      price_facts: z.array(sourcePriceFactSchema).optional(),
    })
    .transform(({ price_facts, pricing_state, ...model }) => ({
      ...model,
      ...(price_facts === undefined ? {} : { price_facts }),
      ...(pricing_state === undefined ? {} : { pricing_state }),
    })),
);

export function replayCatalogEvidence(sourceId: string, input: unknown, context?: unknown) {
  const evidence = evidenceSchema.parse(input);
  if (evidence.source_id !== sourceId || sha256(evidence.body) !== evidence.source_hash)
    throw new Error("Replay source identity or body hash does not match its evidence");
  const manifest = manifests.find(({ sources }) => sources.some(({ id }) => id === sourceId));
  const source: SourceManifest | undefined = manifest?.sources.find(({ id }) => id === sourceId);
  if (manifest === undefined || source === undefined || source.access !== "public" || source.auth)
    throw new Error("Replay requires an exact reviewed public source ID");
  if (evidence.source_url !== source.url)
    throw new Error("Replay full-source URL does not match its reviewed source");
  const catalogModels = context === undefined ? undefined : contextSchema.parse(context);
  if (catalogModels?.some(({ provider_id }) => provider_id !== manifest.provider.id))
    throw new Error("Replay catalog context has another provider's models");
  const findings = createContractFindingCollector();
  const reconciliation: PricingReconciliationItem[] = [];
  const result = parseSource({
    provider: { ...manifest.provider, source_ids: manifest.sources.map(({ id }) => id) },
    source,
    body: evidence.body,
    observedAt: evidence.observed_at,
    ...(catalogModels === undefined ? {} : { catalogModels }),
    onContractFinding: findings.add,
    onPricingReconciliation: (item) => reconciliation.push(item),
  });
  return {
    schema_version: 1,
    stage: "parse",
    source_id: sourceId,
    source_url: evidence.source_url,
    source_hash: evidence.source_hash,
    extractor_version: source.extractorVersion,
    observed_at: evidence.observed_at,
    context:
      catalogModels === undefined
        ? null
        : {
            model_count: catalogModels.length,
            sha256: sha256(stableJson(catalogModels)),
          },
    models: result.models.map(
      ({ uid, release_date, updated_date, price_facts, raw_price_facts }) => ({
        uid,
        release_date,
        updated_date,
        prices: price_facts.length,
        raw_prices: raw_price_facts.length,
      }),
    ),
    pricing_inputs: result.pricing_inputs?.length ?? 0,
    commercial_facts: result.commercial_facts?.length ?? 0,
    ...findings.summary(),
    reconciliation: isPricingDependencySource(source)
      ? sourcePricingReconciliation(result.models, reconciliation, true)
      : null,
  };
}

async function readBoundedJson(path: string): Promise<unknown> {
  if ((await stat(path)).size > 128 * 1024 * 1024) throw new Error("Replay file exceeds 128 MiB");
  return JSON.parse(await readFile(path, "utf8"));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [sourceId, path, context, extra] = process.argv.slice(2);
  if (sourceId === undefined || path === undefined || extra !== undefined)
    throw new Error("Expected SOURCE_ID EVIDENCE_JSON [PARSED_CATALOG_MODELS_JSON]");
  // Let parse failures terminate with a nonzero status; a printed error is not a successful replay.
  const summary = replayCatalogEvidence(
    sourceId,
    await readBoundedJson(path),
    context === undefined ? undefined : await readBoundedJson(context),
  );
  console.log(JSON.stringify(summary, null, 2));
}
