import { load, type CheerioAPI } from "cheerio";
import * as ts from "typescript";
import type { LinkedBundle } from "./bundle.ts";
import { uniquePricingInputFacts } from "./pricing-input.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type { SourcePricingInputFact } from "./pricing-source.ts";

type BedrockDocuments = LinkedBundle["documents"];
interface ApiField {
  type: string;
  values: string[];
}

const applyGuardrailUsageFields = [
  "automatedReasoningPolicyUnits",
  "contentPolicyImageUnits",
  "contentPolicyUnits",
  "contextualGroundingPolicyUnits",
  "sensitiveInformationPolicyFreeUnits",
  "sensitiveInformationPolicyUnits",
  "topicPolicyUnits",
  "wordPolicyUnits",
] as const;

function apiFields(
  body: string | undefined,
  owner: string,
  response = false,
): Map<string, ApiField | undefined> {
  const fields = new Map<string, ApiField | undefined>();
  if (body === undefined) return fields;
  const $ = load(body);
  if ($(`h1[id="API_runtime_${owner}"]`).length !== 1) return fields;
  const heading = $(`h2[id="API_runtime_${owner}_${response ? "ResponseElements" : "Contents"}"]`);
  if (heading.length !== 1) return fields;
  const prefix = `bedrock-${response ? `runtime_${owner}-response` : `Type-runtime_${owner}`}-`;
  for (const node of heading.nextUntil("h2").find("dt").toArray()) {
    const dt = $(node);
    const id = dt.attr("id");
    if (id === undefined || !id.startsWith(prefix) || dt.parents("dl").length !== 1) continue;
    const name = id.slice(prefix.length);
    if (dt.find(".term").text().trim() !== name) continue;
    const descriptions = dt.nextUntil("dt").filter("dd");
    const paragraphs = descriptions
      .children("p")
      .toArray()
      .map((p) => $(p).text().trim());
    const types = paragraphs.filter((p) => p.startsWith("Type:"));
    const values = paragraphs.filter((p) => p.startsWith("Valid Values:"));
    const field =
      descriptions.length === 1 && types.length === 1 && values.length <= 1
        ? {
            type: types[0]?.slice(5).trim() ?? "",
            values: (values[0]?.slice(13) ?? "").split("|").map((v) => v.trim()),
          }
        : undefined;
    fields.set(name, fields.has(name) ? undefined : field);
  }
  return fields;
}

function codeShapes($: CheerioAPI, html: string): ts.ObjectLiteralExpression[] {
  const shapes: ts.ObjectLiteralExpression[] = [];
  const scope = $(html);
  for (const pre of scope.filter("pre").add(scope.find("pre")).toArray()) {
    const code = $(pre).text();
    const start = code.indexOf("{");
    if (start < 0) continue;
    // AWS examples include documented placeholders such as "number" and "[ ... ]".
    // Read their object syntax without executing code or trusting placeholder expressions.
    const file = ts.createSourceFile(
      "shape.ts",
      `const shape = (${code.slice(start)});`,
      ts.ScriptTarget.ES2023,
      true,
    );
    const statement = file.statements[0];
    if (statement === undefined || !ts.isVariableStatement(statement)) continue;
    const initializer = statement.declarationList.declarations[0]?.initializer;
    if (
      initializer !== undefined &&
      ts.isParenthesizedExpression(initializer) &&
      ts.isObjectLiteralExpression(initializer.expression)
    )
      shapes.push(initializer.expression);
  }
  return shapes;
}

function propertyAt(root: ts.Expression, path: readonly string[]): ts.Expression | undefined {
  let node = root;
  for (const name of path) {
    if (!ts.isObjectLiteralExpression(node)) return undefined;
    if (
      node.properties.some(
        (property) =>
          ts.isSpreadAssignment(property) ||
          (property.name !== undefined && ts.isComputedPropertyName(property.name)),
      )
    )
      return undefined;
    const matches = node.properties.filter(
      (property) =>
        property.name !== undefined &&
        (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
        property.name.text === name,
    );
    const match = matches[0];
    if (matches.length !== 1 || match === undefined || !ts.isPropertyAssignment(match))
      return undefined;
    node = match.initializer;
  }
  return node;
}

function numericPath(
  shapes: readonly ts.ObjectLiteralExpression[],
  path: readonly string[],
): boolean {
  if (shapes.length !== 1 || shapes[0] === undefined) return false;
  const value = propertyAt(shapes[0], path);
  return (
    value !== undefined &&
    ((ts.isNumericLiteral(value) && /^(?:0|[1-9]\d*)$/.test(value.text)) ||
      (ts.isIdentifier(value) && value.text === "number"))
  );
}

function guideShapes(body: string | undefined, section: string): ts.ObjectLiteralExpression[] {
  if (body === undefined) return [];
  const $ = load(body);
  if (section === "manifest") {
    if ($("h1").text().trim() !== "View the results of a batch inference job") return [];
    const items = $("li").filter((_, li) => $(li).text().includes("manifest.json.out"));
    return items.length === 1 ? codeShapes($, items.toString()) : [];
  }
  const heading = $("h2").filter((_, h) => $(h).text().trim() === section);
  return heading.length === 1 ? codeShapes($, heading.nextUntil("h2").toString()) : [];
}

function pricingInput(
  sourceRef: string,
  key: string,
  channel: SourcePricingInputFact["channel"],
  locator: SourcePricingInputFact["locator"],
  availability: SourcePricingInputFact["availability"],
  absentValue?: "zero",
): SourcePricingInputFact {
  return {
    key,
    channel,
    locator,
    ...(absentValue === undefined ? {} : { absent_value: absentValue }),
    availability,
    source_ref: sourceRef,
  };
}

export function extractBedrockPricingInputs(
  documents: ReadonlyArray<BedrockDocuments[number]>,
  sourceRef: string,
  onPricingReconciliation?: (item: PricingReconciliationItem) => void,
): SourcePricingInputFact[] {
  const document = (path: string): string | undefined => {
    const matches = documents.filter(({ url }) => {
      const parsed = new URL(url);
      return (
        parsed.hostname === "docs.aws.amazon.com" && parsed.pathname === `/bedrock/latest/${path}`
      );
    });
    return matches.length === 1 ? matches[0]?.body : undefined;
  };
  const api = (owner: string, response = false) =>
    apiFields(document(`APIReference/API_runtime_${owner}.html`), owner, response);
  const tokenUsage = api("TokenUsage");
  const cacheDetail = api("CacheDetail");
  const serviceTier = api("ServiceTier");
  const performance = api("PerformanceConfiguration");
  const guardrailUsage = api("GuardrailUsage");
  const facts: SourcePricingInputFact[] = [];
  const promptCaching = document("userguide/prompt-caching.html");
  const promptText = promptCaching === undefined ? "" : load(promptCaching).text();
  const hasUncachedSemantics = promptText.includes(
    "inputTokens field represents only the non-cached input tokens",
  );
  for (const [fields, channel] of [
    [api("Converse", true), "response"],
    [api("ConverseStreamMetadataEvent"), "stream_event"],
  ] as const) {
    const hasUsage = fields.get("usage")?.type === "TokenUsage object";
    if (hasUsage) {
      for (const [key, field] of [
        ["uncached_input_tokens", "inputTokens"],
        ["output_tokens", "outputTokens"],
        ["cached_input_tokens", "cacheReadInputTokens"],
        ["cache_write_tokens", "cacheWriteInputTokens"],
      ] as const)
        if (
          tokenUsage.get(field)?.type === "Integer" &&
          (key !== "uncached_input_tokens" || hasUncachedSemantics)
        )
          facts.push(
            pricingInput(
              sourceRef,
              `runtime.converse.${key}`,
              channel,
              channel === "response"
                ? { kind: "json_pointer", value: `/usage/${field}` }
                : { kind: "provider_field", value: `ConverseStreamMetadataEvent.usage.${field}` },
              "terminal_only",
            ),
          );
      if (
        tokenUsage.get("cacheDetails")?.type === "Array of CacheDetail objects" &&
        cacheDetail.get("inputTokens")?.type === "Integer" &&
        cacheDetail.get("ttl")?.type === "String"
      )
        for (const ttl of ["5m", "1h"] as const)
          if (cacheDetail.get("ttl")?.values.includes(ttl))
            facts.push(
              pricingInput(
                sourceRef,
                `runtime.converse.cache_write_${ttl}_input_tokens`,
                channel,
                {
                  kind: "provider_field",
                  value: `${channel === "response" ? "TokenUsage" : "ConverseStreamMetadataEvent.usage"}.cacheDetails[ttl=${ttl}].inputTokens`,
                },
                "terminal_only",
                "zero",
              ),
            );
    }
    for (const [key, parent, field, owner, definition, values] of [
      [
        "service_tier",
        "serviceTier",
        "type",
        "ServiceTier",
        serviceTier,
        ["priority", "default", "flex", "reserved"],
      ],
      [
        "speed",
        "performanceConfig",
        "latency",
        "PerformanceConfiguration",
        performance,
        ["standard", "optimized"],
      ],
    ] as const)
      if (
        fields.get(parent)?.type === `${owner} object` &&
        definition.get(field)?.type === "String" &&
        values.every((value) => definition.get(field)?.values.includes(value))
      )
        facts.push(
          pricingInput(
            sourceRef,
            `runtime.converse.selector.${key}`,
            channel,
            channel === "response"
              ? { kind: "json_pointer", value: `/${parent}/${field}` }
              : { kind: "provider_field", value: `ConverseStreamMetadataEvent.${parent}.${field}` },
            "terminal_only",
          ),
        );
  }

  const batch = guideShapes(document("userguide/batch-inference-results.html"), "manifest");
  for (const [key, field] of [
    ["input_tokens", "inputTokenCount"],
    ["output_tokens", "outputTokenCount"],
  ] as const)
    if (numericPath(batch, [field]))
      facts.push(
        pricingInput(
          sourceRef,
          `batch.manifest.${key}`,
          "result",
          { kind: "provider_field", value: `manifest.json.out.${field}` },
          "terminal_only",
        ),
      );

  const loggingBody = document("userguide/model-invocation-logging.html");
  const logs = guideShapes(loggingBody, "Log entry format").filter((shape) => {
    const schemaType = propertyAt(shape, ["schemaType"]);
    const schemaVersion = propertyAt(shape, ["schemaVersion"]);
    return (
      schemaType !== undefined &&
      ts.isStringLiteral(schemaType) &&
      schemaType.text === "ModelInvocationLog" &&
      schemaVersion !== undefined &&
      ts.isStringLiteral(schemaVersion) &&
      schemaVersion.text === "1.0"
    );
  });
  if (loggingBody?.includes("bedrock-runtime")) {
    for (const [key, path] of [
      ["input_tokens", ["input", "inputTokenCount"]],
      ["output_tokens", ["output", "outputTokenCount"]],
    ] as const)
      if (numericPath(logs, path))
        facts.push(
          pricingInput(
            sourceRef,
            `runtime.invocation_log.${key}`,
            "invocation_log",
            { kind: "json_pointer", value: `/${path.join("/")}` },
            "reconciliation_only",
          ),
        );
    const region =
      logs.length === 1 && logs[0] !== undefined ? propertyAt(logs[0], ["region"]) : undefined;
    if (region !== undefined && ts.isStringLiteral(region))
      facts.push(
        pricingInput(
          sourceRef,
          "runtime.invocation_log.selector.region",
          "invocation_log",
          { kind: "json_pointer", value: "/region" },
          "reconciliation_only",
        ),
      );
  }

  if (api("ApplyGuardrail", true).get("usage")?.type === "GuardrailUsage object")
    for (const field of applyGuardrailUsageFields)
      if (guardrailUsage.get(field)?.type === "Integer")
        facts.push(
          pricingInput(
            sourceRef,
            `guardrails.apply.${field}`,
            "response",
            { kind: "json_pointer", value: `/usage/${field}` },
            "terminal_only",
          ),
        );

  const checksBody = document("userguide/guardrails-use-invoke-guardrail-checks-using.html");
  const checks = checksBody?.includes("InvokeGuardrailChecks")
    ? guideShapes(checksBody, "Response format")
    : [];
  for (const check of ["contentFilter", "promptAttack", "sensitiveInformation"] as const)
    if (numericPath(checks, ["usage", check, "textUnits"]))
      facts.push(
        pricingInput(
          sourceRef,
          `guardrails.checks.${check}.textUnits`,
          "response",
          { kind: "json_pointer", value: `/usage/${check}/textUnits` },
          "terminal_only",
        ),
      );

  const result = uniquePricingInputFacts(facts);
  const expected = 32;
  if (
    documents.some(
      ({ url }) =>
        url.startsWith("https://docs.aws.amazon.com/bedrock/latest/") && url.endsWith(".html"),
    )
  )
    onPricingReconciliation?.({
      disposition: result.length === expected ? "normalized" : "unbound",
      reason_code:
        result.length === expected
          ? "pricing_input_contract_bound"
          : "pricing_input_contract_partial",
      sample: `${result.length}/${expected} Bedrock pricing inputs`,
    });
  return result;
}
