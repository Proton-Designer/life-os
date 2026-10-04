import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDomain, listDomains } from "../registry";
import { WRITE_REGISTRY, listWriteActions } from "../write-registry";
import type { RunMcpToolOutcome } from "../tool-wrapper";
import { ToolInputError } from "../tool-input-error";
import { assertDeenAvailable } from "../deen-gate";
import { buildAccountMap, toAccountMapWire } from "@/lib/agent-api/account-map";
import { ACTIONS_REQUIRING_ID, writeActionKey } from "@/lib/agent-api/write-action-meta";
import { WIDGET_DATA_SOURCE_SCHEMA, WIDGET_DISPLAY_SCHEMA, WIDGET_KINDS } from "@/lib/widgets/validate";

/**
 * `list_capabilities(domain?)` — the discovery tool, in two tiers
 * (progressive disclosure, P4-03):
 *
 * - NO domain → the ACCOUNT MAP (lib/agent-api/account-map.ts): the
 *   account's local today/timezone, legacy vs domains mode, which areas it
 *   tracks, the area→domain vocabulary, and per domain one line + read/write
 *   NAMES + active_for_account. Needs this account's data, so it runs on the
 *   RLS-scoped client runMcpTool hands every tool. Kept under ~800 tokens.
 * - A domain → that domain's full detail, a pure in-memory read of the
 *   registries (no DB): entities with fields/filters, and each write action's
 *   description, patch shape, requires_id and schedulable. `widgets` also
 *   names the widget kinds and the display schema widget_manage accepts.
 *
 * Honest by construction: every name comes from REGISTRY / WRITE_REGISTRY
 * live, so a caller that trusts this tool never gets a surprise from
 * read/write. active_for_account ANNOTATES, it never gates (OPEN_QUESTIONS
 * [P4-03]).
 */

/** migration 131's resolved-operation column — "discovery.list_capabilities" or "discovery.<domain>.list_capabilities". */
export function resolveListCapabilitiesOperation(domain?: string): string {
  return domain ? `discovery.${domain}.list_capabilities` : "discovery.list_capabilities";
}

export interface ListCapabilitiesAccountContext {
  userClient: SupabaseClient;
  userId: string;
  now: Date;
}

export async function listCapabilitiesTool(domain?: string, account?: ListCapabilitiesAccountContext): Promise<RunMcpToolOutcome> {
  if (!domain) {
    // An internal wiring failure, not caller input: the route always passes
    // the account. Refusing beats silently serving an account-agnostic list.
    if (!account) throw new Error("list_capabilities() needs the account context to build the account map.");
    const map = await buildAccountMap(account.userClient, account.userId, account.now);
    const wire = toAccountMapWire(map);
    return {
      result: { content: [{ type: "text", text: JSON.stringify(wire) }], structuredContent: { ...wire } },
      summary: `account map: ${map.mode} mode, ${Object.keys(map.domains).length} domain(s)`,
    };
  }

  // P4-07: a domain can now be WRITE-ONLY (day/goals/habits — no read
  // entity anywhere yet, unlike deen.profile/deen.weekly_goal, which are
  // write-only ENTITIES inside an otherwise-readable domain, handled below
  // by `writeOnlyEntities`). `getDomain` only ever sees REGISTRY (read), so
  // a domain that exists ONLY in WRITE_REGISTRY resolves here instead —
  // `readEntities` is `{}` for one of these, which correctly falls every
  // one of its entities into `writeOnlyEntities` below rather than
  // silently disappearing. P4-05 is expected to add real read entities for
  // some of these later; when it does, this code path keeps working
  // unchanged (the domain simply stops being 100% write-only, the same way
  // deen.profile would if a deen-scoped read entity for it ever landed).
  // Deen Mode OFF: the deen domain's detail is not discoverable either.
  if (account) await assertDeenAvailable(account.userClient, account.userId, domain);
  const domainDef = getDomain(domain);
  const writeDomainDef = WRITE_REGISTRY[domain];
  if (!domainDef && !writeDomainDef) {
    const known = new Set([...listDomains().map((d) => d.domain), ...Object.keys(WRITE_REGISTRY)]);
    throw new ToolInputError(`Unknown domain "${domain}". Known domains: ${[...known].join(", ") || "(none yet)"}.`);
  }
  const readEntities = domainDef?.entities ?? {};

  const writeActionDetail = (entity: string) =>
    Object.values(writeDomainDef?.entities[entity]?.actions ?? {}).map((a) => ({
      action: a.action,
      description: a.description,
      patch: a.patchShape,
      requires_id: ACTIONS_REQUIRING_ID.has(writeActionKey(domain, entity, a.action)),
      schedulable: a.idempotent === true,
    }));

  const entities = Object.values(readEntities).map((e) => {
    // "read" is always available once an entity is in this registry at
    // all; "write" + whatever action names exist come from the SEPARATE
    // write-registry (lib/mcp/write-registry.ts) — queried live, not
    // hardcoded, so this list can never drift from what `write` will
    // actually accept.
    const writeActionNames = listWriteActions(domain, e.entity);
    return {
      entity: e.entity,
      description: e.description,
      detail_levels: ["ids", "summary", "full"],
      fields: { summary: e.summaryColumns, full: e.fullColumns },
      filterable_fields: e.filterableColumns,
      range_filterable_fields: e.rangeFilterableColumns ?? [],
      actions: writeActionNames.length > 0 ? ["read", ...writeActionNames.map((a) => `write:${a}`)] : ["read"],
      write_actions: writeActionDetail(e.entity),
    };
  });

  // A write entity with no READ entity in this domain (e.g. deen.profile,
  // whose columns are read via settings.profile -- or, now, EVERY entity of
  // a 100%-write-only domain like day/goals/habits) would otherwise be
  // invisible here, since `entities` above is built from the read registry
  // alone. Generic: any future write-only entity, in a readable domain or a
  // write-only one, lands here automatically (a test checks every
  // WRITE_REGISTRY action is discoverable from some list_capabilities(domain)).
  const writeOnlyEntities = Object.values(writeDomainDef?.entities ?? {})
    .filter((w) => !readEntities[w.entity] && Object.keys(w.actions).length > 0)
    .map((w) => ({
      entity: w.entity,
      note: domainDef ? `Write-only in "${domain}": no read entity under this domain name.` : `"${domain}" has no read coverage at all yet -- every entity here is write-only.`,
      write_actions: writeActionDetail(w.entity),
    }));

  const base = writeOnlyEntities.length > 0 ? { domain, entities, write_only_entities: writeOnlyEntities } : { domain, entities };
  const payload =
    domain === "widgets"
      ? { ...base, widget_kinds: [...WIDGET_KINDS], display_schema: WIDGET_DISPLAY_SCHEMA, data_source_schema: WIDGET_DATA_SOURCE_SCHEMA }
      : base;
  return {
    result: { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload },
    summary: `listed ${entities.length} entit(ies) for domain "${domain}"`,
  };
}
