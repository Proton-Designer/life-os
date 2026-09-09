import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listWidgetsCore, type WidgetRow } from "./actions-core";
import { readTool } from "@/lib/mcp/tools/read";
import type { WidgetSlot } from "./validate";

/**
 * Renders a user's widgets for one slot by calling the REAL `readTool()` —
 * the exact same function `read()` dispatches to over MCP — never a
 * second, hand-rolled query. This is the structural half of "a widget must
 * never be a way to read source_chunks.text": whatever a widget's
 * data_source names, it inherits fixedFilter/parentFilter/fullColumns
 * exactly as a live MCP `read` call would, because it IS that call, not an
 * approximation of it.
 *
 * Per-widget try/catch, deliberately: a widget whose data source has gone
 * stale (the entity was renamed, a parentFilter's named parent was
 * deleted, a column was dropped from an allowlist) must not take the
 * whole Home page down with it — it renders as its own small error state
 * instead, same "never let one bad row break the page" posture as
 * InProgressBanner/getInProgressBooks already use elsewhere on Home.
 */

export interface RenderedMetricCard {
  id: string;
  kind: "metric_card";
  title: string;
  /** Already formatted for display -- e.g. "3", "20+" (when the underlying read's own page cap means the exact count beyond 20 isn't knowable without further pagination -- reported honestly as a floor, never silently wrong), or "—" for an empty/missing value. */
  value: string;
}

export interface RenderedListItem {
  title: string;
  subtitle?: string;
}

export interface RenderedList {
  id: string;
  kind: "list";
  title: string;
  items: RenderedListItem[];
}

export interface RenderedWidgetError {
  id: string;
  kind: WidgetRow["kind"];
  title: string;
  error: string;
}

export type RenderedWidget = RenderedMetricCard | RenderedList | RenderedWidgetError;

async function renderOne(supabase: SupabaseClient, userId: string, row: WidgetRow): Promise<RenderedWidget> {
  try {
    const outcome = await readTool(supabase, userId, {
      domain: row.data_source.domain,
      entity: row.data_source.entity,
      filter: row.data_source.filter,
      detail: "full",
    });
    const payload = outcome.result.structuredContent as { items: Record<string, unknown>[]; has_more: boolean };
    const items = payload.items ?? [];

    if (row.kind === "metric_card") {
      // `row.display` is narrowed to `MetricCardDisplay` here by TypeScript's
      // own control-flow analysis on `row.kind` — `WidgetRow` (lib/widgets/
      // actions-core.ts) is a real discriminated union, not a cast keyed by
      // a sibling field.
      const display = row.display;
      if (display.aggregate === "count") {
        const value = payload.has_more ? `${items.length}+` : String(items.length);
        return { id: row.id, kind: "metric_card", title: row.title, value };
      }
      const raw = items[0]?.[display.field];
      return { id: row.id, kind: "metric_card", title: row.title, value: raw === undefined || raw === null ? "—" : String(raw) };
    }

    // kind === "list" — `row.display` is narrowed to `ListDisplay`, same mechanism as above.
    const display = row.display;
    const limit = display.limit ?? 5;
    const rendered: RenderedListItem[] = items.slice(0, limit).map((item) => ({
      title: String(item[display.titleField] ?? "—"),
      subtitle: display.subtitleField ? String(item[display.subtitleField] ?? "") : undefined,
    }));
    return { id: row.id, kind: "list", title: row.title, items: rendered };
  } catch (e) {
    return { id: row.id, kind: row.kind, title: row.title, error: e instanceof Error ? e.message : "Couldn't load this widget." };
  }
}

export async function renderWidgets(supabase: SupabaseClient, userId: string, slot: WidgetSlot): Promise<RenderedWidget[]> {
  let rows;
  try {
    rows = await listWidgetsCore(supabase, userId, slot);
  } catch {
    // `mcp_widgets` doesn't exist on the live Supabase project until
    // docs/ai-connector/WIDGETS-MIGRATION-NEEDED.md is applied (same
    // situation, same fix, as lib/self-mastery/get-in-progress-books.ts's
    // `books` table) — Home must never break because this migration
    // hasn't landed yet, so this degrades to "no widgets" rather than
    // throwing. Remove this catch once the migration is live and a
    // failure here would mean something real again.
    return [];
  }
  return Promise.all(rows.map((row) => renderOne(supabase, userId, row)));
}
