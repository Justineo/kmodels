import { z } from "zod";
import { modelIdSchema } from "./identity.ts";
import type { SourceManifest } from "./manifests.ts";
import { baseModel } from "./model.ts";
import { publishedRate } from "./pricing.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type {
  ParsedProviderModel,
  SourceCommercialPricingFact,
  SourcePriceFact,
} from "./pricing-source.ts";
import type { Provider } from "./schema.ts";
import { assertItemCount } from "./source-contract.ts";

interface Input {
  provider: Provider;
  source: SourceManifest;
  body: string;
  observedAt: string;
  onPricingReconciliation?: (item: PricingReconciliationItem) => void;
}

const bundleSchema = z.object({
  index: z.object({ url: z.url(), body: z.string() }),
  documents: z.array(z.object({ url: z.url(), body: z.string() })),
});

function clean(value: string): string {
  return value.replaceAll("\\$", "$").replace(/[*`]/g, "").trim();
}

function tables(body: string): { headers: string[]; rows: string[][] }[] {
  const lines = body.split(/\r?\n/).map((line) => line.trim());
  const cells = (line: string) => line.slice(1, -1).split("|").map(clean);
  const result: { headers: string[]; rows: string[][] }[] = [];
  for (let index = 0; index < lines.length - 1; index++) {
    const line = lines[index] ?? "";
    const next = lines[index + 1] ?? "";
    if (
      !line.startsWith("|") ||
      !next.startsWith("|") ||
      !cells(next).every((cell) => /^:?-{3,}:?$/.test(cell))
    )
      continue;
    const headers = cells(line);
    const rows: string[][] = [];
    index += 2;
    while (lines[index]?.startsWith("|")) {
      const row = cells(lines[index] ?? "");
      if (row.length === headers.length) rows.push(row);
      index++;
    }
    result.push({ headers, rows });
  }
  return result;
}

export function parsePerplexityCatalog(input: Input): ParsedProviderModel[] {
  if (input.source.extractor.kind !== "perplexity-catalog")
    throw new Error("Wrong Perplexity extractor");
  const bundle = bundleSchema.parse(JSON.parse(input.body));
  if (bundle.index.url !== input.source.url) throw new Error("Perplexity pricing URL changed");
  const modelDocument = bundle.documents.find(
    ({ url }) => url === "https://docs.perplexity.ai/docs/sonar/models.md",
  );
  if (modelDocument === undefined) throw new Error("Perplexity Sonar model index is missing");
  const sonarIds = new Set(
    [...modelDocument.body.matchAll(/href="\/docs\/sonar\/models\/([a-z0-9-]+)"/g)].flatMap(
      (match) => (match[1] === undefined ? [] : [match[1]]),
    ),
  );
  const models = new Map<string, ParsedProviderModel>();
  const services: SourceCommercialPricingFact[] = [];
  const report = (sample: string) =>
    input.onPricingReconciliation?.({
      disposition: "unsupported",
      reason_code: "perplexity_price_cell_unrecognized",
      sample: sample.slice(0, 256),
    });
  const getModel = (id: string, name: string, embedding = false) => {
    let model = models.get(id);
    if (model !== undefined) return model;
    model = {
      ...baseModel({
        providerId: input.provider.id,
        id,
        name,
        sourceId: input.source.id,
        observedAt: input.observedAt,
      }),
      tasks: [embedding ? "embeddings" : "text_generation"],
      modalities: { input: ["text"], output: [embedding ? "embedding" : "text"] },
    };
    models.set(id, model);
    return model;
  };
  const amount = (cell: string, sample: string) => {
    const match = cell.match(/^\$?(\d+(?:\.\d+)?)$/);
    if (match?.[1] === undefined && !["-", "—", ""].includes(cell)) report(sample);
    return match?.[1];
  };
  const add = (
    model: ParsedProviderModel,
    meter: SourcePriceFact["meter"],
    cell: string,
    unit: SourcePriceFact["unit"],
    conditions: SourcePriceFact["conditions"] = {},
  ) => {
    const value = amount(cell, `${model.model_id}: ${meter}: ${cell}`);
    if (value !== undefined)
      model.price_facts.push(publishedRate(meter, value, unit, input.source.id, cell, conditions));
    else if (!["-", "—", ""].includes(cell))
      model.raw_price_facts.push({
        term_key: `unparsed:${meter}`,
        impact: "base_price",
        reason: "unknown_amount",
        conditions,
        source_ref: input.source.id,
        raw: { label: meter, fragment: cell },
      });
  };
  const service = (
    key: string,
    name: string,
    rates: SourcePriceFact[],
  ): SourceCommercialPricingFact => ({
    source_ref: input.source.id,
    book_key: `service:${key}`,
    book_name: name,
    resource_kind: "service",
    resource_key: key,
    model_refs: [],
    offer_key: "usage",
    offer_name: name,
    billing_mode: "usage",
    pricing_state: "numeric",
    price_facts: rates,
    raw_price_facts: [],
  });
  const parsedTables = tables(bundle.index.body);
  const unparsedService = (key: string, name: string, fragment: string) => {
    const fact = service(key, name, []);
    fact.raw_price_facts.push({
      term_key: "unparsed-price",
      impact: "base_price",
      reason: "unknown_amount",
      conditions: {},
      source_ref: input.source.id,
      raw: { label: name, fragment },
    });
    services.push(fact);
  };
  const searchBilling = clean(bundle.index.body).match(
    /Billing unit: Search API charges[^\n]+/,
  )?.[0];
  for (const id of sonarIds) getModel(id, id);
  for (const table of parsedTables) {
    if (table.headers.includes("Input Tokens ($/1M)")) {
      const columns = [
        ["Input Tokens ($/1M)", "input_text", "million_tokens"],
        ["Output Tokens ($/1M)", "output_text", "million_tokens"],
        ["Citation Tokens ($/1M)", "citation_tokens", "million_tokens"],
        ["Search Queries ($/1K)", "web_search", "thousand_search_units"],
        ["Reasoning Tokens ($/1M)", "reasoning_tokens", "million_tokens"],
      ] as const;
      for (const row of table.rows) {
        const name = row[0] ?? "";
        const id = name.toLowerCase().replaceAll(" ", "-");
        if (!sonarIds.has(id)) {
          report(`Unbound Sonar model: ${name}`);
          continue;
        }
        const model = getModel(id, name);
        model.name = name;
        for (const [header, meter, unit] of columns)
          add(model, meter, row[table.headers.indexOf(header)] ?? "", unit);
      }
    }
    if (table.headers.join("|") === "Model|Dimensions|Price ($/1M tokens)")
      for (const row of table.rows) {
        const id = row[0] ?? "";
        if (!modelIdSchema.safeParse(id).success) {
          report(`Invalid embedding ID: ${id}`);
          continue;
        }
        add(getModel(id, id, true), "embedding", row[2] ?? "", "million_tokens");
      }
  }
  const contextTiers = ["low", "medium", "high"] as const;
  for (const table of parsedTables) {
    if (table.headers.join("|") === "Model|Low Context Size|Medium Context Size|High Context Size")
      for (const row of table.rows) {
        const id = (row[0] ?? "").toLowerCase().replaceAll(" ", "-");
        const model = models.get(id);
        if (model === undefined) continue;
        for (const [index, context] of contextTiers.entries())
          add(model, "web_search", row[index + 1] ?? "", "thousand_requests", {
            context_tier: context,
            ...(id === "sonar-pro" ? { search_effort: "fast" } : {}),
          });
      }
    if (table.headers.join("|") === "Search Type|Description|Request Fee (per 1K)") {
      const model = models.get("sonar-pro");
      if (model === undefined) continue;
      for (const row of table.rows) {
        const searchType = row[0];
        if (searchType === "auto") continue; // Price the realized fast/pro classification.
        if (searchType !== "fast" && searchType !== "pro") {
          report(`Search type: ${searchType}`);
          continue;
        }
        const prices = row[2]?.split("/").map((cell) => cell.trim()) ?? [];
        if (prices.length !== 3) {
          report(`Search fee: ${row[2]}`);
          model.raw_price_facts.push({
            term_key: "unparsed:web_search",
            impact: "base_price",
            reason: "unknown_amount",
            conditions: { search_effort: searchType },
            source_ref: input.source.id,
            raw: { label: "Search request fee", fragment: row.join("; ") },
          });
          continue;
        }
        for (const [index, context] of contextTiers.entries())
          add(model, "web_search", prices[index] ?? "", "thousand_requests", {
            context_tier: context,
            search_effort: searchType,
          });
      }
    }
    if (table.headers.join("|") === "API|Price per 1K requests|Description")
      for (const row of table.rows) {
        if (row[0] !== "Search API") continue;
        const value = amount(row[1] ?? "", "Search API");
        if (value !== undefined)
          services.push(
            service("search", "Search API", [
              publishedRate(
                "web_search",
                value,
                "thousand_requests",
                input.source.id,
                [row.join("; "), searchBilling ?? ""].join("; "),
              ),
            ]),
          );
        else unparsedService("search", "Search API", row.join("; "));
      }
    if (table.headers.join("|") === "Tool|Price|Description")
      for (const row of table.rows) {
        const name = row[0] ?? "";
        if (
          !["web_search", "fetch_url", "people_search", "finance_search", "sandbox"].includes(name)
        ) {
          report(`Agent tool: ${name}`);
          continue;
        }
        const match = row[1]?.match(/^\$(\d+(?:\.\d+)?) per (invocation|session)$/);
        if (
          match?.[1] === undefined ||
          match[2] !== (name === "sandbox" ? "session" : "invocation")
        ) {
          report(`Agent tool price: ${row.join("; ")}`);
          unparsedService(
            `agent-${name.replaceAll("_", "-")}`,
            `Agent API ${name}`,
            row.join("; "),
          );
          continue;
        }
        services.push(
          service(`agent-${name.replaceAll("_", "-")}`, `Agent API ${name}`, [
            publishedRate(
              name === "sandbox" ? "container_runtime" : "tool_call",
              match[1],
              name === "sandbox" ? "session" : "event",
              input.source.id,
              row.join("; "),
            ),
          ]),
        );
        if (name === "sandbox") {
          const sdkSearch = row[2]?.match(/SDK search queries[^$]+\$(\d+(?:\.\d+)?) per request/);
          if (sdkSearch?.[1] !== undefined)
            services.push(
              service("agent-sandbox-search", "Agent sandbox SDK search", [
                publishedRate("tool_call", sdkSearch[1], "request", input.source.id, row[2] ?? ""),
              ]),
            );
        }
      }
  }
  assertItemCount(
    "Perplexity native models",
    models.size,
    input.source.extractor.minModels,
    input.source.extractor.maxModels,
    ["models"],
  );
  const result = [...models.values()].sort((left, right) => left.uid.localeCompare(right.uid));
  for (const model of result) if (model.price_facts.length > 0) model.pricing_state = "numeric";
  const carrier = result[0];
  if (carrier !== undefined && services.length > 0) carrier.commercial_facts = services;
  return result;
}
