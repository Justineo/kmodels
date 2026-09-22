import { load } from "cheerio";
import { linkedBundleSchema, linkedDocumentBody, type LinkedBundle } from "./bundle.ts";
import { modelIdSchema } from "./identity.ts";
import type { SourceManifest } from "./manifests.ts";
import { baseModel } from "./model.ts";
import { decimalsEqual, multiplyDecimal } from "./pricing.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type { ParsedProviderModel, SourcePricingInputFact } from "./pricing-source.ts";
import type { Provider } from "./schema.ts";
import {
  assertItemCount,
  contractExtensionEvidence,
  type SourceContractEvidence,
} from "./source-contract.ts";

interface Input {
  provider: Provider;
  source: SourceManifest;
  body: string;
  observedAt: string;
  onContractFinding?: (finding: SourceContractEvidence) => void;
  onPricingReconciliation?: (item: PricingReconciliationItem) => void;
}

interface Table {
  header: string[];
  rows: string[][];
}

function section(body: string, title: string): string {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${title}`);
  if (start < 0) throw new Error(`TypeSafe ${title} section is missing`);
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function tables(body: string): Table[] {
  const lines = body.split(/\r?\n/);
  const result: Table[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.trim().startsWith("|")) continue;
    const header = cells(line);
    const separator = cells(lines[++index] ?? "");
    if (header.length !== separator.length || !separator.every((cell) => /^:?-{3,}:?$/.test(cell)))
      throw new Error("TypeSafe table header changed");
    const rows: string[][] = [];
    while ((lines[index + 1] ?? "").trim().startsWith("|")) {
      const row = cells(lines[++index] ?? "");
      if (row.length !== header.length) throw new Error("TypeSafe table row changed");
      rows.push(row);
    }
    result.push({ header, rows });
  }
  return result;
}

function codeId(value: string | undefined): string {
  const id = value?.match(/^`([^`]+)`$/)?.[1];
  return modelIdSchema.parse(id);
}

function signal(input: Input, path: string): void {
  input.onContractFinding?.(contractExtensionEvidence([path]));
}

function reviewIndex(bundle: LinkedBundle): void {
  const body = linkedDocumentBody(bundle, "/llms.txt", "TypeSafe documentation index is missing");
  const paths = new Set(
    [...body.matchAll(/\]\((https:\/\/docs\.typesafe\.ai\/[^)]+)\)/g)].map(
      (match) => new URL(match[1] ?? "").pathname,
    ),
  );
  if (!paths.has("/models.md") || !paths.has("/api.md"))
    throw new Error("TypeSafe index omitted catalog or API documentation");
  for (const path of paths) {
    // SDK usage pages describe client mechanics; they are not commercial surfaces.
    if (path.startsWith("/sdk/") || path.startsWith("/cookbooks/")) continue;
    if (/(?:pricing|billing|cost|usage|account|credits|plans|batch|caching)/i.test(path))
      throw new Error("TypeSafe index contains an unreviewed commercial document");
  }
}

function accounting(input: Input, body: string | undefined): SourcePricingInputFact[] {
  if (body === undefined) return [];
  if (!/^## Response body\s*$/m.test(body)) {
    signal(input, "/api/response-body");
    return [];
  }
  const $ = load(section(body, "Response body"));
  const usage = $('responsefield[name="usage"][type="object"]');
  return (["input_tokens", "output_tokens"] as const).flatMap((key) => {
    if (
      usage.length !== 1 ||
      usage.find(`responsefield[name="${key}"][type="integer"]`).length !== 1
    ) {
      signal(input, `/api/usage/${key}`);
      return [];
    }
    return [
      {
        key: `systemone.${key}`,
        channel: "response" as const,
        locator: { kind: "json_pointer" as const, value: `/usage/${key}` },
        availability: "conditional" as const,
        source_ref: input.source.id,
      },
    ];
  });
}

export function parseTypesafeCatalog(input: Input): ParsedProviderModel[] {
  if (input.source.extractor.kind !== "typesafe-catalog")
    throw new Error("Wrong TypeSafe extractor");
  const bundle = linkedBundleSchema.parse(JSON.parse(input.body));
  reviewIndex(bundle);
  const body = bundle.index.body.replace(/\\\$/g, "$");
  const current = section(body, "Current models");
  if (!/Every model on this page is served by the same endpoint, `POST \/v1\/systemone`/.test(body))
    throw new Error("TypeSafe model endpoint contract changed");
  if (!/Charged per input token\. Output tokens are free\./.test(current))
    throw new Error("TypeSafe token billing contract changed");
  const api = bundle.documents.find(({ url }) => url === "https://docs.typesafe.ai/api.md")?.body;
  const pricingInputs = accounting(input, api);
  const typed =
    api !== undefined &&
    /Picks one option from a set you define\./.test(api) &&
    ["noul", "choice", "score"].every((type) => api.includes(`type="&#x22;${type}&#x22;"`));
  if (!typed) signal(input, "/api/question-types");
  const byId = new Map<string, ParsedProviderModel>();
  for (const { header, rows } of tables(current)) {
    if (header.length !== 2 || !header[0]) throw new Error("TypeSafe model table changed");
    const id = codeId(header[1]);
    if (byId.has(id)) throw new Error("Duplicate TypeSafe model ID");
    const fields = new Map<string, string>();
    for (const [key, value] of rows) {
      if (!key || !value || fields.has(key)) throw new Error("TypeSafe model field changed");
      fields.set(key, value);
      if (
        !["Price (per Btok / per Mtok)", "Rate limits", "Context length", "Input"].includes(key)
      ) {
        if (/price|cost|billing|discount|cache/i.test(key))
          throw new Error("Unreviewed TypeSafe price field");
        signal(input, "/models/fields/extension");
      }
    }
    const rawPrice = fields.get("Price (per Btok / per Mtok)");
    const prices = rawPrice?.match(/^\$(\d+(?:\.\d+)?)\s*\/\s*\$(\d+(?:\.\d+)?)$/);
    const billion = prices?.[1];
    const million = prices?.[2];
    if (
      million === undefined ||
      billion === undefined ||
      !decimalsEqual(multiplyDecimal(million, "1000"), billion)
    )
      throw new Error("TypeSafe token prices are missing or inconsistent");
    const model = baseModel({
      providerId: input.provider.id,
      id,
      name: header[0],
      sourceId: input.source.id,
      observedAt: input.observedAt,
    });
    model.status = "active";
    model.api_endpoints = [{ name: "System One", path: "/v1/systemone" }];
    if (typed) {
      model.tasks = ["classification"];
      model.task_evidence = [
        {
          task: "classification",
          source_ref: input.source.id,
          namespace: "typesafe.question_type",
          raw_value: "choice",
          kind: "provider_type",
        },
      ];
      model.capabilities.structured_output = true;
    }
    const inputLabel = fields.get("Input");
    if (inputLabel?.startsWith("Text only.")) model.modalities.input = ["text"];
    else signal(input, "/models/input");
    const context = fields.get("Context length");
    if (context !== undefined) {
      model.model_card = { context_window: context.replace(/`/g, "") };
      const total = context.match(/^(\d+)k tokens per request;/)?.[1];
      if (total !== undefined) model.limits.context_tokens = Number(total) * 1000;
      else signal(input, "/models/context-length");
    }
    model.pricing_state = "numeric";
    model.price_facts = (
      [
        { meter: "input_text", price: million, raw_price: rawPrice },
        { meter: "output_data", price: "0", raw_price: "Output tokens are free." },
      ] as const
    ).map((rate) => ({
      ...rate,
      currency: "USD",
      unit: "million_tokens",
      conditions: {},
      source_ref: input.source.id,
      source_locator: { kind: "provider_key", value: id },
      derived: false,
      raw_unit: "per Mtok",
    }));
    model.pricing_inputs = pricingInputs;
    for (const rate of model.price_facts)
      input.onPricingReconciliation?.({
        disposition: "normalized",
        reason_code: "exact_model_token_rate",
        sample: `${id}:${rate.meter}`,
      });
    if (fields.has("Rate limits"))
      input.onPricingReconciliation?.({
        disposition: "excluded",
        reason_code: "rate_limits_not_billable_usage",
      });
    byId.set(id, model);
  }
  const aliases = tables(section(body, "Aliases"));
  if (aliases.length !== 1 || aliases[0]?.header.join("|") !== "Alias|Points to|Meaning")
    throw new Error("TypeSafe alias table changed");
  const aliasIds = new Set<string>();
  for (const [aliasCell, targetCell, meaning] of aliases[0].rows) {
    const alias = codeId(aliasCell);
    const target = byId.get(codeId(targetCell));
    if (target === undefined || byId.has(alias) || aliasIds.has(alias))
      throw new Error("TypeSafe alias is ambiguous or unbound");
    aliasIds.add(alias);
    target.aliases.push(alias);
    if (meaning?.startsWith("The most recent stable, official release."))
      target.release_stage = "stable";
  }
  for (const model of byId.values()) model.aliases.sort();
  assertItemCount(
    "TypeSafe current models",
    byId.size,
    input.source.extractor.minModels,
    input.source.extractor.maxModels,
  );
  return [...byId.values()].sort((left, right) => left.model_id.localeCompare(right.model_id));
}
