import { readFile } from "node:fs/promises";
import { load } from "cheerio";
import { expect, it } from "vite-plus/test";
import { linkedBundleSchema, type LinkedBundle } from "../src/catalog/bundle.ts";
import { parseSource } from "../src/catalog/adapters.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";

function configuration() {
  const manifest = manifests.find(({ provider }) => provider.id === "deepseek");
  const source = manifest?.sources.find(({ id }) => id === "deepseek-catalog");
  if (!manifest || !source) throw Error("Missing DeepSeek");
  return { source, provider: { ...manifest.provider, source_ids: [source.id] } };
}
const { source, provider } = configuration();
const observedAt = "2026-11-15T00:00:00.000Z";
async function parse(change?: (bundle: LinkedBundle) => void) {
  const bundle = linkedBundleSchema.parse(
    JSON.parse(
      await readFile(
        new URL("./fixtures/deepseek/additional-services.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  change?.(bundle);
  const failures: string[] = [];
  const result = parseSource({
    provider,
    source,
    observedAt,
    body: JSON.stringify(bundle),
    onPricingDependencyFailure: (url) => failures.push(url),
  });
  const partition = assembleParsedProviderPricing(
    "deepseek",
    observedAt,
    [{ source, ...result }],
    result.models,
  );
  return { result, failures, partition };
}

it("collects independent page and speech services with exact current discounted denominations", async () => {
  const { result, failures, partition } = await parse();
  expect(failures).toEqual([]);
  expect(result.models).toHaveLength(4);
  const services = result.commercial_facts ?? [];
  expect(
    services
      .find(({ resource_key }) => resource_key === "text-to-speech")
      ?.price_facts.map(({ currency, price, unit }) => [currency, price, unit]),
  ).toEqual([
    ["USD", "0.0000225", "character"],
    ["CNY", "0.00015", "character"],
  ]);
  expect(
    services
      .find(({ resource_key }) => resource_key === "speech-to-text")
      ?.price_facts.map(({ currency, price, unit }) => [currency, price, unit]),
  ).toEqual([
    ["USD", "0.058", "hour"],
    ["CNY", "0.39", "hour"],
  ]);
  for (const key of ["file-parsing", "ocr"])
    expect(
      services
        .find(({ resource_key }) => resource_key === key)
        ?.price_facts.map(({ currency, price, unit }) => [currency, price, unit]),
    ).toEqual([
      ["USD", "0.225", "thousand_pages"],
      ["CNY", "1.5", "thousand_pages"],
    ]);
  expect(partition?.books.filter(({ scope }) => scope.kind === "provider_resource")).toHaveLength(
    6,
  );
  const tts = partition?.books.find(({ book_key }) => book_key === "service:text-to-speech");
  const ttsTerm = tts?.offers.flatMap(({ terms }) => terms).find((term) => term.kind === "rate");
  expect(
    ttsTerm?.kind === "rate" ? ttsTerm.variants.map(({ price }) => price.value) : [],
  ).toContainEqual({ numerator: "9", denominator: "400000" });
  const ocr = services.find(({ resource_key }) => resource_key === "ocr")?.price_facts[0];
  expect(
    ocr?.charge_binding?.quantity_methods?.flatMap(
      ({ input_sources }) => input_sources?.map(({ locator }) => locator.value) ?? [],
    ),
  ).toEqual(["/page_count"]);
  const asr = services.find(({ resource_key }) => resource_key === "speech-to-text")
    ?.price_facts[0];
  expect(asr?.charge_binding?.quantity_methods?.[0]?.calculation?.nodes).toContainEqual({
    op: "round_up",
    input: 0,
    increment: { numerator: "1", denominator: "1" },
  });
  expect(asr?.charge_binding?.quantity_methods?.[0]?.input_sources).toBeUndefined();
  expect(
    services
      .find(({ resource_key }) => resource_key === "text-to-speech")
      ?.price_facts[0]?.charge_binding?.observations.some(({ raw }) =>
        raw.fragment?.includes("Chinese character counts as 2"),
      ),
  ).toBe(true);
});

it("uses billed native tool counters rather than display result counts, and preserves Messages totals and terminal usage", async () => {
  const { result } = await parse();
  expect(
    result.pricing_inputs?.filter(({ key }) => key.startsWith("messages.")).map(({ key }) => key),
  ).toHaveLength(12);
  const native =
    result.commercial_facts?.filter(({ offer_key }) => offer_key === "web_tools") ?? [];
  expect(
    native
      .map(({ price_facts }) => price_facts[0]?.meter)
      .sort((a, b) => (a ?? "").localeCompare(b ?? "")),
  ).toEqual(["image_search", "retrieval", "web_search"]);
  for (const fact of native) {
    const binding = fact.price_facts[0]?.charge_binding;
    expect(
      binding?.quantity_methods?.flatMap(
        ({ input_sources }) => input_sources?.map(({ locator }) => locator.value) ?? [],
      ),
    ).toEqual([
      `/usage/server_tool_use/${binding?.signal.value}`,
      `/usage/server_tool_use/${binding?.signal.value}`,
    ]);
    expect(JSON.stringify(binding)).not.toContain("web_search_requests");
    expect(JSON.stringify(binding)).not.toContain("web_fetch_requests");
    expect(
      binding?.quantity_methods?.flatMap(
        ({ input_sources }) => input_sources?.map(({ absent_value }) => absent_value) ?? [],
      ),
    ).toEqual(["zero", "zero"]);
  }
});

it.each(["retyped", "wrong-parent", "terminal", "partition"])(
  "withholds only unproved Messages accounting (%s)",
  async (failure) => {
    const { result } = await parse((bundle) => {
      const doc = bundle.documents.find(({ url }) => url.endsWith("/api/create-message"));
      if (!doc) throw Error("Missing owned Messages reference");
      const $ = load(doc.body);
      if (failure === "terminal") $(".openapi-code__response-samples-container").remove();
      else {
        const field = $(".response .openapi-schema__list-item").filter(
          (_, node) =>
            $(node).find("strong.openapi-schema__property").first().text() ===
            (failure === "wrong-parent" ? "usage" : "input_tokens"),
        );
        if (failure === "partition") field.find("p").text("Input tokens including cached tokens");
        else if (failure === "wrong-parent")
          field.find("strong.openapi-schema__property").first().text("request_usage");
        else field.find(".openapi-schema__name").first().text("string");
      }
      doc.body = $.html();
    });
    expect(result.models).toHaveLength(4);
    expect(
      result.commercial_facts?.find(({ resource_key }) => resource_key === "text-to-speech")
        ?.price_facts,
    ).toHaveLength(2);
    expect(
      result.pricing_inputs?.some(({ key }) => key === "messages.stream.uncached_input_tokens"),
    ).toBe(false);
    expect(result.pricing_inputs?.some(({ key }) => key === "messages.uncached_input_tokens")).toBe(
      failure === "terminal",
    );
    if (failure !== "wrong-parent")
      expect(result.pricing_inputs?.some(({ key }) => key === "messages.cached_input_tokens")).toBe(
        true,
      );
  },
);

it("keeps the OCR price after a typed page counter drifts", async () => {
  const { result } = await parse((bundle) => {
    const doc = bundle.documents.find(({ url }) => url.endsWith("/api/ocr"));
    if (!doc) throw Error("Missing OCR");
    doc.body = doc.body.replaceAll("integer", "string");
  });
  const rate = result.commercial_facts?.find(({ resource_key }) => resource_key === "ocr")
    ?.price_facts[0];
  expect(rate?.price).toBe("0.225");
  expect(rate?.charge_binding?.quantity_methods).toBeUndefined();
});

it("preserves an unknown speech quote locally without substituting its list price", async () => {
  const { result } = await parse((bundle) => {
    const $ = load(bundle.index.body);
    $("tr")
      .filter((_, node) => $(node).children("td").first().text() === "Text to Speech (TTS)")
      .children("td")
      .last()
      .text("pending");
    bundle.index.body = $.html();
  });
  const tts = result.commercial_facts?.find(
    ({ resource_key }) => resource_key === "text-to-speech",
  );
  expect(tts?.raw_price_facts[0]?.reason).toBe("unknown_amount");
  expect(tts?.price_facts.map(({ currency }) => currency)).toEqual(["CNY"]);
  const ocr = result.commercial_facts?.find(({ resource_key }) => resource_key === "ocr");
  expect(ocr?.price_facts.map(({ currency }) => currency)).toEqual(["USD", "CNY"]);
});

it("rejects changed web-tool billing without weakening standalone prices", async () => {
  const { result, failures } = await parse((bundle) => {
    const doc = bundle.documents.find(({ url }) => url.endsWith("/guides/web_tools"));
    if (!doc) throw Error("Missing billing guide");
    doc.body = doc.body.replace("for each of its queries", "once for every call");
  });
  expect(failures).toContain("https://api-docs.deepseek.com/guides/web_tools");
  expect(result.commercial_facts?.some(({ offer_key }) => offer_key === "web_tools")).toBe(false);
  expect(
    result.commercial_facts?.find(
      ({ resource_key, offer_key }) => resource_key === "web-search" && offer_key === "standalone",
    )?.price_facts,
  ).toHaveLength(2);
});
