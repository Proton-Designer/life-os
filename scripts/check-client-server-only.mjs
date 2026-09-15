#!/usr/bin/env node
// check-client-server-only.mjs -- catch a "use client" module that (transitively)
// imports a module marked `import "server-only"`.
//
// WHY THIS EXISTS (2026-09-14): tsc and vitest both pass on this bug. Only a real
// `next build` fails, with "'server-only' cannot be imported from a Client Component
// module". It shipped twice in one hour (b63600b habits, 7da1471 school), blocking
// every teammate's deploy. A full build is the true check, but builds can't run
// concurrently in this shared working tree (they share .next/), so this static scan
// is the cheap guard every engineer can run: ~1s, read-only.
//
// RULES MODELLED
//  - A client module is a file whose first statement is "use client".
//  - Runtime imports are followed: `import x from`, `import {a} from`, `import "x"`,
//    `export ... from`, and `import("x")`. Pure type imports are skipped:
//    `import type`, `export type`, and `import { type A, type B }` where EVERY
//    specifier is a type (TypeScript erases those).
//  - Traversal STOPS at a "use server" file: a client importing a server action gets
//    an RPC reference, not the action's module graph. Its own imports are never bundled
//    into the client.
//  - Only repo files are followed ("@/..." and relative paths). node_modules is not.
//
// USAGE: node scripts/check-client-server-only.mjs [--self-test]
// Exit 0 = clean, 1 = violations found (each printed with its full import chain).

import { readFileSync, existsSync, statSync, readdirSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { tmpdir } from "node:os";

const EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs"];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXTS.some((e) => p.endsWith(e)) && !p.includes("__tests__") && !/\.test\.|\.spec\./.test(p)) out.push(p);
  }
  return out;
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

function directive(src) {
  const m = stripComments(src).trimStart().match(/^(['"])use (client|server)\1/);
  return m ? m[2] : null;
}

function isServerOnly(src) {
  return /^\s*import\s+['"]server-only['"]\s*;?/m.test(stripComments(src));
}

function runtimeImports(src) {
  const code = stripComments(src);
  const specs = [];
  const re = /(?:^|\n)\s*(import|export)\s+([\s\S]*?)\s*from\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(code))) {
    const [, kw, clause, spec] = m;
    if (/^type\s/.test(clause)) continue; // import type / export type
    const braces = clause.match(/\{([\s\S]*)\}/);
    const beforeBrace = clause.replace(/\{[\s\S]*\}/, "").replace(/,/g, "").trim();
    if (braces && !beforeBrace) {
      const parts = braces[1].split(",").map((s) => s.trim()).filter(Boolean);
      if (parts.length > 0 && parts.every((p) => p.startsWith("type "))) continue;
    }
    if (kw === "export" && !braces && !/\*/.test(clause)) continue;
    specs.push(spec);
  }
  for (const r of [/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g, /import\(\s*['"]([^'"]+)['"]\s*\)/g]) {
    while ((m = r.exec(code))) specs.push(m[1]);
  }
  return specs;
}

function resolveSpec(root, fromFile, spec) {
  let base;
  if (spec.startsWith("@/")) base = join(root, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null;
  const cands = [base, ...EXTS.map((e) => base + e), ...EXTS.map((e) => join(base, "index" + e))];
  for (const c of cands) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

export function scan(root) {
  const files = ["app", "components", "lib"].flatMap((d) => walk(join(root, d)));
  const cache = new Map();
  const read = (f) => {
    if (!cache.has(f)) cache.set(f, readFileSync(f, "utf8"));
    return cache.get(f);
  };
  const violations = [];
  for (const entry of files) {
    if (directive(read(entry)) !== "client") continue;
    const seen = new Set([entry]);
    const stack = [[entry, [entry]]];
    while (stack.length) {
      const [file, chain] = stack.pop();
      for (const spec of runtimeImports(read(file))) {
        const target = resolveSpec(root, file, spec);
        if (!target || seen.has(target)) continue;
        seen.add(target);
        const src = read(target);
        const nextChain = [...chain, target];
        if (isServerOnly(src)) {
          violations.push(nextChain.map((p) => relative(root, p)));
          continue;
        }
        if (directive(src) === "server") continue;
        stack.push([target, nextChain]);
      }
    }
  }
  return violations;
}

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), "client-server-only-"));
  const w = (p, s) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), s); };
  w("lib/core.ts", 'import "server-only";\nexport const X = 1;\n');
  w("lib/shared.ts", 'import { X } from "./core";\nexport const Y = X;\n');
  w("lib/constants.ts", "export const LABELS = ['a'];\n");
  w("app/actions.ts", '"use server";\nimport { X } from "@/lib/core";\nexport async function act() { return X; }\n');
  w("components/bad-direct.tsx", '"use client";\nimport { X } from "@/lib/core";\n');
  w("components/bad-transitive.tsx", '"use client";\nimport { Y } from "../lib/shared";\n');
  w("components/ok-action.tsx", '"use client";\nimport { act } from "@/app/actions";\n');
  w("components/ok-type.tsx", '"use client";\nimport type { X } from "@/lib/core";\nimport { type X as Z } from "@/lib/core";\nimport { LABELS } from "@/lib/constants";\n');
  w("components/server-comp.tsx", 'import { X } from "@/lib/core";\n');
  const v = scan(dir).map((c) => c[0]).sort();
  rmSync(dir, { recursive: true, force: true });
  const expected = ["components/bad-direct.tsx", "components/bad-transitive.tsx"];
  const ok = JSON.stringify(v) === JSON.stringify(expected);
  console.log(ok ? "self-test PASS: direct + transitive violations caught; server action, type-only and server component allowed"
                 : `self-test FAIL: expected ${JSON.stringify(expected)} got ${JSON.stringify(v)}`);
  return ok;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
  if (process.argv.includes("--self-test")) process.exit(selfTest() ? 0 : 1);
  const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
  const v = scan(root);
  if (v.length === 0) {
    console.log("check-client-server-only: clean — no \"use client\" module reaches a server-only module");
    process.exit(0);
  }
  console.log(`check-client-server-only: ${v.length} violation(s) — these fail \`next build\` though tsc/vitest pass:`);
  for (const chain of v) console.log("  " + chain.join("\n    -> "));
  console.log("  Fix: call a \"use server\" action instead, use `import type`, or move runtime constants to a module without `import \"server-only\"`.");
  process.exit(1);
}
