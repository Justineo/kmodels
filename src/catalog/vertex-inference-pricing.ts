import { load } from "cheerio";
import type { LinkedBundle } from "./bundle.ts";
import { contractExtensionEvidence } from "./source-contract.ts";
import type { ParsedProviderModel } from "./pricing-source.ts";
import type { SourceParseInput, SourceParseResult } from "./source-parse.ts";

export const vertexClaudeIdSource =
  "https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/google-managed";
export const vertexClaudeBatchSource =
  "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude/batch";

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
  const claudeModels = models.filter((model) =>
    model.service_families?.includes("publishers/anthropic"),
  );
  for (const model of models)
    if (!claudeModels.includes(model))
      add(model, model.model_id, input.source.url, ["sync", "batch"]);

  const claudeDocs = bundle.documents.filter(({ url }) => url === vertexClaudeIdSource);
  if (claudeDocs.length === 1 && claudeDocs[0] !== undefined) {
    const $ = load(claudeDocs[0].body);
    const table = $("table").filter((_index, element) => {
      const headers = $(element)
        .find("thead th")
        .map((_index, header) => $(header).text().trim())
        .get();
      return (
        headers.length === 2 &&
        headers[0] === "Model" &&
        headers[1] === "Agent Platform API model ID"
      );
    });
    const ids = table
      .find("tbody tr")
      .map((_index, row) => $(row).children("td").eq(1).text().trim())
      .get();
    if (
      table.length === 1 &&
      ids.length > 0 &&
      new Set(ids).size === ids.length &&
      ids.every((id) => /^claude-[a-z0-9-]+(?:@[0-9]{8})?$/.test(id))
    ) {
      for (const id of ids) {
        // The official table owns the literal request spelling. Its base component joins
        // to an existing Google-managed Claude record and never creates a catalog row.
        const [base, date] = id.split("@");
        const [model, duplicate] = claudeModels.filter(
          ({ model_id, version }) =>
            model_id === base && (version === undefined || version === date),
        );
        if (model !== undefined && duplicate === undefined)
          add(model, id, vertexClaudeIdSource, ["sync"]);
      }
    } else input.onContractFinding?.(contractExtensionEvidence(["/claude/api-model-ids"]));
  } else if (claudeDocs.length > 1) {
    input.onContractFinding?.(contractExtensionEvidence(["/claude/api-model-ids"]));
  }

  for (const document of bundle.documents) {
    if (document.url === vertexClaudeIdSource) continue;
    const $ = load(document.body);
    if (document.url === vertexClaudeBatchSource) {
      const article = $(".devsite-article-body");
      const supported = article.find("h2#models").nextUntil("h2, h3").filter("ul");
      const template = article
        .find("pre")
        .toArray()
        .some((element) =>
          /"model"\s*:\s*"publishers\/anthropic\/models\/MODEL"/.test($(element).text()),
        );
      if (supported.length === 1 && template) {
        for (const model of claudeModels) {
          const card =
            "https://console.cloud.google.com/agent-platform/publishers/anthropic/model-garden/" +
            model.model_id;
          if (
            supported
              .find("a")
              .toArray()
              .some((link) => $(link).attr("href") === card)
          )
            add(model, "publishers/anthropic/models/" + model.model_id, document.url, ["batch"]);
        }
      } else input.onContractFinding?.(contractExtensionEvidence(["/claude/batch-model-ids"]));
      continue;
    }
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
