import { load } from "cheerio";
import type { LinkedBundle } from "./bundle.ts";
import type { ParsedProviderModel } from "./pricing-source.ts";
import type { SourceParseInput, SourceParseResult } from "./source-parse.ts";

export function vertexInferencePrices(
  input: SourceParseInput,
  bundle: LinkedBundle,
  models: readonly ParsedProviderModel[],
): NonNullable<SourceParseResult["inference_prices"]> {
  const rules: NonNullable<SourceParseResult["inference_prices"]> = [];
  const byId = new Map(models.map((model) => [model.model_id, model]));
  const add = (model: ParsedProviderModel, modelId: string, url: string, offers: string[]) => {
    for (const offer_key of offers)
      rules.push({
        model_id: modelId,
        model_ref: model.uid,
        source_ref: input.source.id,
        offer_key,
        fixed_selectors: [],
        evidence: [
          {
            source_ref: input.source.id,
            locator: { kind: "provider_key", value: `${url} model ID ${modelId}` },
          },
        ],
      });
  };
  // Catalog identities come from labeled Model ID fields and exact Model Garden links.
  for (const model of models) add(model, model.model_id, input.source.url, ["sync", "batch"]);

  for (const document of bundle.documents) {
    const $ = load(document.body);
    $(".devsite-article-body pre").each((_index, element) => {
      const code = $(element).text();
      // Request examples establish spellings; returned model names do not establish aliases.
      if (
        !/\bmessages\s*[:=]|["']messages["']\s*:|["']input["']\s*:|\.responses\.create\(/.test(code)
      )
        return;
      for (const match of code.matchAll(
        /\bmodel["']?\s*(?::|=)\s*["']([a-z0-9-]+)\/([a-z0-9._@-]+|MODEL|MODEL_ID)["']/g,
      )) {
        const publisher = match[1];
        const id = match[2];
        if (publisher === undefined || id === undefined) continue;
        if (id === "MODEL" || id === "MODEL_ID") {
          for (const model of models)
            if (model.service_families?.includes(`publishers/${publisher}`))
              add(model, `${publisher}/${model.model_id}`, document.url, ["sync"]);
        } else {
          const model = byId.get(id);
          if (model !== undefined) add(model, `${publisher}/${id}`, document.url, ["sync"]);
        }
      }
    });
  }
  return rules;
}
