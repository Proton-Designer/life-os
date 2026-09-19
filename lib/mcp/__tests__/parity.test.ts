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
import { getWriteAction, listAllWriteOps } from "../write-registry";
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

/**
 * scheduler_manage is a dedicated tool, not a WRITE_REGISTRY domain, same
 * posture as widget_manage above. Its action enum lives in
 * lib/mcp/tools/scheduler-manage.ts (SchedulerManageArgs["action"]), which
 * exports no runtime value, so it is mirrored here. Keep in sync.
 */
const SCHEDULER_MANAGE_ACTIONS = ["list", "create", "cancel", "pause"];

/**
 * P4-33: the live MCP write surface, not just the subset a "use server" file
 * happens to wrap. parity-scan.ts can only see Server Action exports, so it
 * is structurally blind to a write op registered directly in
 * write-registry.ts, or exposed only through a dedicated tool like
 * widget_manage/scheduler_manage — this is the exact root cause P4-33 fixes.
 * `list`-style actions are reads, tracked by the read registry, not here.
 */
function liveWriteOps(): string[] {
  return [
    ...listAllWriteOps().map((o) => o.key),
    ...WIDGET_MANAGE_ACTIONS.filter((a) => a !== "list").map((a) => `widgets.widget.${a}`),
    ...SCHEDULER_MANAGE_ACTIONS.filter((a) => a !== "list").map((a) => `scheduler.scheduled_action.${a}`),
  ];
}

/** Every op named by some manifest entry's `mcp:` decision, wherever that entry is keyed. */
function opsDeclaredAsMcp(manifest: Record<string, ParityDecision>): Set<string> {
  const declared = new Set<string>();
  for (const d of Object.values(manifest)) {
    if ("mcp" in d) declared.add(d.mcp);
  }
  return declared;
}

/**
 * P4-33 known debt: live write ops found undeclared when this guard was
 * extended (2026-09-19), reported to the Lead (steward of parity-manifest.ts)
 * for a decision instead of fixed inline here. All 8 originally filed here
 * now carry a manifest decision (2026-09-19) — empty, not deleted, so the
 * same escape hatch exists if a future extension of this guard (a third
 * dedicated tool, say) needs one again. SHRINK-ONLY: remove a line the
 * moment its op gets a real manifest decision — "the P4-33 known-gap
 * allowlist only contains ops that still lack a decision" below fails the
 * moment one hasn't been removed. Never add a new op to this list; a new gap
 * must be resolved with a manifest decision, not grandfathered in.
 */
const KNOWN_UNRESOLVED_P4_33_GAPS = new Set<string>([]);

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
  if (domain === "scheduler" && entity === "scheduled_action") {
    return SCHEDULER_MANAGE_ACTIONS.includes(action) ? null : `scheduler_manage has no action "${action}"`;
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

describe("P4-33: the guard is no longer blind to MCP-only write ops (positive control)", () => {
  it("the live write surface includes real ops from write-registry.ts and from both dedicated tools -- a scan that misses a whole kind must not pass", () => {
    const ops = liveWriteOps();
    expect(ops.length).toBeGreaterThan(90);
    expect(ops).toContain("deen.prayer.log"); // WRITE_REGISTRY, already declared
    expect(ops.some((o) => o.startsWith("widgets.widget."))).toBe(true); // dedicated tool #1
    expect(ops.some((o) => o.startsWith("scheduler.scheduled_action."))).toBe(true); // dedicated tool #2
  });

  it("write-registry.ts itself has no 'use server' directive -- this is WHY the old guard was structurally blind to it", () => {
    const source = fs.readFileSync(path.join(REPO_ROOT, "lib/mcp/write-registry.ts"), "utf8");
    expect(scanSource("lib/mcp/write-registry.ts", source).isUseServer).toBe(false);
    // scanServerActionExports therefore contributes ZERO exports for this file, no matter how many
    // write ops it registers -- confirmed against the real scan, not just this file's own source text.
    const scan = scanServerActionExports(SCAN_ROOT);
    expect(scan.exports.some((e) => e.file === "lib/mcp/write-registry.ts")).toBe(false);
  });

  it("RED FIRST: a fabricated MCP-only write op with no manifest decision is caught by the new check, using only synthetic fixtures", () => {
    // Mirrors the real shape: an op that exists (findable by an enumerator that
    // reads the live registry) but that no Server-Action-only scan could ever
    // see, and that the manifest has no decision for.
    const fakeOps = ["fake_domain.fake_entity.fake_action"];
    const fakeManifestMissingIt: Record<string, ParityDecision> = {};
    const declared = opsDeclaredAsMcp(fakeManifestMissingIt);
    const missing = fakeOps.filter((op) => !declared.has(op) && !(op in fakeManifestMissingIt));
    expect(missing).toEqual(["fake_domain.fake_entity.fake_action"]); // the guard catches it

    // The exact same op, once given a decision either way, is no longer reported.
    const fakeManifestViaMcpField: Record<string, ParityDecision> = { "some/file.ts#wrapper": { mcp: "fake_domain.fake_entity.fake_action" } };
    const fakeManifestViaOwnKey: Record<string, ParityDecision> = { "fake_domain.fake_entity.fake_action": { pending: "P4-05" } };
    for (const manifest of [fakeManifestViaMcpField, fakeManifestViaOwnKey]) {
      const d = opsDeclaredAsMcp(manifest);
      expect(fakeOps.filter((op) => !d.has(op) && !(op in manifest))).toEqual([]);
    }
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

  it("every live write operation has an MCP decision, not only ones a Server Action happens to wrap (P4-33)", () => {
    const declared = opsDeclaredAsMcp(PARITY_MANIFEST);
    const missing = liveWriteOps().filter((op) => !declared.has(op) && !(op in PARITY_MANIFEST) && !KNOWN_UNRESOLVED_P4_33_GAPS.has(op));
    if (missing.length > 0) {
      const lines = missing.map((op) => `  ${JSON.stringify(op)}: { pending: "P4-xx" }, // <- pick the right decision, key by the op itself: no Server Action need wrap it`);
      throw new Error(
        `${missing.length} MCP write operation(s) exist in write-registry.ts or a dedicated write tool (widget_manage, ` +
          `scheduler_manage) but carry no MCP decision anywhere in the manifest. A write op invisible to this check is ` +
          `invisible to the whole guard, not merely unmapped from a Server Action — this is the P4-33 root cause.\n\n` +
          `${HOW_TO_DECIDE}\n\nLines to add (edit the decision):\n${lines.join("\n")}\n`,
      );
    }
  });

  it("the P4-33 known-gap allowlist only contains ops that still lack a decision (shrink-only)", () => {
    const declared = opsDeclaredAsMcp(PARITY_MANIFEST);
    const resolved = [...KNOWN_UNRESOLVED_P4_33_GAPS].filter((op) => declared.has(op) || op in PARITY_MANIFEST);
    if (resolved.length > 0) {
      throw new Error(
        `${resolved.length} op(s) in KNOWN_UNRESOLVED_P4_33_GAPS already have a manifest decision -- remove them from the ` +
          `allowlist in lib/mcp/__tests__/parity.test.ts now that they're resolved:\n${resolved.map((op) => `  ${op}`).join("\n")}\n`,
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

  it("no manifest entry names a Server Action that no longer exists, or an op-name key for an op that doesn't exist (P4-33)", () => {
    // A key is legitimate two ways now, not one: a scanned "use server" export
    // path (the original shape), or a live op name from liveWriteOps() (P4-33's
    // op-name-keyed entries, which can never appear in scannedKeys — that set
    // holds only export paths, by construction). A key matching NEITHER is
    // genuinely stale, exactly as before.
    const liveOps = new Set(liveWriteOps());
    const stale = Object.keys(PARITY_MANIFEST).filter((k) => !scannedKeys.has(k) && !liveOps.has(k));
    if (stale.length > 0) {
      throw new Error(
        `${stale.length} manifest entr(ies) in ${MANIFEST_PATH} name neither an existing "use server" export nor a live write op ` +
          `(renamed, moved, deleted, no longer async/"use server", or a typo'd op name). Remove or re-key them:\n${stale.map((k) => `  ${JSON.stringify(k)}`).join("\n")}\n`,
      );
    }
  });

  it("the stale-key check above still catches a key that is neither a real export nor a real op (P4-33 control)", () => {
    const liveOps = new Set(liveWriteOps());
    const junkKey = "foo.bar.baz";
    expect(scannedKeys.has(junkKey)).toBe(false);
    expect(liveOps.has(junkKey)).toBe(false);
    const wouldBeCaught = !scannedKeys.has(junkKey) && !liveOps.has(junkKey);
    expect(wouldBeCaught).toBe(true);
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

// Helper tests use SYNTHETIC manifests only. Completing a real task (flipping
// its pending entries to mcp) must never break the guard, so nothing here may
// depend on which live entries are still pending.
describe("manifest helpers", () => {
  it("pendingFor lists a task's remaining entries", () => {
    const manifest: Record<string, ParityDecision> = {
      "a.ts#one": { pending: "P4-06" },
      "a.ts#two": { pending: "P4-06", note: "x" },
      "a.ts#three": { mcp: "deen.prayer.log" },
      "b.ts#four": { pending: "P4-07" },
      "b.ts#five": { read_only: true },
    };
    expect(pendingFor("P4-06", manifest)).toEqual(["a.ts#one", "a.ts#two"]);
    expect(pendingFor("P4-07", manifest)).toEqual(["b.ts#four"]);
    expect(pendingFor("P4-08", manifest)).toEqual([]);
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

  it("flipPendingToMcp round-trips a synthetic source until nothing is pending", () => {
    let out = src;
    for (const key of ["app/(app)/deen/actions.ts#logQuranSession", "app/(app)/deen/actions.ts#setWeeklyFocus"]) {
      out = flipPendingToMcp(out, key, "deen.some_entity.some_action");
    }
    expect(out).not.toMatch(/pending:/);
    expect(() => flipPendingToMcp(out, "app/(app)/deen/actions.ts#logQuranSession", "deen.a.b")).toThrow(/not pending/);
  });

  it("the live manifest source keeps the one-entry-per-line format flipPendingToMcp relies on", () => {
    // Structural only: holds whatever each entry's decision currently is.
    const real = fs.readFileSync(path.join(REPO_ROOT, MANIFEST_PATH), "utf8");
    const broken = Object.keys(PARITY_MANIFEST).filter((key) => {
      const escaped = JSON.stringify(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return (real.match(new RegExp(`^\\s*${escaped}: \\{[^\\n]*\\},[ \\t]*$`, "gm")) ?? []).length !== 1;
    });
    if (broken.length > 0) {
      throw new Error(`Keep each PARITY_MANIFEST entry on exactly one line, \`"<key>": { … },\` — these aren't:\n${broken.map((k) => `  ${k}`).join("\n")}`);
    }
  });
});
