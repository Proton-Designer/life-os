import "server-only";
import { listDomains, getDomain } from "../registry";
import { listWriteActions } from "../write-registry";
import type { RunMcpToolOutcome } from "../tool-wrapper";

/**
 * `list_capabilities(domain?)` — TOOL-ARCHITECTURE.md's discovery tool.
 * "Everything else depends on it being cheap and honest" (team-lead): cheap
 * means it's a pure in-memory read of lib/mcp/registry.ts, no DB call at
 * all; honest means it reports ONLY domains/entities actually wired today
 * (`deen`/`prayer` for L3), never the memo's full eventual matrix — a
 * caller that trusts this tool and then calls `read(domain:"fitness", ...)`
 * must get a clear "unknown domain" error from `read` itself, not a
 * surprise that contradicts what discovery promised.
 *
 * Unlike the other tool in this layer, this one needs no `userId`/RLS at
 * all — the capability list is the same for every account — so it takes
 * no Supabase client and is the cheapest possible tool call by
 * construction, not just by convention.
 */

/** migration 131's resolved-operation column — "discovery.list_capabilities" or "discovery.<domain>.list_capabilities". */
export function resolveListCapabilitiesOperation(domain?: string): string {
  return domain ? `discovery.${domain}.list_capabilities` : "discovery.list_capabilities";
}

export async function listCapabilitiesTool(domain?: string): Promise<RunMcpToolOutcome> {
  if (!domain) {
    const domains = listDomains();
    return {
      result: { content: [{ type: "text", text: JSON.stringify({ domains }) }], structuredContent: { domains } },
      summary: `listed ${domains.length} domain(s)`,
    };
  }

  const domainDef = getDomain(domain);
  if (!domainDef) {
    const known = listDomains().map((d) => d.domain);
    throw new Error(`Unknown domain "${domain}". Known domains: ${known.join(", ") || "(none yet)"}.`);
  }

  const entities = Object.values(domainDef.entities).map((e) => {
    // "read" is always available once an entity is in this registry at
    // all; "write" + whatever action names exist come from the SEPARATE
    // write-registry (lib/mcp/write-registry.ts) — queried live, not
    // hardcoded, so this list can never drift from what `write` will
    // actually accept. deen.prayer genuinely has only "log" (no "unlog" —
    // see write-registry.ts's header and docs/ai-connector/
    // WRITE-DELETE-DECISION.md), and that absence is exactly what this
    // tool must report honestly rather than rounding up to "write".
    const writeActions = listWriteActions(domainDef.domain, e.entity);
    return {
      entity: e.entity,
      description: e.description,
      detail_levels: ["ids", "summary", "full"],
      fields: { summary: e.summaryColumns, full: e.fullColumns },
      filterable_fields: e.filterableColumns,
      actions: writeActions.length > 0 ? ["read", ...writeActions.map((a) => `write:${a}`)] : ["read"],
    };
  });

  const payload = { domain, entities };
  return {
    result: { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload },
    summary: `listed ${entities.length} entit(ies) for domain "${domain}"`,
  };
}
