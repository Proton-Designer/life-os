// @vitest-environment node
/**
 * MCP parity guard (P4-28). Every exported async function in a "use server"
 * file under app/ and lib/ must carry exactly one MCP decision in
 * lib/mcp/parity-manifest.ts. If this test fails, read its message: it
 * prints the exact lines to add or fix.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXCLUSION_CATEGORIES,
  PARITY_MANIFEST,
  PENDING_TASKS,
  flipPendingToMcp,
  isAllowedPendingTask,
  pendingFor,
  type ParityDecision,
} from "../parity-manifest";
import { scanServerActionExports, scanSource } from "../parity-scan";
import { getWriteAction } from "../write-registry";
import { getDomain, getEntity } from "../registry";

const REPO_ROOT = path.resolve(__dirname, "../../..");
/**
 * Tree to scan. Defaults to this checkout. Set PARITY_SCAN_ROOT to a clean
 * export of a commit (`git archive HEAD app lib | tar -x -C <dir>`) to check
 * committed state when a shared working tree holds other agents' uncommitted
 * Server Actions.
 */
const SCAN_ROOT = process.env.PARITY_SCAN_ROOT ? path.resolve(process.env.PARITY_SCAN_ROOT) : REPO_ROOT;
const MANIFEST_PATH = "lib/mcp/parity-manifest.ts";

/**
 * Optional: the run's board dir (…/board). When set, every `pending` id must
 * have a `<id>-*.md` task file in some column. Unset in a clean checkout,
 * where the run-scoped board doesn't exist.
 */
const BOARD_DIR = process.env.PARITY_BOARD_DIR ? path.resolve(process.env.PARITY_BOARD_DIR) : null;
function boardHasTask(id: string): boolean {
  if (!BOARD_DIR) return true;
  return fs
    .readdirSync(BOARD_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .some((col) => fs.readdirSync(path.join(BOARD_DIR, col.name)).some((f) => f.startsWith(`${id}-`) && f.endsWith(".md")));
}

/**
 * widget_manage is a dedicated tool, not a WRITE_REGISTRY domain. Its action
 * enum lives in app/api/mcp/route.ts (WidgetManageInputSchema) and
 * lib/mcp/tools/widget-manage.ts (WidgetManageArgs["action"]); neither
 * exports a runtime value, so it is mirrored here. Keep in sync.
 */
const WIDGET_MANAGE_ACTIONS = ["list", "create", "update", "delete"];

const HOW_TO_DECIDE = [
  `Add one line per export to PARITY_MANIFEST in ${MANIFEST_PATH}, choosing EXACTLY ONE decision:`,
  `  { mcp: "domain.entity.action" }   an MCP write op in lib/mcp/write-registry.ts already does the same thing`,
  `                                    ("domain.entity.read" for an MCP read entity in lib/mcp/registry.ts)`,
  `  { pending: "P4-xx" }              should be exposed; name the task that will do it: ${Object.keys(PENDING_TASKS).join(", ")},`,
  `                                    or any P4-cov-<id> coverage task on the board (e.g. "P4-cov-P2-05")`,
  `  { excluded: "<category>: <why>" } never exposed; category is one of: ${EXCLUSION_CATEGORIES.join(", ")}`,
  `  { read_only: true }               writes no user data (getter, pure helper, revalidatePath)`,
].join("\n");

function decisionKinds(d: ParityDecision): string[] {
  return (["mcp", "excluded", "read_only", "pending"] as const).filter((k) => k in d);
}

/** Returns null if the op resolves, else why not. */
function resolveMcpOp(op: string): string | null {
  const parts = op.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[a-z_]+$/.test(p))) return `"${op}" is not domain.entity.action`;
  const [domain, entity, action] = parts;
  if (action === "read") return getEntity(domain, entity) ? null : `read entity ${domain}.${entity} is not in REGISTRY`;
  if (domain === "widgets" && entity === "widget") {
    return getDomain("widgets") && WIDGET_MANAGE_ACTIONS.includes(action) ? null : `widget_manage has no action "${action}"`;
  }
  return getWriteAction(domain, entity, action) ? null : `write op ${op} is not in WRITE_REGISTRY`;
}

describe("parity scanner (positive and negative controls)", () => {
  it("finds async function and async const exports in a file whose first statement is 'use server'", () => {
    const src = `// header comment\n/* block */\n"use server";\nimport x from "y";\nexport async function a() {}\nexport const b = async () => {};\nexport function notAsync() {}\nexport type T = string;\nasync function privateOne() {}\n`;
    const r = scanSource("f.ts", src);
    expect(r.isUseServer).toBe(true);
    expect(r.exports).toEqual(["a", "b"]);
    expect(r.unsupported).toEqual([]);
  });

  it("ignores an inline 'use server' inside a function body and a directive that isn't the first statement", () => {
    expect(scanSource("page.tsx", `export default function P() { async function go() { "use server"; } return null; }\nexport async function x() {}`).isUseServer).toBe(false);
    expect(scanSource("f.ts", `import a from "b";\n"use server";\nexport async function x() {}`).isUseServer).toBe(false);
    expect(scanSource("f.ts", `// "use server" in a comment\nexport async function x() {}`).isUseServer).toBe(false);
  });

  it("reports export lists and default exports in a use-server file instead of letting them dodge the guard", () => {
    const r = scanSource("f.ts", `'use server'\nexport { a } from "./a";\nexport type { T } from "./t";\nexport default async function () {}\n`);
    expect(r.unsupported).toEqual(["export { a }", "export default function"]);
  });

  it("the real tree scan finds use-server files (a scan that finds nothing must not pass)", () => {
    const { exports, filesScanned } = scanServerActionExports(SCAN_ROOT);
    expect(filesScanned).toBeGreaterThan(40);
    expect(exports.length).toBeGreaterThan(150);
    expect(exports.map((e) => e.key)).toContain("app/(app)/deen/actions.ts#markPrayer");
  });
});

describe("MCP parity manifest", () => {
  const scan = scanServerActionExports(SCAN_ROOT);
  const scannedKeys = new Set(scan.exports.map((e) => e.key));

  it("every exported Server Action has an MCP decision", () => {
    const missing = scan.exports.filter((e) => !(e.key in PARITY_MANIFEST));
    if (missing.length > 0) {
      const lines = missing.map((e) => `  ${JSON.stringify(e.key)}: { pending: "P4-xx" }, // <- pick the right decision`);
      throw new Error(
        `${missing.length} Server Action export(s) have no MCP decision. An external agent's access to each must be decided before it ships.\n\n` +
          `${HOW_TO_DECIDE}\n\nLines to add (edit the decision):\n${lines.join("\n")}\n`,
      );
    }
  });

  it("no use-server file uses an export form the guard can't classify", () => {
    if (scan.unsupported.length > 0) {
      throw new Error(
        `Use \`export async function name()\` in "use server" files so the MCP parity guard can see each action:\n` +
          scan.unsupported.map((u) => `  ${u.file}: ${u.form}`).join("\n"),
      );
    }
  });

  it("no manifest entry names a Server Action that no longer exists", () => {
    const stale = Object.keys(PARITY_MANIFEST).filter((k) => !scannedKeys.has(k));
    if (stale.length > 0) {
      throw new Error(
        `${stale.length} manifest entr(ies) in ${MANIFEST_PATH} name an export that no longer exists (renamed, moved, deleted, or no longer async/"use server"). ` +
          `Remove or re-key them:\n${stale.map((k) => `  ${JSON.stringify(k)}`).join("\n")}\n`,
      );
    }
  });

  it("every decision is exactly one well-formed shape that resolves", () => {
    const problems: string[] = [];
    for (const [key, d] of Object.entries(PARITY_MANIFEST)) {
      const kinds = decisionKinds(d);
      if (kinds.length !== 1) {
        problems.push(`${key}: has ${kinds.length} decisions (${kinds.join(", ") || "none"}); needs exactly one`);
        continue;
      }
      if ("mcp" in d) {
        const why = resolveMcpOp(d.mcp);
        if (why) problems.push(`${key}: { mcp: "${d.mcp}" } — ${why}. Use an op that exists, or { pending: "P4-xx" } until it does`);
      } else if ("pending" in d) {
        if (!isAllowedPendingTask(d.pending)) {
          problems.push(`${key}: pending "${d.pending}" is not in PENDING_TASKS (${Object.keys(PENDING_TASKS).join(", ")}) and is not a P4-cov-<id>`);
        } else if (BOARD_DIR && !boardHasTask(d.pending)) {
          problems.push(`${key}: pending "${d.pending}" has no task file on the board (${BOARD_DIR})`);
        }
      } else if ("excluded" in d) {
        const category = d.excluded.split(":")[0];
        const reason = d.excluded.slice(category.length + 1).trim();
        if (!(EXCLUSION_CATEGORIES as readonly string[]).includes(category) || !reason) {
          problems.push(`${key}: excluded "${d.excluded}" must be "<category>: <why>" with category in ${EXCLUSION_CATEGORIES.join(", ")}`);
        }
      } else if (d.read_only !== true) {
        problems.push(`${key}: read_only must be exactly true`);
      }
    }
    if (problems.length > 0) throw new Error(`Malformed parity decisions:\n${problems.map((p) => `  ${p}`).join("\n")}\n\n${HOW_TO_DECIDE}`);
  });

  it("decision counts are internally consistent (logged, never pinned)", () => {
    // Counts are derived from the scan, not hard-coded: a new, mapped export
    // keeps this green. An unmapped one leaves the sum short of the total.
    const counts = { total: scan.exports.length, mcp: 0, excluded: 0, read_only: 0, pending: 0 };
    for (const e of scan.exports) {
      const d = PARITY_MANIFEST[e.key];
      if (!d) continue;
      const kinds = decisionKinds(d);
      if (kinds.length === 1) counts[kinds[0] as "mcp" | "excluded" | "read_only" | "pending"]++;
    }
    console.info(`[parity] ${JSON.stringify(counts)} across ${scan.filesScanned} use-server files`);
    expect(counts.total).toBeGreaterThan(150); // an empty or broken scan must not pass
    expect(counts.mcp + counts.excluded + counts.read_only + counts.pending).toBe(counts.total);
  });
});

describe("manifest helpers", () => {
  it("pendingFor lists a task's remaining entries", () => {
    expect(pendingFor("P4-06")).toContain("app/(app)/deen/actions.ts#logQuranSession");
    expect(pendingFor("P4-06")).not.toContain("app/(app)/deen/actions.ts#markPrayer");
  });

  const src = [
    `export const PARITY_MANIFEST = {`,
    `  "app/(app)/deen/actions.ts#logQuranSession": { pending: "P4-06" },`,
    `  "app/(app)/deen/actions.ts#setWeeklyFocus": { pending: "P4-06", note: "x" },`,
    `  "app/(app)/deen/actions.ts#markPrayer": { mcp: "deen.prayer.log" },`,
    `};`,
  ].join("\n");

  it("flipPendingToMcp rewrites exactly the one pending line", () => {
    const out = flipPendingToMcp(src, "app/(app)/deen/actions.ts#setWeeklyFocus", "deen.weekly_focus.set");
    expect(out).toContain(`  "app/(app)/deen/actions.ts#setWeeklyFocus": { mcp: "deen.weekly_focus.set" },`);
    expect(out).toContain(`  "app/(app)/deen/actions.ts#logQuranSession": { pending: "P4-06" },`);
    expect(out.split("\n")).toHaveLength(src.split("\n").length);
  });

  it("flipPendingToMcp refuses a non-pending, missing, or malformed target", () => {
    expect(() => flipPendingToMcp(src, "app/(app)/deen/actions.ts#markPrayer", "deen.prayer.log")).toThrow(/not pending/);
    expect(() => flipPendingToMcp(src, "app/(app)/deen/actions.ts#nope", "deen.x.y")).toThrow(/found 0/);
    expect(() => flipPendingToMcp(src, "app/(app)/deen/actions.ts#logQuranSession", "deen.quran")).toThrow(/domain\.entity\.action/);
  });

  it("flipPendingToMcp works on the real manifest source", () => {
    const real = fs.readFileSync(path.join(REPO_ROOT, MANIFEST_PATH), "utf8");
    const key = pendingFor("P4-06")[0];
    expect(flipPendingToMcp(real, key, "deen.some_entity.some_action")).toContain(`${JSON.stringify(key)}: { mcp: "deen.some_entity.some_action" },`);
  });
});
