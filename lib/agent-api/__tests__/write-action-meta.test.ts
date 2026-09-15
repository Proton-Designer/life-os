import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WRITE_REGISTRY } from "@/lib/mcp/write-registry";

/**
 * P4-03 drift guard. `requires_id` and the patch.date default are declared
 * in lib/agent-api/write-action-meta.ts (write-registry.ts is another lane's
 * file tonight), so this test re-derives both facts from write-registry.ts's
 * SOURCE and fails the moment an action is added or changed without the
 * metadata following it. Red first: written before write-action-meta.ts.
 */

type ParsedAction = { requiresId: boolean; requiresDate: boolean };

function parseWriteRegistrySource(): Record<string, ParsedAction> {
  const src = readFileSync(path.join(process.cwd(), "lib/mcp/write-registry.ts"), "utf8");
  const lines = src.slice(src.indexOf("export const WRITE_REGISTRY")).split("\n");
  const out: Record<string, ParsedAction> = {};
  let domain = "";
  let entity = "";
  // The action(s) the current handler source belongs to. Usually one
  // (`action: "log"`), but write-registry also generates a family from one
  // shared handler: `...(["advance", "retreat", "block", "unblock"] as const).reduce(`.
  let current: string[] = [];
  for (const line of lines) {
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^ {4}domain: "([a-z_]+)"/))) domain = m[1];
    if ((m = line.match(/^\s+entity: "([a-z_]+)"/))) entity = m[1];
    let started = false;
    if ((m = line.match(/^\s+action: "([a-z_]+)"/))) {
      current = [m[1]];
      started = true;
    }
    if ((m = line.match(/\.\.\.\(\[([^\]]+)\] as const\)\.reduce\(/))) {
      current = [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
      started = true;
    }
    if (started) {
      for (const a of current) out[`${domain}.${entity}.${a}`] ??= { requiresId: false, requiresDate: false };
    }
    for (const a of current) {
      const key = `${domain}.${entity}.${a}`;
      if (!out[key]) continue;
      if (/requireId\(ctx\)/.test(line)) out[key].requiresId = true;
      if (/requireString\(patch, "date"\)/.test(line)) out[key].requiresDate = true;
    }
  }
  return out;
}

const RUNTIME_KEYS = Object.values(WRITE_REGISTRY).flatMap((d) => Object.values(d.entities).flatMap((e) => Object.keys(e.actions).map((a) => `${d.domain}.${e.entity}.${a}`)));

describe("write-action-meta stays in lockstep with write-registry.ts", () => {
  it("the source parser sees exactly the runtime registry's actions (so the checks below examine something real)", () => {
    const parsed = parseWriteRegistrySource();
    expect(Object.keys(parsed).sort()).toEqual([...RUNTIME_KEYS].sort());
    // Positive controls: known shapes, so a parser that silently matched nothing fails here.
    expect(parsed["work.target.complete"].requiresId).toBe(true);
    expect(parsed["deen.prayer.log"].requiresDate).toBe(true);
    expect(parsed["deen.prayer.log"].requiresId).toBe(false);
  });

  it("ACTIONS_REQUIRING_ID is exactly the set of handlers that call requireId(ctx)", async () => {
    const { ACTIONS_REQUIRING_ID } = await import("../write-action-meta");
    const parsed = parseWriteRegistrySource();
    const fromSource = Object.entries(parsed).filter(([, v]) => v.requiresId).map(([k]) => k).sort();
    expect([...ACTIONS_REQUIRING_ID].sort()).toEqual(fromSource);
  });

  it("every handler that requires patch.date is in EXACTLY ONE of DATE_DEFAULTS_TO_TODAY / DATE_NEVER_DEFAULTED, and nothing else is", async () => {
    const { DATE_DEFAULTS_TO_TODAY, DATE_NEVER_DEFAULTED } = await import("../write-action-meta");
    const parsed = parseWriteRegistrySource();
    const fromSource = Object.entries(parsed).filter(([, v]) => v.requiresDate).map(([k]) => k).sort();
    const declared = [...DATE_DEFAULTS_TO_TODAY, ...Object.keys(DATE_NEVER_DEFAULTED)];
    expect(new Set(declared).size).toBe(declared.length); // no action in both
    expect(declared.sort()).toEqual(fromSource);
  });
});
