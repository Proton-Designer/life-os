import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listWidgetsCore, type WidgetRow } from "./actions-core";
import { readTool } from "@/lib/mcp/tools/read";
import { readDeenMode, DEEN_DOMAIN } from "@/lib/mcp/deen-gate";
import { localDateString, addDaysToDateString } from "@/lib/date-utils";
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

/**
 * R12 (PROGRAM-PLAN.md): the ONLY place in the widget layer allowed to
 * raise `readTool`'s page size above the MCP route's unconditional
 * PAGE_SIZE=20 — and it is a plain module constant, never read from a
 * widget's `data_source`/`display`. A model authoring a widget has no way
 * to reach this number: it is not part of `DataSource`'s type, not part of
 * any `WidgetDisplay` shape, and `validate.ts` never accepts it as input.
 * 100 is generous headroom over a 60-day sparkline (the kind's own `days`
 * max) at daily granularity, while staying a named, auditable bound rather
 * than "however many the widget asks for."
 */
const WIDGET_RENDER_MAX_ROWS = 100;

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

export interface RenderedProgressAgainstGoal {
  id: string;
  kind: "progress_against_goal";
  title: string;
  /** The raw current value -- possibly a floor, not exact, when `hasMore` is true (see this file's header comment on `ProgressAggregate`'s "sum" case: readTool pages at 20 rows, so a sum over more matching rows than that is honestly a floor). */
  current: number;
  hasMore: boolean;
  goal: number;
  /** 0-100, clamped -- computed from `current` (which may itself be a floor), never re-derived from a second query. */
  percent: number;
}

export interface SparklinePoint {
  /** YYYY-MM-DD, the viewer's own local calendar day -- never a raw Date or a UTC slice (AGENTS.md's rule, made operational by `bucketDateKey` below). */
  date: string;
  value: number;
}

export interface RenderedSparkline {
  id: string;
  kind: "sparkline";
  title: string;
  points: SparklinePoint[];
  /** True when readTool's own WIDGET_RENDER_MAX_ROWS cap means the window may be missing rows -- the chart still renders (never an error for this alone), but the caller should treat the oldest point(s) as a possible floor, same honesty posture as every other kind's `hasMore`. */
  hasMore: boolean;
}

export interface RenderedStreak {
  id: string;
  kind: "streak";
  title: string;
  /**
   * Consecutive local calendar days with a hit, counting backward from the
   * most recent day that HAS one -- which is "today" unless `todayPending`
   * is true, in which case the count runs through yesterday instead (see
   * below). This is never a raw row count -- multiple hits on the same
   * local day collapse to one, via the same `bucketDateKey` day-bucketing
   * every other date-based kind uses.
   */
  streak: number;
  /**
   * True when the viewer's own "today" (`localDateString(now, timezone)`)
   * has no hit yet. Reported separately rather than folded into `streak`
   * as a de-facto 0 -- the day isn't over, so "no streak" would be a lie
   * the same way reporting tomorrow's date would be; the UI can render
   * "4-day streak, today not yet logged" instead of a misleading "0".
   */
  todayPending: boolean;
  /**
   * True only when the backward walk consumed every row `readTool` fetched
   * (up to WIDGET_RENDER_MAX_ROWS) without ever finding a day that breaks
   * the streak, AND the read itself reports `has_more` (more rows exist,
   * further back, that were never fetched). In that case the true streak
   * may be longer than `streak` -- reported as a floor, same honesty
   * convention as every other kind's `hasMore`, never silently rounded up
   * or down. A CONFIRMED miss (a day inside the fetched window with no
   * hit) always stops the count exactly and sets this false, regardless of
   * what `has_more` says -- rows further back than a confirmed break don't
   * matter; the streak already ended.
   */
  hasMore: boolean;
}

export interface RenderedWidgetError {
  id: string;
  kind: WidgetRow["kind"];
  title: string;
  error: string;
}

export type RenderedWidget = RenderedMetricCard | RenderedList | RenderedProgressAgainstGoal | RenderedSparkline | RenderedStreak | RenderedWidgetError;

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Buckets one row's date/timestamp field into a local calendar day —
 * AGENTS.md's rule, made operational. A DATE-ONLY stored value (e.g.
 * "2026-09-08") is how this app's own write paths already compute a
 * calendar date (via `localDateString`/the user's own local day, never
 * `current_date`/UTC) — it is ALREADY the right day and is used AS-IS,
 * never re-parsed through `new Date()`. Doing that would reinterpret an
 * already-local date as a UTC instant and could shift it a day in either
 * direction depending on the viewer's timezone — the exact "inverse bug"
 * AGENTS.md warns a normalizing function can reintroduce. A full
 * timestamp (has a time component, e.g. a `checkin_time`) genuinely needs
 * the viewer's own timezone to resolve to a calendar day, via
 * `localDateString` — never `toISOString().slice(0, 10)`, which is always
 * UTC regardless of the viewer.
 */
function bucketDateKey(rawValue: unknown, timezone: string): string | null {
  if (typeof rawValue !== "string" || !rawValue) return null;
  if (DATE_ONLY_RE.test(rawValue)) return rawValue;
  const parsed = new Date(rawValue);
  if (Number.isNaN(parsed.getTime())) return null;
  return localDateString(parsed, timezone);
}

async function renderOne(supabase: SupabaseClient, userId: string, row: WidgetRow, now: Date, timezone: string): Promise<RenderedWidget> {
  try {
    const readArgs = {
      domain: row.data_source.domain,
      entity: row.data_source.entity,
      filter: row.data_source.filter,
      detail: "full" as const,
    };
    // Only kinds that need to look BACKWARD across many rows to find a
    // trailing window pass a 4th argument at all (sparkline's fixed N-day
    // chart, streak's "how far back does this run" walk) -- every other
    // kind calls readTool exactly as the MCP route itself would (3
    // arguments), so existing call-shape assertions for those kinds stay
    // meaningful rather than needing to know about a parameter they don't use.
    const needsRaisedLimit = row.kind === "sparkline" || row.kind === "streak";
    const outcome = needsRaisedLimit ? await readTool(supabase, userId, readArgs, { maxRows: WIDGET_RENDER_MAX_ROWS }) : await readTool(supabase, userId, readArgs);
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

    if (row.kind === "progress_against_goal") {
      // `row.display` is narrowed to `ProgressAgainstGoalDisplay` here, same mechanism as the metric_card branch above.
      const display = row.display;
      let current: number;
      if (display.aggregate.type === "count") {
        current = items.length;
      } else {
        // "sum" -- derived over the rows readTool ALREADY returned, never a
        // second query. Non-numeric/missing values are skipped, not coerced
        // to 0-contributing NaN, so one malformed row can't zero out the rest.
        const field = display.aggregate.field;
        current = items.reduce((sum, item) => {
          const value = item[field];
          return typeof value === "number" && Number.isFinite(value) ? sum + value : sum;
        }, 0);
      }
      const percent = Math.min(100, Math.round((current / display.goal) * 100));
      return { id: row.id, kind: "progress_against_goal", title: row.title, current, hasMore: payload.has_more, goal: display.goal, percent };
    }

    if (row.kind === "sparkline") {
      // `row.display` is narrowed to `SparklineDisplay` here, same mechanism as above.
      const display = row.display;
      const days = display.days ?? 14;
      const today = localDateString(now, timezone);
      // Oldest -> newest, inclusive of today -- the x-axis of the chart,
      // built independently of which rows actually came back, so a day
      // with zero matching rows renders as a real 0, not a gap.
      const dayKeys: string[] = [];
      for (let i = days - 1; i >= 0; i--) dayKeys.push(addDaysToDateString(today, -i));
      const valueByDay = new Map<string, number>(dayKeys.map((d) => [d, 0]));

      for (const item of items) {
        const dayKey = bucketDateKey(item[display.dateField], timezone);
        if (dayKey === null || !valueByDay.has(dayKey)) continue; // outside the requested window, or unparseable -- never guessed
        if (display.valueField) {
          const raw = item[display.valueField];
          if (typeof raw === "number" && Number.isFinite(raw)) valueByDay.set(dayKey, (valueByDay.get(dayKey) ?? 0) + raw);
        } else {
          valueByDay.set(dayKey, (valueByDay.get(dayKey) ?? 0) + 1);
        }
      }

      const points: SparklinePoint[] = dayKeys.map((date) => ({ date, value: valueByDay.get(date) ?? 0 }));
      return { id: row.id, kind: "sparkline", title: row.title, points, hasMore: payload.has_more };
    }

    if (row.kind === "streak") {
      // `row.display` is narrowed to `StreakDisplay` here, same mechanism as above.
      const display = row.display;
      const hitDays = new Set<string>();
      let oldestFetched: string | null = null;
      for (const item of items) {
        const dayKey = bucketDateKey(item[display.dateField], timezone);
        if (dayKey === null) continue;
        hitDays.add(dayKey);
        if (oldestFetched === null || dayKey < oldestFetched) oldestFetched = dayKey;
      }

      const today = localDateString(now, timezone);
      const todayPending = !hitDays.has(today);
      // The count always runs through the most recent day that HAS a hit --
      // today itself, unless todayPending (today just hasn't happened yet).
      let cursor = todayPending ? addDaysToDateString(today, -1) : today;
      let streak = 0;
      let hasMore = false;
      while (hitDays.has(cursor)) {
        streak++;
        if (oldestFetched !== null && cursor === oldestFetched) {
          // Walked all the way back to the oldest row the fetch actually
          // saw, without ever finding a confirmed miss. Whether the streak
          // truly stops here or continues further back depends entirely on
          // rows this fetch never saw -- which is exactly what readTool's
          // own `has_more` already tells us, so defer to it rather than
          // guessing. A CONFIRMED miss (the while condition going false
          // above, on its own, before reaching this line) always wins
          // instead: rows further back than an actual break don't matter.
          hasMore = payload.has_more;
          break;
        }
        cursor = addDaysToDateString(cursor, -1);
      }

      return { id: row.id, kind: "streak", title: row.title, streak, todayPending, hasMore };
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

export async function renderWidgets(supabase: SupabaseClient, userId: string, slot: WidgetSlot, now: Date, timezone: string): Promise<RenderedWidget[]> {
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
  // Deen Mode OFF: deen-domain widgets render nothing (the rows stay stored;
  // readTool would refuse them anyway, this just avoids an error card).
  const visible = rows.some((r) => r.data_source.domain === DEEN_DOMAIN) && !(await readDeenMode(supabase, userId)) ? rows.filter((r) => r.data_source.domain !== DEEN_DOMAIN) : rows;
  return Promise.all(visible.map((row) => renderOne(supabase, userId, row, now, timezone)));
}
