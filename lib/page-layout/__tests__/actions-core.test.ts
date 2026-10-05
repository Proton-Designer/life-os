import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getLayoutCore, saveLayoutCore } from "../actions-core";

interface FakeRow {
  user_id: string;
  domain_key: string;
  widget_key: string;
  position: number;
  hidden: boolean;
}

/**
 * A real, minimal in-memory table -- not a call-args-only mock -- so
 * "hide preserves data" can be proven against a SEPARATE fake table that
 * this module must never touch, not just asserted from the outside.
 */
function makeDb(initial: FakeRow[] = [], otherTables: Record<string, unknown[]> = {}) {
  const rows: FakeRow[] = [...initial];
  const touchedTables = new Set<string>();

  function tableClient(table: string) {
    touchedTables.add(table);
    if (table !== "page_layout_widgets") {
      // Any OTHER table (a real domain data table, e.g. "identity_habits")
      // is served from its own untouched array and separately recorded in
      // `touchedTables` -- "hide preserves data" is proven below by
      // asserting this module never even reaches for that table, not just
      // by an untouched row surviving by accident.
      const other = otherTables[table] ?? [];
      return {
        select: () => ({ eq: () => Promise.resolve({ data: other, error: null }) }),
      };
    }
    return {
      select: (_cols: string) => ({
        eq: (col1: string, val1: string) => ({
          eq: (col2: string, val2: string) =>
            Promise.resolve({
              data: rows.filter((r) => (r as never)[col1] === val1 && (r as never)[col2] === val2),
              error: null,
            }),
        }),
      }),
      upsert: (newRows: FakeRow[], _opts: { onConflict: string }) => {
        for (const nr of newRows) {
          const idx = rows.findIndex((r) => r.user_id === nr.user_id && r.domain_key === nr.domain_key && r.widget_key === nr.widget_key);
          if (idx >= 0) rows[idx] = nr;
          else rows.push(nr);
        }
        return Promise.resolve({ error: null });
      },
    };
  }

  const client = { from: (table: string) => tableClient(table) } as unknown as SupabaseClient;
  return { client, rows, touchedTables };
}

describe("getLayoutCore -- defaults without rows", () => {
  it("a user with no stored rows gets the registry's own defaults, all visible, in registry order", async () => {
    const { client } = makeDb([]);
    const layout = await getLayoutCore(client, "user-1", "school");
    expect(layout.length).toBeGreaterThan(0);
    expect(layout.every((w) => w.hidden === false)).toBe(true);
    expect(layout.map((w) => w.position)).toEqual(layout.map((w) => w.position).slice().sort((a, b) => a - b));
  });

  it("an unregistered domain returns an empty array, not an error", async () => {
    const { client } = makeDb([]);
    expect(await getLayoutCore(client, "user-1", "not_a_real_domain")).toEqual([]);
  });
});

// IA-P2: Home gained the `rhythm` widget. A layout saved BEFORE it existed must still render (it appears
// visible at its registry position), and one that hides it stays hidden.
describe("getLayoutCore -- a saved Home layout from before the rhythm widget", () => {
  const stored = (widget_key: string, position: number, hidden = false) => ({ user_id: "user-1", domain_key: "home", widget_key, position, hidden });

  it("an old saved layout without `rhythm` still lists it, visible", async () => {
    const { client } = makeDb([stored("now", 3), stored("focus", 4)]);
    const layout = await getLayoutCore(client, "user-1", "home");
    const rhythm = layout.find((w) => w.widgetKey === "rhythm");
    expect(rhythm).toMatchObject({ hidden: false });
    expect(layout.find((w) => w.widgetKey === "now")).toMatchObject({ position: 3 }); // saved rows keep their own
  });

  it("positive control: a layout that hides rhythm keeps it hidden", async () => {
    const { client } = makeDb([stored("rhythm", 1, true)]);
    expect((await getLayoutCore(client, "user-1", "home")).find((w) => w.widgetKey === "rhythm")).toMatchObject({ hidden: true });
  });
});

// IA-P3b: Home gained `weekly_reset` and `habit_checkoffs`; layouts saved before them still render them (visible).
describe("getLayoutCore -- a saved Home layout from before the P3b widgets", () => {
  it("lists weekly_reset and habit_checkoffs visible when the saved rows don't mention them", async () => {
    const { client } = makeDb([{ user_id: "user-1", domain_key: "home", widget_key: "now", position: 3, hidden: false }]);
    const layout = await getLayoutCore(client, "user-1", "home");
    expect(layout.find((w) => w.widgetKey === "weekly_reset")).toMatchObject({ hidden: false });
    expect(layout.find((w) => w.widgetKey === "habit_checkoffs")).toMatchObject({ hidden: false });
  });
});

describe("saveLayoutCore + getLayoutCore -- round trip", () => {
  it("a saved layout is read back exactly, position and hidden both honored", async () => {
    const { client } = makeDb([]);
    await saveLayoutCore(client, "user-1", "school", [
      { widgetKey: "task_list", position: 3, hidden: true },
      { widgetKey: "deadline_risk", position: 0, hidden: false },
    ]);
    const layout = await getLayoutCore(client, "user-1", "school");
    const taskList = layout.find((w) => w.widgetKey === "task_list")!;
    const schoolToday = layout.find((w) => w.widgetKey === "deadline_risk")!;
    expect(taskList).toMatchObject({ position: 3, hidden: true });
    expect(schoolToday).toMatchObject({ position: 0, hidden: false });
  });

  it("a widget never mentioned in a save keeps its registry default -- a partial save is a no-op for what it omits, not an error", async () => {
    const { client } = makeDb([]);
    await saveLayoutCore(client, "user-1", "school", [{ widgetKey: "task_list", position: 5, hidden: true }]);
    const layout = await getLayoutCore(client, "user-1", "school");
    const deadlineRisk = layout.find((w) => w.widgetKey === "deadline_risk")!;
    expect(deadlineRisk.hidden).toBe(false); // untouched, registry default
  });

  it("is atomic in ONE statement -- a single upsert call for the whole submitted layout, not one call per widget", async () => {
    let upsertCalls = 0;
    const rows: FakeRow[] = [];
    const client = {
      from: () => ({
        upsert: (newRows: FakeRow[]) => {
          upsertCalls++;
          rows.push(...newRows);
          return Promise.resolve({ error: null });
        },
      }),
    } as unknown as SupabaseClient;
    await saveLayoutCore(client, "user-1", "school", [
      { widgetKey: "task_list", position: 0, hidden: false },
      { widgetKey: "school_today", position: 1, hidden: false },
      { widgetKey: "deadline_risk", position: 2, hidden: true },
    ]);
    expect(upsertCalls).toBe(1);
    expect(rows.length).toBe(3);
  });
});

describe("hide preserves data -- the user's own key requirement", () => {
  it("hiding a widget never touches the domain table it reads from, and unhiding still shows data written while hidden", async () => {
    // A real domain table (e.g. identity_habits) with a row present BEFORE,
    // DURING, and AFTER the hide -- this module must never reach for it.
    const domainRows = [{ id: "habit-1", label: "Pray Fajr on time" }];
    const { client, touchedTables } = makeDb([], { identity_habits: domainRows });

    // Hide the widget.
    await saveLayoutCore(client, "user-1", "habits", [{ widgetKey: "habit_list", position: 0, hidden: true }]);
    let layout = await getLayoutCore(client, "user-1", "habits");
    expect(layout.find((w) => w.widgetKey === "habit_list")!.hidden).toBe(true);

    // The domain row is untouched -- proven by this module never even
    // querying "identity_habits" (see makeDb's own per-table touch
    // tracking above), not merely by the row happening to still be there.
    expect(touchedTables.has("identity_habits")).toBe(false);
    expect(domainRows).toEqual([{ id: "habit-1", label: "Pray Fajr on time" }]);

    // Unhide -- the widget's own layout state is restored; the underlying
    // data (never touched) was never at risk to begin with.
    await saveLayoutCore(client, "user-1", "habits", [{ widgetKey: "habit_list", position: 0, hidden: false }]);
    layout = await getLayoutCore(client, "user-1", "habits");
    expect(layout.find((w) => w.widgetKey === "habit_list")!.hidden).toBe(false);
    expect(domainRows).toEqual([{ id: "habit-1", label: "Pray Fajr on time" }]);
  });
});

describe("unknown/retired widget keys degrade safely", () => {
  it("getLayoutCore silently filters a stored key no longer in the registry -- never rendered, never throws", async () => {
    const { client } = makeDb([{ user_id: "user-1", domain_key: "school", widget_key: "a_retired_widget", position: 0, hidden: false }]);
    const layout = await getLayoutCore(client, "user-1", "school");
    expect(layout.some((w) => w.widgetKey === "a_retired_widget")).toBe(false);
  });

  it("a widget the registry marks retired is not offered by getLayoutCore, but a saved layout that mentions it still saves (positive control: a live widget IS offered)", async () => {
    const { client } = makeDb([]);
    const layout = await getLayoutCore(client, "user-1", "school");
    const keys = layout.map((w) => w.widgetKey);
    expect(keys).not.toContain("school_today");
    expect(keys).not.toContain("practice_vs_real");
    expect(keys).toContain("task_list");
    expect(layout.find((w) => w.widgetKey === "this_weeks_classes")?.label).toBe("Class schedule");
    await expect(saveLayoutCore(client, "user-1", "school", [{ widgetKey: "school_today", position: 1, hidden: true }])).resolves.not.toThrow();
  });

  it("saveLayoutCore rejects a widgetKey that doesn't belong to the registry for that domain -- never silently accepted", async () => {
    const { client } = makeDb([]);
    await expect(saveLayoutCore(client, "user-1", "school", [{ widgetKey: "not_a_real_widget", position: 0, hidden: false }])).rejects.toThrow();
  });

  it("saveLayoutCore rejects a real widgetKey submitted under the WRONG domain", async () => {
    const { client } = makeDb([]);
    // "habit_list" is registered under "habits", not "school".
    await expect(saveLayoutCore(client, "user-1", "school", [{ widgetKey: "habit_list", position: 0, hidden: false }])).rejects.toThrow();
  });
});

describe("cross-user isolation", () => {
  it("getLayoutCore for user-2 never sees user-1's stored rows", async () => {
    const { client } = makeDb([{ user_id: "user-1", domain_key: "school", widget_key: "task_list", position: 9, hidden: true }]);
    const layout = await getLayoutCore(client, "user-2", "school");
    const taskList = layout.find((w) => w.widgetKey === "task_list")!;
    expect(taskList).toMatchObject({ position: 0, hidden: false }); // user-2's own registry default, not user-1's row
  });

  it("saveLayoutCore always writes under the caller's own userId, never a value from the item payload", async () => {
    const { client, rows } = makeDb([]);
    await saveLayoutCore(client, "user-1", "school", [{ widgetKey: "task_list", position: 0, hidden: false }]);
    expect(rows.every((r) => r.user_id === "user-1")).toBe(true);
  });
});
