/**
 * Prints the MCP connector's surface, derived from the live registries — so
 * docs (docs/ai-connector/CAPABILITIES.md, .brain/domains/mcp-connector.md)
 * re-derive counts instead of copying them forward (P4-04).
 *
 *   npx tsx scripts/mcp-surface-counts.ts          # human-readable
 *   npx tsx scripts/mcp-surface-counts.ts --json   # machine-readable
 *
 * Read-only: imports the registries, touches no database and no network.
 * `server-only` is not installed as a real package (vitest aliases it and
 * Next resolves it itself), so this stubs it before the registries load.
 */
import Module from "node:module";
import path from "node:path";
import { readFileSync } from "node:fs";

type ResolveFilename = (request: string, ...rest: unknown[]) => string;
const moduleWithResolver = Module as unknown as { _resolveFilename: ResolveFilename };
const originalResolve = moduleWithResolver._resolveFilename;
const stub = path.join(__dirname, "__server-only-stub.cjs");
moduleWithResolver._resolveFilename = function (request: string, ...rest: unknown[]) {
  if (request === "server-only") return stub;
  return originalResolve.call(this, request, ...rest);
};
require.cache[stub] = { id: stub, filename: stub, loaded: true, exports: {} } as unknown as NodeJS.Module;

async function main() {
  const { REGISTRY } = await import("../lib/mcp/registry");
  const { WRITE_REGISTRY } = await import("../lib/mcp/write-registry");
  const { WIDGET_KINDS } = await import("../lib/widgets/validate");

  const route = readFileSync(path.join(__dirname, "../app/api/mcp/route.ts"), "utf8");
  const tools = [...route.matchAll(/server\.registerTool\(\s*"([a-z_]+)"/g)].map((m) => m[1]);

  const readDomains = Object.values(REGISTRY).map((d) => ({ domain: d.domain, entities: Object.keys(d.entities).length }));
  const writeActions = Object.values(WRITE_REGISTRY).flatMap((d) =>
    Object.values(d.entities).flatMap((e) => Object.values(e.actions).map((a) => ({ key: `${d.domain}.${e.entity}.${a.action}`, schedulable: a.idempotent === true }))),
  );
  const writeDomains = Object.values(WRITE_REGISTRY).filter((d) => Object.values(d.entities).some((e) => Object.keys(e.actions).length > 0));

  const counts = {
    tools,
    read_domains: readDomains.length,
    read_entities: readDomains.reduce((n, d) => n + d.entities, 0),
    read_entities_by_domain: Object.fromEntries(readDomains.map((d) => [d.domain, d.entities])),
    range_filterable_entities: Object.values(REGISTRY).flatMap((d) => Object.values(d.entities)).filter((e) => (e.rangeFilterableColumns ?? []).length > 0).length,
    write_domains: writeDomains.map((d) => d.domain),
    write_actions: writeActions.length,
    schedulable_write_actions: writeActions.filter((a) => a.schedulable).length,
    widget_kinds: [...WIDGET_KINDS],
    lines: {
      "lib/mcp/registry.ts": readFileSync(path.join(__dirname, "../lib/mcp/registry.ts"), "utf8").split("\n").length,
      "lib/mcp/write-registry.ts": readFileSync(path.join(__dirname, "../lib/mcp/write-registry.ts"), "utf8").split("\n").length,
    },
  };

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(counts, null, 2));
    return;
  }
  console.log(`tools (${tools.length}): ${tools.join(", ")}`);
  console.log(`read: ${counts.read_domains} domains, ${counts.read_entities} entities (${counts.range_filterable_entities} range-filterable)`);
  for (const d of readDomains) console.log(`  ${d.domain}: ${d.entities}`);
  console.log(`write: ${writeDomains.length} domains, ${counts.write_actions} actions, ${counts.schedulable_write_actions} schedulable`);
  console.log(`widget kinds: ${counts.widget_kinds.join(", ")}`);
  console.log(`lines: registry.ts ${counts.lines["lib/mcp/registry.ts"]}, write-registry.ts ${counts.lines["lib/mcp/write-registry.ts"]}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
