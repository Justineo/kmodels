import * as ts from "typescript";
import { z } from "zod";
import type { LinkedBundle } from "./bundle.ts";
import { multiplyDecimal, rawPricingFact } from "./pricing.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import {
  sourcePriceFactKey,
  type ParsedProviderModel,
  type SourcePriceFact,
  type SourcePricingInputFact,
} from "./pricing-source.ts";

const repository = "https://raw.githubusercontent.com/mistralai/platform-docs-public/main";
export const mistralCurrencyUrl = `${repository}/src/schema/models/pricing-currency.ts`;
export const mistralPriorityUrl = `${repository}/src/content/en/docs/inference/priority-tier/page.mdx`;

interface CurrencyPolicy {
  factor: string;
  decimals: number;
}

export interface MistralPricingPolicy {
  euro?: CurrencyPolicy;
  priority?: string;
  inputs: SourcePricingInputFact[];
}

type Reconcile = ((item: PricingReconciliationItem) => void) | undefined;

export function parseMistralPricingPolicy(
  bundle: LinkedBundle,
  sourceRef: string,
  reconcile: Reconcile,
): MistralPricingPolicy {
  const document = (url: string): string | undefined => {
    const matches = bundle.documents.filter((document) => document.url === url);
    return matches.length === 1 ? matches[0]?.body : undefined;
  };
  const euro = currencyPolicy(document(mistralCurrencyUrl)) ?? bundledCurrencyPolicy(bundle);
  const body =
    document("https://docs.mistral.ai/inference/priority-tier.md") ??
    document(mistralPriorityUrl) ??
    "";
  const priority = priorityFactor(body);
  for (const [name, known] of [
    ["currency", euro !== undefined],
    ["priority", priority !== undefined],
  ] as const)
    reconcile?.({
      disposition: known ? "normalized" : "unbound",
      reason_code: known ? "pricing_policy_bound" : "pricing_policy_unavailable",
      sample: name,
    });

  const mapped = servedTier(body);
  reconcile?.({
    disposition: mapped ? "normalized" : "unbound",
    reason_code: mapped ? "served_tier_contract_bound" : "served_tier_contract_unavailable",
  });
  return {
    ...(euro === undefined ? {} : { euro }),
    ...(priority === undefined ? {} : { priority }),
    inputs: mapped
      ? [
          {
            key: "completion.response.served_service_tier",
            channel: "response",
            locator: { kind: "json_pointer", value: "/usage/service_tier" },
            availability: "success_only",
            source_ref: sourceRef,
          },
        ]
      : [],
  };
}

// The documentation site's shipped formatter replaced the unpublished repository module.
// Parse its arithmetic and lexical precision binding without evaluating downloaded JavaScript.
function bundledCurrencyPolicy(bundle: LinkedBundle): CurrencyPolicy | undefined {
  const policies: CurrencyPolicy[] = [];
  for (const document of bundle.documents) {
    if (!/^https:\/\/docs\.mistral\.ai\/_next\/static\/chunks\/[\w-]+\.js$/.test(document.url))
      continue;
    const source = ts.createSourceFile("currency.js", document.body, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (
        ts.isFunctionDeclaration(node) &&
        node.parameters.length === 2 &&
        node.body?.statements.length === 1
      ) {
        const [amount, currency] = node.parameters;
        const statement = node.body.statements[0];
        const expression =
          statement !== undefined && ts.isReturnStatement(statement)
            ? statement.expression
            : undefined;
        if (
          amount !== undefined &&
          currency !== undefined &&
          ts.isIdentifier(amount.name) &&
          ts.isIdentifier(currency.name) &&
          currency.initializer !== undefined &&
          ts.isStringLiteral(currency.initializer) &&
          currency.initializer.text === "usd" &&
          expression !== undefined &&
          ts.isCallExpression(expression) &&
          expression.arguments.length === 2 &&
          expression.arguments[0]?.getText(source) === "/\\.?0+$/" &&
          expression.arguments[1] !== undefined &&
          ts.isStringLiteral(expression.arguments[1]) &&
          expression.arguments[1].text === "" &&
          ts.isPropertyAccessExpression(expression.expression) &&
          expression.expression.name.text === "replace"
        ) {
          const rounded = expression.expression.expression;
          if (
            ts.isCallExpression(rounded) &&
            ts.isPropertyAccessExpression(rounded.expression) &&
            rounded.expression.name.text === "toFixed"
          ) {
            const value = rounded.expression.expression;
            const precision = rounded.arguments[0];
            const conditional = ts.isParenthesizedExpression(value) ? value.expression : value;
            if (
              ts.isConditionalExpression(conditional) &&
              ts.isBinaryExpression(conditional.condition) &&
              conditional.condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
              ts.isStringLiteral(conditional.condition.left) &&
              conditional.condition.left.text === "eur" &&
              identifier(conditional.condition.right, currency.name.text) &&
              ts.isBinaryExpression(conditional.whenTrue) &&
              conditional.whenTrue.operatorToken.kind === ts.SyntaxKind.AsteriskToken &&
              ts.isNumericLiteral(conditional.whenTrue.left) &&
              identifier(conditional.whenTrue.right, amount.name.text) &&
              identifier(conditional.whenFalse, amount.name.text) &&
              precision !== undefined &&
              ts.isElementAccessExpression(precision) &&
              ts.isIdentifier(precision.expression) &&
              identifier(precision.argumentExpression, currency.name.text) &&
              ts.isBlock(node.parent)
            ) {
              const bindingName = precision.expression.text;
              const declarations = node.parent.statements
                .flatMap((s) =>
                  ts.isVariableStatement(s) ? [...s.declarationList.declarations] : [],
                )
                .filter((declaration) => identifier(declaration.name, bindingName));
              const binding = declarations.length === 1 ? declarations[0]?.initializer : undefined;
              const precisions =
                binding !== undefined && ts.isObjectLiteralExpression(binding)
                  ? binding.properties.flatMap((p) =>
                      ts.isPropertyAssignment(p) &&
                      identifier(p.name, "eur") &&
                      ts.isNumericLiteral(p.initializer)
                        ? [Number(p.initializer.text)]
                        : [],
                    )
                  : [];
              const decimals = precisions[0];
              const factor = conditional.whenTrue.left.text.replace(/^\./, "0.");
              if (
                precisions.length === 1 &&
                decimals !== undefined &&
                Number.isInteger(decimals) &&
                decimals >= 0 &&
                decimals <= 18 &&
                /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(factor) &&
                /[1-9]/.test(factor)
              )
                policies.push({ factor, decimals });
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return policies.length === 1 ? policies[0] : undefined;
}

export function applyMistralPricingPolicy(
  model: ParsedProviderModel,
  policy: MistralPricingPolicy,
  reconcile: Reconcile,
): void {
  const chat = model.api_endpoints?.some(({ path }) => path === "/v1/chat/completions");
  const priorityEligible = (rate: SourcePriceFact): boolean =>
    chat === true &&
    rate.conditions.service_tier === "standard" &&
    ["input_text", "output_text", "cache_read_text"].includes(rate.meter) &&
    ["token", "thousand_tokens", "million_tokens"].includes(rate.unit);
  const unresolved = (rate: SourcePriceFact, kind: "currency" | "priority"): void => {
    const conditions =
      kind === "currency"
        ? { ...rate.conditions, billing_currency: "EUR" }
        : { ...rate.conditions, service_tier: "priority", endpoint: "/v1/chat/completions" };
    model.raw_price_facts.push(
      rawPricingFact(
        rate.source_ref,
        `pricing_policy:${kind}:${rate.meter}`,
        "base_price",
        "unsupported_structure",
        {
          label: `Published Mistral ${kind} policy could not establish an exact rate`,
          meter: rate.meter,
        },
        conditions,
      ),
    );
    if (kind === "currency" && priorityEligible(rate))
      unresolved({ ...rate, conditions }, "priority");
  };
  const exactEuro = (rate: SourcePriceFact): boolean => {
    if (
      policy.euro === undefined ||
      (rate.price.split(".")[1]?.length ?? 0) <= policy.euro.decimals
    )
      return true;
    reconcile?.({
      disposition: "unsupported",
      reason_code: "eur_display_precision_not_exact",
      sample: model.model_id,
    });
    unresolved(rate, "currency");
    return false;
  };
  model.price_facts = model.price_facts.map((rate) => ({
    ...rate,
    conditions: { ...rate.conditions, service_tier: rate.conditions.service_tier ?? "standard" },
  }));
  const knownEuros = new Set(
    model.price_facts.filter(({ currency }) => currency === "EUR").map(sourcePriceFactKey),
  );
  const euros = model.price_facts.flatMap((rate): SourcePriceFact[] => {
    if (rate.currency !== "USD") return [];
    const converted = {
      ...rate,
      currency: "EUR",
      conditions: { ...rate.conditions, billing_currency: "EUR" },
    };
    if (knownEuros.has(sourcePriceFactKey(converted))) return [];
    if (policy.euro === undefined) {
      unresolved(converted, "currency");
      return [];
    }
    const { factor } = policy.euro;
    const next = {
      ...converted,
      price: multiplyDecimal(rate.price, factor),
      derived: true,
      derivation: `${factor} × USD rate using Mistral's published EUR display conversion`,
    };
    return exactEuro(next) ? [next] : [];
  });
  model.price_facts.push(...euros);

  const priority = model.price_facts.flatMap((rate): SourcePriceFact[] => {
    if (!priorityEligible(rate)) return [];
    if (policy.priority === undefined) {
      unresolved(rate, "priority");
      return [];
    }
    const factor = policy.priority;
    const next = {
      ...rate,
      price: multiplyDecimal(rate.price, factor),
      conditions: {
        ...rate.conditions,
        service_tier: "priority",
        endpoint: "/v1/chat/completions",
      },
      derived: true,
      derivation: `${factor} × published standard ${rate.meter} rate for requests served at Priority Tier`,
    };
    return next.currency !== "EUR" || exactEuro(next) ? [next] : [];
  });
  model.price_facts.push(...priority);
}

function currencyPolicy(body: string | undefined): CurrencyPolicy | undefined {
  if (body === undefined) return;
  const source = ts.createSourceFile("pricing-currency.ts", body, ts.ScriptTarget.Latest, false);
  const factors: string[] = [];
  const precisions: number[] = [];
  const converters: ts.FunctionDeclaration[] = [];
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
        const value = declaration.initializer;
        if (!["USD_TO_EUR", "MAX_DECIMALS"].includes(declaration.name.text)) continue;
        if (!(statement.declarationList.flags & ts.NodeFlags.Const)) return;
        if (declaration.name.text === "USD_TO_EUR") {
          if (!ts.isNumericLiteral(value)) return;
          factors.push(value.text);
        } else {
          if (!ts.isObjectLiteralExpression(value)) return;
          for (const property of value.properties)
            if (
              ts.isPropertyAssignment(property) &&
              ts.isIdentifier(property.name) &&
              property.name.text === "eur"
            ) {
              if (!ts.isNumericLiteral(property.initializer)) return;
              precisions.push(Number(property.initializer.text));
            }
        }
      }
    }
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === "convertUsdPrice") {
      converters.push(statement);
    }
  }
  const factor = factors[0];
  const decimals = precisions[0];
  const converter = converters[0];
  if (
    factors.length !== 1 ||
    factor === undefined ||
    !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(factor) ||
    !/[1-9]/.test(factor) ||
    precisions.length !== 1 ||
    decimals === undefined ||
    !Number.isSafeInteger(decimals) ||
    decimals < 0 ||
    decimals > 18 ||
    converters.length !== 1 ||
    converter === undefined ||
    !currencyConversion(converter)
  )
    return;
  return { factor, decimals };
}

function currencyConversion(declaration: ts.FunctionDeclaration): boolean {
  if (
    declaration.parameters.length !== 2 ||
    !declaration.parameters.every((parameter, index) =>
      identifier(parameter.name, index === 0 ? "priceUsd" : "currency"),
    )
  )
    return false;
  const returned = declaration.body?.statements;
  const expression =
    returned?.length === 1 && returned[0] !== undefined && ts.isReturnStatement(returned[0])
      ? returned[0].expression
      : undefined;
  return (
    expression !== undefined &&
    ts.isConditionalExpression(expression) &&
    ts.isBinaryExpression(expression.condition) &&
    expression.condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
    identifier(expression.condition.left, "currency") &&
    ts.isStringLiteral(expression.condition.right) &&
    expression.condition.right.text === "eur" &&
    ts.isBinaryExpression(expression.whenTrue) &&
    expression.whenTrue.operatorToken.kind === ts.SyntaxKind.AsteriskToken &&
    identifier(expression.whenTrue.left, "priceUsd") &&
    identifier(expression.whenTrue.right, "USD_TO_EUR") &&
    identifier(expression.whenFalse, "priceUsd")
  );
}

function identifier(node: ts.Node, value: string): boolean {
  return ts.isIdentifier(node) && node.text === value;
}

function priorityFactor(body: string): string | undefined {
  const matches = [...body.matchAll(/\bmultiplier is (\d+(?:\.\d+)?)x\b/g)];
  const factor = matches[0]?.[1];
  if (
    matches.length !== 1 ||
    factor === undefined ||
    !/[1-9]/.test(factor) ||
    !body.includes("Standard Tier") ||
    !body.includes("input, output, and cached tokens") ||
    !/multiplier applies after the prompt cache discount/.test(body)
  )
    return;
  return factor;
}

const servedTierExample = z.object({
  usage: z.object({ service_tier: z.enum(["standard", "priority"]) }),
});

function servedTier(body: string): boolean {
  if (
    !body.includes("response usage object") ||
    !body.includes("processed the request") ||
    !/\| `priority` \|/.test(body) ||
    !/\| `standard` \|/.test(body)
  )
    return false;
  return [...body.matchAll(/```json\s*\n([\s\S]*?)\n```/g)].some((match) => {
    try {
      return servedTierExample.safeParse(JSON.parse(match[1] ?? "")).success;
    } catch {
      return false;
    }
  });
}
