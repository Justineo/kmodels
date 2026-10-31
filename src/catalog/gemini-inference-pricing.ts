import { z } from "zod";
import type { LinkedBundle } from "./bundle.ts";
import type { ParsedProviderModel } from "./pricing-source.ts";
import { contractExtensionEvidence } from "./source-contract.ts";
import type { SourceParseInput, SourceParseResult } from "./source-parse.ts";

const discoveryUrl = "https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta";
const modelNameSchema = z.object({
  schemas: z.object({
    Model: z.object({
      properties: z.object({
        name: z.object({ type: z.literal("string"), description: z.string() }),
      }),
    }),
  }),
});

function resourceNames(input: SourceParseInput, bundle: LinkedBundle): boolean {
  const documents = bundle.documents.filter(({ url }) => url === discoveryUrl);
  if (documents.length === 0) return false;
  if (documents.length === 1 && documents[0] !== undefined) {
    try {
      const parsed = modelNameSchema.safeParse(JSON.parse(documents[0].body));
      if (
        parsed.success &&
        parsed.data.schemas.Model.properties.name.description.includes(
          "The resource name of the `Model`.",
        ) &&
        parsed.data.schemas.Model.properties.name.description.includes("Format: `models/{model}`")
      )
        return true;
    } catch {
      // The optional resource-name proof cannot invalidate literal price-table IDs.
    }
  }
  input.onContractFinding?.(contractExtensionEvidence(["/inference/Model/name/format"]));
  return false;
}

export function geminiInferencePrices(
  input: SourceParseInput,
  bundle: LinkedBundle,
  models: readonly ParsedProviderModel[],
  ids: ReadonlyMap<string, string>,
): NonNullable<SourceParseResult["inference_prices"]> {
  const resource = resourceNames(input, bundle);
  const byRef = new Map(models.map((model) => [model.uid, model]));
  return [...ids].flatMap(([id, ref]) => {
    const model = byRef.get(ref);
    if (model === undefined) return [];
    const mechanisms = new Set(
      [...model.price_facts, ...model.raw_price_facts].map(({ conditions }) =>
        conditions.service_tier === "batch" ? "batch" : "sync",
      ),
    );
    return [...mechanisms].flatMap((offer_key) =>
      [id, ...(resource ? [`models/${id}`] : [])].map((model_id) => ({
        model_id,
        model_ref: ref,
        offer_key,
        source_ref: input.source.id,
        fixed_selectors: [],
        evidence: [
          {
            source_ref: input.source.id,
            locator: { kind: "provider_key" as const, value: `${input.source.url} model ID ${id}` },
          },
          ...(model_id === id
            ? []
            : [
                {
                  source_ref: input.source.id,
                  locator: {
                    kind: "provider_key" as const,
                    value: `${discoveryUrl} schemas.Model.properties.name`,
                  },
                },
              ]),
        ],
      })),
    );
  });
}
