/**
 * Server Action export scanner for the MCP parity guard (P4-28).
 *
 * Finds every exported async function in a file whose FIRST statement is the
 * `"use server"` directive, under the given roots. Read only by
 * lib/mcp/__tests__/parity.test.ts; never imported by app code.
 *
 * Uses the TypeScript compiler API rather than a regex so that:
 * - a header comment above the directive doesn't hide the file (comments are trivia);
 * - an inline `"use server"` inside a function body (app/login/page.tsx) is not a use-server FILE;
 * - `export const x = async () => …` is caught, not just `export async function x`;
 * - `export { x }` / `export default` inside a use-server file are reported
 *   (as `unsupported`) instead of silently dodging the guard.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export interface ScannedExport {
  /** Repo-relative, forward slashes, e.g. `app/(app)/deen/actions.ts`. */
  file: string;
  name: string;
  /** Manifest key: `${file}#${name}`. */
  key: string;
}

export interface FileScanResult {
  isUseServer: boolean;
  exports: string[];
  /** Export forms the guard can't classify (re-export lists, default exports). */
  unsupported: string[];
}

const SKIP_DIRS = new Set(["node_modules", "__tests__", ".next", "test-stubs"]);

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);
}

function isAsyncInitializer(init: ts.Expression | undefined): boolean {
  if (!init) return false;
  if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) return hasModifier(init, ts.SyntaxKind.AsyncKeyword);
  return false;
}

/** Scan one file's source text. Pure: no filesystem access. */
export function scanSource(fileName: string, source: string): FileScanResult {
  const empty: FileScanResult = { isUseServer: false, exports: [], unsupported: [] };
  if (!source.includes("use server")) return empty;

  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const first = sf.statements[0];
  const isUseServer =
    !!first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === "use server";
  if (!isUseServer) return empty;

  const exports: string[] = [];
  const unsupported: string[] = [];
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && hasModifier(stmt, ts.SyntaxKind.ExportKeyword)) {
      if (hasModifier(stmt, ts.SyntaxKind.DefaultKeyword)) {
        unsupported.push(`export default function${stmt.name ? ` ${stmt.name.text}` : ""}`);
      } else if (stmt.name && hasModifier(stmt, ts.SyntaxKind.AsyncKeyword)) {
        exports.push(stmt.name.text);
      }
    } else if (ts.isVariableStatement(stmt) && hasModifier(stmt, ts.SyntaxKind.ExportKeyword)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && isAsyncInitializer(decl.initializer)) exports.push(decl.name.text);
      }
    } else if (ts.isExportDeclaration(stmt) && !stmt.isTypeOnly) {
      // `export { x }` / `export { x } from "…"` — Next rejects most of these in
      // use-server files, but if one ever compiles it must not bypass the guard.
      const clause = stmt.exportClause;
      if (!clause) unsupported.push("export * from …");
      else if (ts.isNamedExports(clause)) {
        for (const el of clause.elements) if (!el.isTypeOnly) unsupported.push(`export { ${el.name.text} }`);
      } else unsupported.push("export * as … from …");
    } else if (ts.isExportAssignment(stmt)) {
      unsupported.push("export default …");
    }
  }
  return { isUseServer, exports, unsupported };
}

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out);
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts") && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
}

/** Scan `roots` (relative to `repoRoot`) for use-server exports. */
export function scanServerActionExports(
  repoRoot: string,
  roots: readonly string[] = ["app", "lib"],
): { exports: ScannedExport[]; unsupported: { file: string; form: string }[]; filesScanned: number } {
  const files: string[] = [];
  for (const r of roots) {
    const abs = path.join(repoRoot, r);
    if (fs.existsSync(abs)) walk(abs, files);
  }
  const exports: ScannedExport[] = [];
  const unsupported: { file: string; form: string }[] = [];
  let useServerFiles = 0;
  for (const abs of files.sort()) {
    const rel = path.relative(repoRoot, abs).split(path.sep).join("/");
    const result = scanSource(rel, fs.readFileSync(abs, "utf8"));
    if (!result.isUseServer) continue;
    useServerFiles++;
    for (const name of result.exports) exports.push({ file: rel, name, key: `${rel}#${name}` });
    for (const form of result.unsupported) unsupported.push({ file: rel, form });
  }
  return { exports, unsupported, filesScanned: useServerFiles };
}
