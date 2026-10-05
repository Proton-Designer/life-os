import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { widgetsForDomain, findWidget } from "./registry";

/**
 * WIDGET-01 -- per-user page-layout persistence. Every function here is
 * scoped to the caller's own `userId` (never a caller-supplied one for
 * anyone else's rows) via BOTH an explicit `.eq("user_id", userId)` and
 * this table's own owner-only RLS -- same double-scoping discipline every
 * other action in this codebase already uses.
 */

export interface LayoutItem {
  widgetKey: string;
  label: string;
  description: string;
  position: number;
  hidden: boolean;
  /** Present on a cross-domain widget (e.g. Work's pipeline on the Business page): the domain it natively belongs to. */
  fromDomain?: string;
}

interface StoredRow {
  widget_key: string;
  position: number;
  hidden: boolean;
}

/**
 * Defaults without rows: a user who never customised `domainKey` gets the
 * registry's own default order, all visible. A stored row overrides
 * position/hidden for its own widgetKey; a stored key that no longer
 * exists in the registry (a retired widget) is silently FILTERED here,
 * never rendered and never an error -- see the module header on why it is
 * never deleted from the table either.
 */
export async function getLayoutCore(supabase: SupabaseClient, userId: string, domainKey: string): Promise<LayoutItem[]> {
  // A retired widget (the page no longer renders it) is not offered in the manager; its key stays valid for saved layouts.
  const registered = widgetsForDomain(domainKey).filter((w) => !w.retired);
  if (registered.length === 0) return [];

  const { data, error } = await supabase
    .from("page_layout_widgets")
    .select("widget_key, position, hidden")
    .eq("user_id", userId)
    .eq("domain_key", domainKey);
  if (error) throw error;

  const stored = new Map<string, StoredRow>((data ?? []).map((r) => [r.widget_key as string, r as StoredRow]));

  return registered
    .map((w) => {
      const row = stored.get(w.widgetKey);
      return {
        widgetKey: w.widgetKey,
        label: w.label,
        description: w.description,
        position: row?.position ?? w.defaultPosition,
        // A cross-domain widget starts OFF until the person adds it; a stored row always wins.
        hidden: row?.hidden ?? w.defaultHidden ?? false,
        ...(w.fromDomain ? { fromDomain: w.fromDomain } : {}),
      };
    })
    .sort((a, b) => a.position - b.position);
}

export interface SaveLayoutItem {
  widgetKey: string;
  position: number;
  hidden: boolean;
}

/**
 * Applies a full desired layout for one domain in ONE statement -- a
 * single `.upsert()` IS a single `INSERT ... ON CONFLICT` statement,
 * genuinely atomic (Postgres's own guarantee), so a partially-applied
 * layout is structurally impossible without a custom RPC.
 *
 * Rejects the WHOLE call if any `widgetKey` doesn't belong to `domainKey`
 * in the registry -- a stale client (an old registry snapshot, or a
 * tampered request) must never be able to write an arbitrary key into
 * this table. A widget the registry knows about but this call simply
 * doesn't mention is left untouched (keeps whatever was previously
 * stored, or the registry default if nothing was) -- callers are expected
 * to submit the full layout they know about, but a partial submission is
 * a no-op for the widgets it omits, never an error.
 */
export async function saveLayoutCore(supabase: SupabaseClient, userId: string, domainKey: string, items: readonly SaveLayoutItem[]): Promise<void> {
  for (const item of items) {
    if (findWidget(domainKey, item.widgetKey) === undefined) {
      throw new Error(`Unknown widget "${item.widgetKey}" for domain "${domainKey}".`);
    }
  }
  if (items.length === 0) return;

  const rows = items.map((item) => ({
    user_id: userId,
    domain_key: domainKey,
    widget_key: item.widgetKey,
    position: item.position,
    hidden: item.hidden,
  }));
  const { error } = await supabase.from("page_layout_widgets").upsert(rows, { onConflict: "user_id,domain_key,widget_key" });
  if (error) throw error;
}
