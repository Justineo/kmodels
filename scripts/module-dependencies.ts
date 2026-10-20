import { dirname, join, normalize } from "node:path";
import ts from "typescript";

/** Local module and resource references, including bounded dynamic resource prefixes. */
export function moduleDependencies(file: string, source: string): string[] {
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
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
      add(node.arguments[0]);
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "URL"
    )
      add(node.arguments?.[0]);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return paths
    .filter((path) => path.startsWith("."))
    .map((path) => normalize(join(dirname(file), path.split("?", 1)[0] ?? path)));
}
