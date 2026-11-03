import { load } from "cheerio";
import type { SourcePriceFact } from "./pricing-source.ts";

export const vertexClaudeSkuSource =
  "https://cloud.google.com/skus/sku-groups/gemini-enterprise-flexible-savings-plan-eligible-skus";

function key(model: string, meter: string, region: string, min: number, max: number): string {
  return JSON.stringify([model, meter, region, min, max]);
}

export function claudeContextSkus(body: string): ReadonlyMap<string, string | null> {
  const skus = new Map<string, string | null>();
  const $ = load(body);
  $("table").each((_index, table) => {
    const columns = $(table)
      .find("tr")
      .first()
      .children("th")
      .map((_index, th) => $(th).text().trim())
      .get();
    if (columns.join("|") !== "Service Name|SKU Name|SKU ID|Date Added") return;
    $(table)
      .find("tbody tr")
      .each((_index, row) => {
        const [service, name, sku] = $(row)
          .children("td")
          .map((_index, td) => $(td).text().trim())
          .get();
        const serviceModel = service?.match(
          /^(Claude (?:Haiku|Sonnet|Opus|Fable) \d+(?:\.\d+)?)\([A-F0-9]{4}(?:-[A-F0-9]{4}){2}\)$/,
        )?.[1];
        const parts = name?.split(" — ");
        const [label, meter, region, window] = parts ?? [];
        const model =
          service === "Vertex AI(C7E2-9256-1C43)"
            ? label?.match(/^(Claude (?:Haiku|Sonnet|Opus|Fable) \d+(?:[. ]\d+)?)$/)?.[1]
            : serviceModel;
        if (
          model === undefined ||
          (label !== model && label !== model.replaceAll(".", " ")) ||
          parts?.length !== 4 ||
          meter === undefined ||
          region === undefined ||
          sku === undefined ||
          !/^[A-F0-9]{4}(?:-[A-F0-9]{4}){2}$/.test(sku)
        )
          return;
        const bounds = window?.match(/^Context Window Size from (\d+) to (\d+) Tokens$/);
        if (bounds === undefined || bounds === null) return;
        const id = key(
          model.toLowerCase().replace(/[ .]/g, "-"),
          meter,
          region,
          Number(bounds[1]),
          Number(bounds[2]),
        );
        const previous = skus.get(id);
        skus.set(id, previous === undefined || previous === sku ? sku : null);
      });
  });
  return skus;
}

export function claudeContextSkuPair(
  skus: ReadonlyMap<string, string | null>,
  model: string,
  { conditions, meter, unit }: SourcePriceFact,
  count: number,
): string | undefined {
  const { region, service_tier: tier, cache_ttl_seconds: ttl } = conditions;
  if (
    typeof region !== "string" ||
    unit !== "million_tokens" ||
    (tier !== undefined && tier !== "standard" && tier !== "batch")
  )
    return;
  const batch = tier === "batch";
  const labels = {
    input_text: batch ? "Offline Batch Input Tokens" : "Input Tokens",
    output_text: batch ? "Offline Batch Output Tokens" : "Output Tokens",
    cache_read_text: batch ? "Batch Cache Read Tokens" : "Input Cache Read Tokens",
    cache_write_text:
      ttl === 300 || ttl === 3600
        ? `${batch ? "Batch" : "Input"} Cache Write Tokens (TTL ${ttl} seconds)`
        : undefined,
  };
  if (
    meter !== "input_text" &&
    meter !== "output_text" &&
    meter !== "cache_read_text" &&
    meter !== "cache_write_text"
  )
    return;
  const label = labels[meter];
  if (label === undefined) return;
  const short = skus.get(key(model, label, region, 0, count));
  const long = skus.get(key(model, label, region, count + 1, 1_000_000));
  if (short && long && short !== long) return `${short} / ${long}`;
}
