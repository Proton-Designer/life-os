import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listWidgetsCore, createWidgetCore, updateWidgetCore, archiveWidgetCore, getWidgetCore, type WidgetRow } from "@/lib/widgets/actions-core";
import { validateDataSource, validateDisplay, validateKind, validateSlot } from "@/lib/widgets/validate";
import type { RunMcpToolOutcome } from "../tool-wrapper";

/**
 * `widget_manage(action: "list"|"create"|"update"|"delete", id?, patch?)` —
 * L11/R7's dedicated tool (TOOL-ARCHITECTURE.md §5/§6), NOT routed through
 * the generic `write` dispatch — widgets are their own top-level tool per
 * the architecture memo, same as `scheduler_manage`.
 *
 * Every create/update validates `data_source`/`display` against
 * `lib/mcp/registry.ts`'s own allowlists (lib/widgets/validate.ts) BEFORE
 * ever storing them — a widget cannot be created against an unknown
 * domain/entity, an unfilterable column, or a field outside the entity's
 * `fullColumns`. Rendering (lib/widgets/render.ts) independently calls the
 * real `readTool()` — two layers, not one, so a widget's actual visibility
 * always inherits every fixedFilter/parentFilter/allowlist this registry
 * already enforces, by construction.
 */

export interface WidgetManageArgs {
  action: "list" | "create" | "update" | "delete";
  id?: string;
  patch?: Record<string, unknown>;
}

/** `list` only ever reads; `create`/`update`/`delete` mutate — resolved per-call so list_capabilities' "read"-scoped tokens can still see their own widgets. */
export function resolveWidgetManageScope(action: WidgetManageArgs["action"]): "read" | "write" {
  return action === "list" ? "read" : "write";
}

export function resolveWidgetManageOperation(args: WidgetManageArgs): string {
  return `widget_manage.${args.action}`;
}

function requireId(args: WidgetManageArgs): string {
  if (!args.id) throw new Error("This action requires the top-level `id` of the widget.");
  return args.id;
}

function widgetToItem(row: WidgetRow) {
  return { id: row.id, updated_at: row.updated_at, kind: row.kind, title: row.title, data_source: row.data_source, display: row.display, slot: row.slot, position: row.position, status: row.status };
}

export async function widgetManageTool(supabase: SupabaseClient, userId: string, args: WidgetManageArgs): Promise<RunMcpToolOutcome> {
  const patch = args.patch ?? {};

  switch (args.action) {
    case "list": {
      const slot = patch.slot !== undefined ? validateSlot(patch.slot) : undefined;
      // Archived (MCP-"deleted") widgets are hidden by default, same as any
      // other archived/soft-deleted row elsewhere in this app -- explicit
      // opt-in to see them, e.g. to confirm one really was removed.
      const includeArchived = patch.include_archived === true;
      const rows = await listWidgetsCore(supabase, userId, slot, { includeArchived });
      const items = rows.map(widgetToItem);
      return {
        result: { content: [{ type: "text", text: JSON.stringify({ items }) }], structuredContent: { items } },
        summary: `listed ${items.length} widget(s)`,
      };
    }

    case "create": {
      const kind = validateKind(patch.kind);
      const title = typeof patch.title === "string" && patch.title ? patch.title : (() => { throw new Error("patch.title is required."); })();
      const { dataSource, fullColumns } = validateDataSource(patch.data_source);
      const display = validateDisplay(kind, patch.display, fullColumns);
      const slot = validateSlot(patch.slot);
      const id = await createWidgetCore(supabase, userId, { kind, title, dataSource, display, slot });
      return {
        result: { content: [{ type: "text", text: JSON.stringify({ id }) }], structuredContent: { id, updated_at: null } },
        summary: `created ${kind} widget "${title}"`,
      };
    }

    case "update": {
      const id = requireId(args);
      // `kind` is immutable once created (there's no renderer switch mid-life
      // for a widget) and is NEVER taken from the client's patch — it is the
      // widget's own discriminant, sourced from the stored row, the same way
      // render.ts trusts `row.kind` and never a caller-supplied claim about
      // it. This is the fix for the typing/validation problem this file
      // shipped with: `display` used to be validated against a `kind` the
      // caller could assert arbitrarily (or, if omitted, the call could
      // never succeed at all -- there was no path back to the real kind).
      const existing = await getWidgetCore(supabase, userId, id);
      if (!existing) throw new Error(`No widget with id "${id}".`);

      const update: { title?: string; dataSource?: ReturnType<typeof validateDataSource>["dataSource"]; display?: ReturnType<typeof validateDisplay>; position?: number } = {};
      if (patch.title !== undefined) {
        if (typeof patch.title !== "string" || !patch.title) throw new Error("patch.title must be a non-empty string.");
        update.title = patch.title;
      }

      let fullColumns: string[] | undefined;
      if (patch.data_source !== undefined) {
        const validated = validateDataSource(patch.data_source);
        update.dataSource = validated.dataSource;
        fullColumns = validated.fullColumns;
      }

      if (patch.display !== undefined) {
        // No fresh data_source in this update -- re-validate the widget's
        // EXISTING (unchanged) data_source to get its fullColumns, rather
        // than requiring the caller to resend it just to change display.
        if (!fullColumns) fullColumns = validateDataSource(existing.data_source).fullColumns;
        update.display = validateDisplay(existing.kind, patch.display, fullColumns);
      }

      if (patch.position !== undefined) {
        if (typeof patch.position !== "number" || !Number.isInteger(patch.position)) throw new Error("patch.position must be an integer.");
        update.position = patch.position;
      }
      await updateWidgetCore(supabase, userId, id, update);
      return {
        result: { content: [{ type: "text", text: JSON.stringify({ id }) }], structuredContent: { id, updated_at: null } },
        summary: `updated widget ${id}`,
      };
    }

    case "delete": {
      // A status flip, not a DELETE -- no MCP tool ever hard-deletes a row.
      // See lib/widgets/actions-core.ts's header for the full reasoning
      // (mirrors PROGRAM-PLAN R9's `'unlogged'` prayer status).
      const id = requireId(args);
      const existing = await getWidgetCore(supabase, userId, id);
      if (!existing) throw new Error(`No widget with id "${id}".`);
      await archiveWidgetCore(supabase, userId, id);
      return {
        result: { content: [{ type: "text", text: JSON.stringify({ id }) }], structuredContent: { id, updated_at: null } },
        summary: `archived widget ${id}`,
      };
    }
  }
}
