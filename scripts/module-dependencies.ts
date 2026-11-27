import { dirname, join, normalize } from "node:path";
import ts from "typescript";

/** Local module and resource references, including bounded dynamic resource prefixes. */
export function moduleDependencies(
  file: string,
  source: string,
  mode: "all" | "runtime" = "all",
): string[] {
  const paths: string[] = [];
  const script = file.endsWith(".vue")
    ? [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
        .map((match) => match[1])
        .join("\n")
    : source;
  const tree = ts.createSourceFile(file, script, ts.ScriptTarget.ESNext, true);
  function add(node: ts.Node | undefined): void {
    if (node === undefined) return;
    if (ts.isStringLiteralLike(node)) paths.push(node.text);
    else if (ts.isTemplateExpression(node)) paths.push(node.head.text);
  }
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && (mode === "all" || !node.importClause?.isTypeOnly))
      add(node.moduleSpecifier);
    if (ts.isExportDeclaration(node) && (mode === "all" || !node.isTypeOnly))
      add(node.moduleSpecifier);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
      add(node.arguments[0]);
    if (
      mode === "all" &&
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "URL"
    )
      add(node.arguments?.[0]);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return paths
    .filter((path) => mode === "runtime" || path.startsWith("."))
    .map((path) =>
      path.startsWith(".") ? normalize(join(dirname(file), path.split("?", 1)[0] ?? path)) : path,
    );
}
