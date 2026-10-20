import { load } from "cheerio";
import { linkedBundleSchema, linkedDocumentBody, type LinkedBundle } from "./bundle.ts";
import { modelIdSchema } from "./identity.ts";
import { markdownSection } from "./markdown.ts";
import type { SourceManifest } from "./manifests.ts";
import { baseModel } from "./model.ts";
import { openApiYamlSchemaReader } from "./openapi-yaml.ts";
import { yamlBlock } from "./yaml.ts";
import { decimalsEqual, multiplyDecimal } from "./pricing.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type { ParsedProviderModel, SourcePricingInputFact } from "./pricing-source.ts";
import type { Provider } from "./schema.ts";
import {
  assertItemCount,
  contractExtensionEvidence,
  type SourceContractEvidence,
} from "./source-contract.ts";
import type { SourceParseResult } from "./source-parse.ts";

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

interface ModelRecord {
  name: string;
  idCell: string;
  fields: Map<string, string>;
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
    if (header.length !== separator.length || !separator.every((cell) => /^:?-+:?$/.test(cell)))
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

function modelRecords(table: Table): ModelRecord[] {
  const [first, second] = table.header;
  if (table.header.length === 2 && first !== undefined && first !== "") {
    if (second === undefined) throw new Error("TypeSafe model table changed");
    const fields = new Map<string, string>();
    for (const row of table.rows) {
      const [key, value] = row;
      if (!key || !value || fields.has(key)) throw new Error("TypeSafe model field changed");
      fields.set(key, value);
    }
    return [{ name: first, idCell: second, fields }];
  }
  if (first !== "" || table.header.length < 2 || table.header.slice(1).some((name) => !name))
    throw new Error("TypeSafe model table changed");
  const records = table.header.slice(1).map((name) => ({
    name,
    idCell: "",
    fields: new Map<string, string>(),
  }));
  for (const row of table.rows) {
    const key = row[0];
    if (!key) throw new Error("TypeSafe model field changed");
    for (const [index, value] of row.slice(1).entries()) {
      const record = records[index];
      if (record === undefined || !value || record.fields.has(key))
        throw new Error("TypeSafe model field changed");
      record.fields.set(key, value);
      if (key === "Model ID") record.idCell = value;
    }
  }
  if (records.some(({ idCell }) => idCell === "")) throw new Error("TypeSafe model field changed");
  return records;
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
  if (!paths.has("/models.md") || !(paths.has("/api.md") || paths.has("/api/system-one.md")))
    throw new Error("TypeSafe index omitted catalog or API documentation");
  for (const path of paths) {
    // SDK usage pages describe client mechanics; they are not commercial surfaces.
    if (path.startsWith("/sdk/") || path.startsWith("/cookbooks/")) continue;
    if (/(?:pricing|billing|cost|usage|account|credits|plans|batch|caching)/i.test(path))
      throw new Error("TypeSafe index contains an unreviewed commercial document");
  }
}

function yamlPath(body: string, path: readonly string[]): string | undefined {
  let block: string | undefined = body;
  for (const [depth, label] of path.entries()) {
    if (block === undefined) return;
    const matches: string[] = [];
    for (const key of [label, `'${label}'`, `"${label}"`]) {
      const value = yamlBlock(block, key, depth * 2);
      if (value !== undefined) matches.push(value);
    }
    block = matches.length === 1 ? matches[0] : undefined;
  }
  return block;
}

function schemaRefs(
  block: string | undefined,
  indentation: number,
  sequence = false,
): string[] | undefined {
  const prefix = " ".repeat(indentation) + (sequence ? "- $ref:" : "$ref:");
  const lines = block?.split(/\r?\n/).filter((line) => line.startsWith(prefix));
  const refs = lines?.map(
    (line) =>
      line
        .slice(prefix.length)
        .trim()
        .match(/^(['"])(#[^'"]+)\1$/)?.[2],
  );
  if (refs === undefined || refs.some((ref) => ref === undefined)) return;
  return refs.filter((ref) => ref !== undefined);
}

function systemOneSpec(body: string): string | undefined {
  const content = markdownSection(body, 2, "OpenAPI");
  if (content === undefined) return;
  const blocks = [
    ...content.matchAll(
      /^(`{3,})yaml https:\/\/api\.typesafe\.ai\/openapi\.json post \/v1\/systemone\r?\n([\s\S]*?)^\1[ \t]*$/gm,
    ),
  ];
  return blocks.length === 1 ? blocks[0]?.[2] : undefined;
}

function operationSchema(spec: string, side: "request" | "response"): string | undefined {
  const path = [
    "paths",
    "/v1/systemone",
    "post",
    ...(side === "request" ? ["requestBody"] : ["responses", "200"]),
    "content",
    "application/json",
    "schema",
  ];
  const refs = schemaRefs(yamlPath(spec, path), path.length * 2);
  return refs?.length === 1
    ? refs[0]?.match(/^#\/components\/schemas\/([A-Za-z0-9_-]+)$/)?.[1]
    : undefined;
}

function typedQuestions(spec: string): boolean {
  const request = operationSchema(spec, "request");
  const response = operationSchema(spec, "response");
  if (request === undefined || response === undefined) return false;
  const read = openApiYamlSchemaReader(spec);
  const answers = read(response, ["answers"], "map_value");
  if (answers.length !== 1 || answers[0] !== "object") return false;
  const questions = yamlPath(spec, [
    "components",
    "schemas",
    request,
    "properties",
    "questions",
    "additionalProperties",
  ]);
  const requestRefs = schemaRefs(questions, 12);
  if (requestRefs?.length !== 1 || requestRefs[0] !== "#/components/schemas/Question") return false;
  const union = yamlPath(spec, ["components", "schemas", "Question", "oneOf"]);
  const alternatives = schemaRefs(union, 8, true);
  return ["Noul", "Choice", "Score"].every((name) => {
    const type = yamlPath(spec, ["components", "schemas", `${name}Question`, "properties", "type"]);
    const constants = type?.split(/\r?\n/).filter((line) => line.startsWith("          const:"));
    const types = read(`${name}Question`, ["type"]);
    return (
      alternatives?.filter((ref) => ref === `#/components/schemas/${name}Question`).length === 1 &&
      types.length === 1 &&
      types[0] === "string" &&
      constants?.length === 1 &&
      constants[0] === `          const: ${name.toLowerCase()}`
    );
  });
}

function usageInput(
  sourceRef: string,
  key: "input_tokens" | "output_tokens",
): SourcePricingInputFact {
  return {
    key: `systemone.${key}`,
    channel: "response",
    locator: { kind: "json_pointer", value: `/usage/${key}` },
    availability: "conditional",
    source_ref: sourceRef,
  };
}

function accounting(
  input: Input,
  body: string | undefined,
  spec: string | undefined,
): SourcePricingInputFact[] {
  if (body === undefined) return [];
  if (/^## OpenAPI\s*$/m.test(body)) {
    const read = spec === undefined ? undefined : openApiYamlSchemaReader(spec);
    const response = spec === undefined ? undefined : operationSchema(spec, "response");
    return (["input_tokens", "output_tokens"] as const).flatMap((key) => {
      const types = response === undefined ? undefined : read?.(response, ["usage", key]);
      if (types?.length !== 1 || types[0] !== "integer") {
        signal(input, `/api/usage/${key}`);
        return [];
      }
      return [usageInput(input.source.id, key)];
    });
  }
  if (!/^## Response body\s*$/m.test(body)) {
    signal(input, "/api/response-body");
    return [];
  }
  // MDX self-closing fields must not acquire later fields as children during HTML recovery.
  const $ = load(section(body, "Response body"), { xml: { lowerCaseTags: true } });
  const usage = $('responsefield[name="usage"][type="object"]').filter(
    (_index, field) => $(field).parents("responsefield").length === 0,
  );
  return (["input_tokens", "output_tokens"] as const).flatMap((key) => {
    const fields = usage
      .find(`responsefield[name="${key}"]`)
      .filter((_index, field) => $(field).parents("responsefield").first().is(usage));
    if (usage.length !== 1 || fields.length !== 1 || fields.attr("type") !== "integer") {
      signal(input, `/api/usage/${key}`);
      return [];
    }
    return [usageInput(input.source.id, key)];
  });
}

export function parseTypesafeCatalog(input: Input): SourceParseResult {
  if (input.source.extractor.kind !== "typesafe-catalog")
    throw new Error("Wrong TypeSafe extractor");
  const bundle = linkedBundleSchema.parse(JSON.parse(input.body));
  reviewIndex(bundle);
  const body = bundle.index.body.replace(/\\\$/g, "$");
  const current = section(body, "Current models");
  if (!/Every model on this page is served by the same endpoint, `POST \/v1\/systemone`/.test(body))
    throw new Error("TypeSafe model endpoint contract changed");
  if (!/(?:Charged|You pay) per input token\. Output tokens are free\./.test(current))
    throw new Error("TypeSafe token billing contract changed");
  const apiDocuments = bundle.documents.filter(
    ({ url }) =>
      url === "https://docs.typesafe.ai/api/system-one.md" ||
      url === "https://docs.typesafe.ai/api.md",
  );
  const api = apiDocuments.length === 1 ? apiDocuments[0]?.body : undefined;
  const spec = api === undefined ? undefined : systemOneSpec(api);
  const pricingInputs = accounting(input, api, spec);
  const typed =
    api !== undefined &&
    (/^## OpenAPI\s*$/m.test(api)
      ? spec !== undefined && typedQuestions(spec)
      : /Picks one option from a set you define\./.test(api) &&
        ["noul", "choice", "score"].every((type) => api.includes(`type="&#x22;${type}&#x22;"`)));
  if (!typed) signal(input, "/api/question-types");
  const byId = new Map<string, ParsedProviderModel>();
  for (const table of tables(current)) {
    for (const { name, idCell, fields } of modelRecords(table)) {
      const id = codeId(idCell);
      if (byId.has(id)) throw new Error("Duplicate TypeSafe model ID");
      for (const key of fields.keys()) {
        if (
          [
            "Model ID",
            "Price (per Btok / per Mtok)",
            "Rate limits",
            "Context length",
            "Input",
          ].includes(key)
        )
          continue;
        if (/price|cost|billing|discount|cache/i.test(key))
          throw new Error("Unreviewed TypeSafe price field");
        signal(input, "/models/fields/extension");
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
        name,
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
      if (inputLabel === "Text" || inputLabel?.startsWith("Text only."))
        model.modalities.input = ["text"];
      else signal(input, "/models/input");
      const context = fields.get("Context length");
      if (context !== undefined) {
        model.model_card = { context_window: context.replace(/`/g, "") };
        const total = context.match(/^(\d+)k(?: tokens per request;| per-request(?: \/|$))/)?.[1];
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
  return {
    models: [...byId.values()].sort((left, right) => left.model_id.localeCompare(right.model_id)),
    pricing_inputs: pricingInputs,
  };
}
