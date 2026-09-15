import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * In-memory stand-in for `public.user_settings` that models the one shape
 * the P4-23 bug depends on: an UPDATE that matches zero rows is NOT an error
 * in PostgREST — it resolves `{ data: [], error: null }`. A plain chain mock
 * that always resolves `{ error: null }` cannot tell "wrote the row" from
 * "wrote nothing", which is exactly how the silent no-op shipped.
 *
 * Supports only the calls the weekday-baseline writers make:
 *   from("user_settings").upsert(row, { onConflict, ignoreDuplicates })
 *   from("user_settings").update(patch).eq("user_id", id)            (awaitable)
 *   from("user_settings").update(patch).eq("user_id", id).select(cols)
 *
 * `dropInserts: true` makes every insert/upsert resolve success without
 * storing anything (models an insert silently filtered away), so a test can
 * prove the 0-row UPDATE guard fires on its own.
 */
export interface FakeUserSettingsDb {
  client: SupabaseClient;
  rows: Map<string, Record<string, unknown>>;
}

const DEFAULT_ROW = {
  daily_new_limit: 5,
  notification_enabled: true,
  notification_time: "19:00",
  desired_retention: 0.9,
  ai_grading_enabled: true,
  session_target_minutes: 8,
  weekday_baselines: null,
};

export function makeFakeUserSettingsDb(opts: { existingUserIds?: string[]; dropInserts?: boolean } = {}): FakeUserSettingsDb {
  const rows = new Map<string, Record<string, unknown>>();
  for (const id of opts.existingUserIds ?? []) rows.set(id, { user_id: id, ...DEFAULT_ROW });

  const from = (table: string) => {
    if (table !== "user_settings") throw new Error(`fake db: unexpected table ${table}`);
    return {
      upsert(row: Record<string, unknown>, o?: { onConflict?: string; ignoreDuplicates?: boolean }) {
        const id = row.user_id as string;
        if (!opts.dropInserts) {
          const existing = rows.get(id);
          if (!existing) rows.set(id, { ...DEFAULT_ROW, ...row });
          else if (!o?.ignoreDuplicates) rows.set(id, { ...existing, ...row });
        }
        return Promise.resolve({ data: null, error: null });
      },
      update(patch: Record<string, unknown>) {
        return {
          eq(col: string, val: unknown) {
            if (col !== "user_id") throw new Error(`fake db: unexpected eq column ${col}`);
            const run = () => {
              const existing = rows.get(val as string);
              if (!existing) return [];
              const next = { ...existing, ...patch };
              rows.set(val as string, next);
              return [next];
            };
            let done: Record<string, unknown>[] | null = null;
            const once = () => (done ??= run());
            return {
              select(cols?: string) {
                const matched = once();
                const pick = (r: Record<string, unknown>) =>
                  cols ? Object.fromEntries(cols.split(",").map((c) => [c.trim(), r[c.trim()]])) : r;
                return Promise.resolve({ data: matched.map(pick), error: null });
              },
              then(resolve: (v: { data: null; error: null }) => unknown, reject?: (e: unknown) => unknown) {
                try {
                  once();
                  return Promise.resolve({ data: null, error: null }).then(resolve, reject);
                } catch (e) {
                  return Promise.reject(e).then(undefined, reject);
                }
              },
            };
          },
        };
      },
    };
  };

  return { client: { from } as unknown as SupabaseClient, rows };
}
