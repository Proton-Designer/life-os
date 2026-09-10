/**
 * L3's exit-criteria addition (team-lead): "prove it with an actual MCP
 * client, not just unit tests." Everything in app/api/mcp/__tests__ proves
 * the wiring in-process, against mocked Supabase — this script is the
 * genuine article: a real network round trip, from the real
 * `@modelcontextprotocol/sdk` Client, against a REAL deployed
 * app/api/mcp/route.ts, authenticated with a REAL PAT that has to have
 * survived the whole chain (Settings UI -> mcp_access_tokens -> bearer
 * auth -> R4a active-user check -> a locally-signed ES256 JWT that
 * Supabase's JWKS actually accepts -> RLS) to produce any result at all.
 *
 * This is also the FIRST thing in the whole L3 build that can only be run
 * by someone holding a real, live token — which per AGENTS.md's own
 * Playwright-ownership rule and this program's coordination note, is the
 * lead, not an agent. Not run from here; authored for the lead to run.
 *
 * Usage:
 *   npx tsx scripts/mcp-protocol-check.ts <url> <bearer-token>
 * or, reading both from the environment (.env.local via dotenv, same
 * convention as scripts/item7-run.ts):
 *   MCP_URL=https://.../api/mcp MCP_PAT=lifeos_pat_... npx tsx scripts/mcp-protocol-check.ts
 *
 * What it proves, in order, against the real server:
 *   1. connect() completes — the initialize handshake + bearer auth succeeded.
 *      (Auth failing here throws before step 2 ever runs — see the catch
 *      block's explicit note on what a failure at THIS step means.)
 *   2. listTools() includes every tool in REQUIRED_TOOLS below — a SUBSET
 *      check, not an exact-match one. This used to assert the list equalled
 *      exactly ["list_capabilities","read"], which broke the moment `write`
 *      shipped and stayed broken through `widget_manage`/`scheduler_manage` —
 *      an exact-match assertion on a growing surface is a check that fails
 *      every time the surface succeeds. Pinning the ones this script itself
 *      calls (below) while tolerating more is the actual invariant worth
 *      proving here.
 *   3. list_capabilities() (no domain) names "deen" as a known domain.
 *   4. list_capabilities({domain:"deen"}) names "prayer" as a known entity.
 *   5. read({domain:"deen", entity:"prayer"}) returns a real {items,
 *      has_more, cursor} shape — items may be empty for a fresh account,
 *      which is a legitimate result, not a failure; the shape is what's
 *      being proven, same as the rest of this script.
 *
 * Exits non-zero on any failure, with the step name, so a failure reads
 * as "step 3 failed: ..." rather than a bare stack trace.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/**
 * The tools THIS SCRIPT actually calls below (`list_capabilities`, `read`)
 * — not the full registered set, which grows independently of this file
 * and would make an exact-match assertion here a check that breaks every
 * time the connector gains a capability. Widen this list only when this
 * script itself starts calling something new, not to "keep it in sync"
 * with app/api/mcp/route.ts's own registrations.
 */
const REQUIRED_TOOLS = ["list_capabilities", "read"] as const;

/**
 * `callTool`'s return type is a union with the multi-round-trip
 * `InputRequiredResult` shape (`toolResult` instead of `content`) — not
 * relevant to either tool here, both of which always return a single text
 * block in one round trip, so this narrows defensively rather than fixing
 * the cast at every call site.
 */
function textOf(result: unknown): string {
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) throw new Error(`Expected a content array, got: ${JSON.stringify(result)}`);
  const block = content[0] as { type?: string; text?: string } | undefined;
  if (!block || block.type !== "text") throw new Error(`Expected a text content block, got: ${JSON.stringify(block)}`);
  if (typeof block.text !== "string") throw new Error("Text content block had no text.");
  return block.text;
}

async function main() {
  const url = process.argv[2] ?? process.env.MCP_URL;
  const token = process.argv[3] ?? process.env.MCP_PAT;
  if (!url || !token) {
    console.error("Usage: npx tsx scripts/mcp-protocol-check.ts <url> <bearer-token>");
    console.error("   or: MCP_URL=... MCP_PAT=... npx tsx scripts/mcp-protocol-check.ts");
    process.exit(2);
  }

  let step = "connect (initialize handshake + bearer auth)";
  try {
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const client = new Client({ name: "mcp-protocol-check", version: "0.1.0" });

    await client.connect(transport);
    console.log(`OK  1. ${step}`);

    step = `listTools() — includes ${JSON.stringify(REQUIRED_TOOLS)}`;
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    const missing = REQUIRED_TOOLS.filter((required) => !names.includes(required));
    if (missing.length > 0) {
      throw new Error(`missing required tool(s) ${JSON.stringify(missing)} — server returned ${JSON.stringify(names)}`);
    }
    console.log(`OK  2. ${step} -> server offers ${JSON.stringify(names)}`);

    step = "list_capabilities() — names 'deen' as a known domain";
    const capsResult = await client.callTool({ name: "list_capabilities", arguments: {} });
    if (capsResult.isError) throw new Error(`tool returned isError: ${textOf(capsResult)}`);
    const caps = JSON.parse(textOf(capsResult)) as { domains: { domain: string }[] };
    if (!caps.domains.some((d) => d.domain === "deen")) throw new Error(`"deen" not in domains: ${JSON.stringify(caps)}`);
    console.log(`OK  3. ${step} -> ${JSON.stringify(caps.domains.map((d) => d.domain))}`);

    step = "list_capabilities({domain:'deen'}) — names 'prayer' as a known entity";
    const deenCapsResult = await client.callTool({ name: "list_capabilities", arguments: { domain: "deen" } });
    if (deenCapsResult.isError) throw new Error(`tool returned isError: ${textOf(deenCapsResult)}`);
    const deenCaps = JSON.parse(textOf(deenCapsResult)) as { entities: { entity: string }[] };
    if (!deenCaps.entities.some((e) => e.entity === "prayer")) throw new Error(`"prayer" not in entities: ${JSON.stringify(deenCaps)}`);
    console.log(`OK  4. ${step} -> ${JSON.stringify(deenCaps.entities.map((e) => e.entity))}`);

    step = "read({domain:'deen', entity:'prayer'}) — real {items, has_more, cursor} shape";
    const readResult = await client.callTool({ name: "read", arguments: { domain: "deen", entity: "prayer" } });
    if (readResult.isError) throw new Error(`tool returned isError: ${textOf(readResult)}`);
    const read = JSON.parse(textOf(readResult)) as { items: unknown[]; has_more: boolean; cursor: string | null };
    if (!Array.isArray(read.items) || typeof read.has_more !== "boolean") {
      throw new Error(`unexpected shape: ${JSON.stringify(read)}`);
    }
    console.log(`OK  5. ${step} -> ${read.items.length} item(s), has_more=${read.has_more}`);

    await client.close();
    console.log("\nALL STEPS PASSED — this PAT's full chain (Settings -> bearer auth -> R4a -> minted ES256 JWT -> RLS) is live.");
    process.exit(0);
  } catch (err) {
    console.error(`\nFAILED at step: ${step}`);
    console.error(err instanceof Error ? err.message : err);
    if (step.startsWith("connect")) {
      console.error(
        "\nA failure at the connect step means the bearer token was rejected BEFORE any tool ran — " +
          "check: is the PAT still valid/not revoked (Settings -> Connectors)? Has R4b's one-time ES256 " +
          "public-key import into Supabase's JWT Signing Keys actually happened yet? Until it has, " +
          "verifyAccessToken/isUserActive can still succeed (no Supabase involved there) but the LATER " +
          "RLS-scoped query inside a tool will fail instead — that would show up as a failure at step 5, " +
          "not here, so a step-1 failure is specifically about the PAT/bearer layer, not the signing key.",
      );
    }
    process.exit(1);
  }
}

main();
