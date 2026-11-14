import * as ts from "typescript";
import type { LinkedBundle } from "./bundle.ts";
import { decimalsEqual } from "./pricing.ts";
import {
  addRationals,
  normalizeRational,
  rationalFromDecimal,
  rationalToFiniteDecimal,
} from "./pricing-rational.ts";

export interface MistralRegionalPolicy {
  standard: string;
  priority?: string;
  allUnits: boolean;
}

export function mistralRegionalPolicy(
  bundle: LinkedBundle,
  priority: string | undefined,
): MistralRegionalPolicy | undefined {
  const guides = bundle.documents.filter(
    ({ url }) => url === "https://docs.mistral.ai/inference/regional-inference.md",
  );
  const guide = guides.length === 1 ? guides[0]?.body.replace(/\s+/g, " ") : undefined;
  const standard = guide?.match(
    /Regional inference is billed at \*\*(\d+(?:\.\d+)?)× standard list pricing\*\*.*?for input tokens, output tokens, cached reads, and cache writes\./,
  )?.[1];
  if (
    standard === undefined ||
    !guide?.includes(
      "Stateful features, including Agents, Batch, and the Files API, are not available on regional endpoints.",
    ) ||
    !guide.includes("api.eu.mistral.ai") ||
    !guide.includes("api.us.mistral.ai")
  )
    return;
  const factor = rationalFromDecimal(standard);
  if (BigInt(factor.numerator) <= BigInt(factor.denominator)) return;
  const compositions: { regional: string; priority: string; standardLookup: boolean }[] = [];
  let cells = false;
  const seen = new Set<string>();
  let ambiguous = false;
  for (const { url, body } of bundle.documents) {
    if (!/^https:\/\/docs\.mistral\.ai\/_next\/static\/chunks\/[\w-]+\.js$/.test(url)) continue;
    if (seen.has(url)) ambiguous = true;
    seen.add(url);
    const tree = ts.createSourceFile("pricing.js", body, ts.ScriptTarget.Latest, true);
    const found: { regional: string; priority: string; standardLookup: boolean }[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && renderedCells(node)) cells = true;
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "s"
      ) {
        const values = node.arguments[0];
        if (values !== undefined && ts.isArrayLiteralExpression(values))
          for (const [index, entry] of values.elements.entries()) {
            if (!ts.isStringLiteral(entry) || entry.text !== "pricingFactor") continue;
            const kind = values.elements[index + 1];
            const fn = values.elements[index + 2];
            const parsed =
              kind !== undefined &&
              ts.isNumericLiteral(kind) &&
              kind.text === "0" &&
              fn !== undefined &&
              ts.isFunctionExpression(fn)
                ? composition(fn)
                : undefined;
            if (parsed === undefined) ambiguous = true;
            else found.push(parsed);
          }
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
    if (found.length > 1) ambiguous = true;
    compositions.push(...found);
  }
  const current = compositions[0];
  const matchingRegional =
    !ambiguous &&
    current !== undefined &&
    compositions.every((value) => decimalsEqual(value.regional, standard));
  const allUnits = matchingRegional && cells && compositions.every((value) => value.standardLookup);
  if (
    !matchingRegional ||
    current === undefined ||
    priority === undefined ||
    !compositions.every((value) => decimalsEqual(value.priority, priority))
  )
    return { standard, allUnits };
  const uplift = normalizeRational(
    BigInt(factor.numerator) - BigInt(factor.denominator),
    BigInt(factor.denominator),
  );
  const combined = rationalToFiniteDecimal(
    addRationals(rationalFromDecimal(current.priority), uplift),
  );
  return { standard, allUnits, ...(combined === undefined ? {} : { priority: combined }) };
}

function unwrap(value: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(value) ? unwrap(value.expression) : value;
}
function named(value: ts.Node, name: string): boolean {
  return ts.isIdentifier(value) && value.text === name;
}
function decimal(value: ts.Expression): string | undefined {
  return ts.isNumericLiteral(value) && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value.text)
    ? value.text
    : undefined;
}
function composition(
  fn: ts.FunctionExpression,
): { regional: string; priority: string; standardLookup: boolean } | undefined {
  const [mode, regional] = fn.parameters;
  const [declaration, returned] = fn.body.statements;
  if (
    fn.parameters.length !== 2 ||
    mode === undefined ||
    regional === undefined ||
    !ts.isIdentifier(mode.name) ||
    !ts.isIdentifier(regional.name) ||
    fn.body.statements.length !== 2 ||
    declaration === undefined ||
    !ts.isVariableStatement(declaration) ||
    declaration.declarationList.declarations.length !== 1 ||
    returned === undefined ||
    !ts.isReturnStatement(returned) ||
    returned.expression === undefined
  )
    return;
  const binding = declaration.declarationList.declarations[0];
  if (binding === undefined || !ts.isIdentifier(binding.name) || binding.initializer === undefined)
    return;
  const initial = unwrap(binding.initializer);
  const result = unwrap(returned.expression);
  if (
    !ts.isConditionalExpression(initial) ||
    !named(initial.condition, regional.name.text) ||
    decimal(initial.whenFalse) !== "1" ||
    !ts.isConditionalExpression(result)
  )
    return;
  const condition = result.condition;
  if (
    !ts.isBinaryExpression(condition) ||
    condition.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken ||
    !ts.isStringLiteral(condition.left) ||
    condition.left.text !== "priority" ||
    !named(condition.right, mode.name.text)
  )
    return;
  const sum = unwrap(result.whenTrue);
  if (!ts.isBinaryExpression(sum) || sum.operatorToken.kind !== ts.SyntaxKind.PlusToken) return;
  const delta = unwrap(sum.right);
  if (
    !ts.isBinaryExpression(delta) ||
    delta.operatorToken.kind !== ts.SyntaxKind.MinusToken ||
    !named(delta.left, binding.name.text) ||
    decimal(delta.right) !== "1"
  )
    return;
  const regionalFactor = decimal(initial.whenTrue);
  const priorityFactor = decimal(sum.left);
  return regionalFactor === undefined || priorityFactor === undefined
    ? undefined
    : {
        regional: regionalFactor,
        priority: priorityFactor,
        standardLookup: standardLookup(fn, result.whenFalse, mode.name.text, binding.name.text),
      };
}

function calledProperty(expression: ts.Expression, name: string): boolean {
  const value = unwrap(expression);
  if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.CommaToken)
    return calledProperty(value.right, name);
  return ts.isPropertyAccessExpression(value) && value.name.text === name;
}

function standardLookup(
  fn: ts.FunctionExpression,
  expression: ts.Expression,
  mode: string,
  factor: string,
): boolean {
  const product = unwrap(expression);
  if (
    !ts.isBinaryExpression(product) ||
    product.operatorToken.kind !== ts.SyntaxKind.AsteriskToken ||
    !named(product.right, factor)
  )
    return false;
  const fallback = unwrap(product.left);
  if (
    !ts.isBinaryExpression(fallback) ||
    fallback.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken ||
    decimal(fallback.right) !== "1"
  )
    return false;
  const property = unwrap(fallback.left);
  if (!ts.isPropertyAccessExpression(property) || property.name.text !== "factor") return false;
  const lookup = property.expression;
  if (
    !ts.isCallExpression(lookup) ||
    !ts.isPropertyAccessExpression(lookup.expression) ||
    lookup.expression.name.text !== "find" ||
    !ts.isIdentifier(lookup.expression.expression)
  )
    return false;
  const tableName = lookup.expression.expression.text;
  const predicate = lookup.arguments[0];
  if (
    predicate === undefined ||
    !ts.isArrowFunction(predicate) ||
    predicate.parameters.length !== 1 ||
    ts.isBlock(predicate.body)
  )
    return false;
  const parameter = predicate.parameters[0];
  if (parameter === undefined || !ts.isIdentifier(parameter.name)) return false;
  const test = unwrap(predicate.body);
  if (
    !ts.isBinaryExpression(test) ||
    test.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken ||
    !ts.isPropertyAccessExpression(test.left) ||
    test.left.name.text !== "value" ||
    !named(test.left.expression, parameter.name.text) ||
    !named(test.right, mode)
  )
    return false;
  let scope: ts.Node | undefined = fn.parent;
  while (scope !== undefined && !ts.isBlock(scope)) scope = scope.parent;
  if (scope === undefined || !ts.isBlock(scope)) return false;
  const bindings = scope.statements
    .flatMap((statement) =>
      ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : [],
    )
    .filter((binding) => named(binding.name, tableName));
  const values = bindings.length === 1 ? bindings[0]?.initializer : undefined;
  if (values === undefined || !ts.isArrayLiteralExpression(values)) return false;
  const standards = values.elements.filter(
    (entry) =>
      ts.isObjectLiteralExpression(entry) &&
      entry.properties.some(
        (property) =>
          ts.isPropertyAssignment(property) &&
          named(property.name, "value") &&
          ts.isStringLiteral(property.initializer) &&
          property.initializer.text === "standard",
      ),
  );
  const standard = standards[0];
  return (
    standards.length === 1 &&
    standard !== undefined &&
    ts.isObjectLiteralExpression(standard) &&
    standard.properties.some(
      (property) =>
        ts.isPropertyAssignment(property) &&
        named(property.name, "factor") &&
        decimal(property.initializer) === "1",
    )
  );
}

function renderedCells(fn: ts.FunctionDeclaration): boolean {
  const parameter = fn.parameters[0];
  if (
    parameter === undefined ||
    !ts.isObjectBindingPattern(parameter.name) ||
    fn.body?.statements.length !== 2
  )
    return false;
  const parameters = new Map(
    parameter.name.elements.flatMap((element) =>
      element.propertyName !== undefined &&
      ts.isIdentifier(element.propertyName) &&
      ts.isIdentifier(element.name)
        ? [[element.propertyName.text, element.name.text] as const]
        : [],
    ),
  );
  const row = parameters.get("row");
  const mode = parameters.get("mode");
  const regional = parameters.get("regional");
  if (row === undefined || mode === undefined || regional === undefined) return false;
  const declarations = fn.body.statements.flatMap((statement) =>
    ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : [],
  );
  const factors = declarations.filter(
    ({ name, initializer }) =>
      ts.isIdentifier(name) &&
      initializer !== undefined &&
      ts.isCallExpression(initializer) &&
      calledProperty(initializer.expression, "pricingFactor") &&
      initializer.arguments.length === 2 &&
      initializer.arguments[0] !== undefined &&
      named(initializer.arguments[0], mode) &&
      initializer.arguments[1] !== undefined &&
      named(initializer.arguments[1], regional),
  );
  const factor = factors.length === 1 ? factors[0]?.name : undefined;
  if (factor === undefined || !ts.isIdentifier(factor)) return false;
  let product = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.AsteriskToken &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.name.text === "price" &&
      named(node.right, factor.text)
    )
      product = true;
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(fn.body, visit);
  return (
    product &&
    declarations.some(
      ({ name, initializer }) =>
        initializer !== undefined &&
        named(initializer, row) &&
        ts.isObjectBindingPattern(name) &&
        ["input", "cachedInput", "output"].every((key) =>
          name.elements.some(
            (element) => element.propertyName !== undefined && named(element.propertyName, key),
          ),
        ),
    )
  );
}
