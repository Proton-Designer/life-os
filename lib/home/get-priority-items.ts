import { createClient } from "@/lib/supabase/server";
import { calculatePrayerTimes, type CalcMethod, type AsrMadhab } from "@/lib/prayer-times/calculate";
import type { PriorityItem, Domain } from "./types";

const PRAYER_NAMES = ["fajr", "dhuhr", "asr", "maghrib", "isha"] as const;
type PrayerName = (typeof PRAYER_NAMES)[number];

const RIGHT_NOW_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours, per Task 4.2

const DOMAIN_PRIORITY: Record<Domain, number> = {
  deen: 0,
  business: 1,
  school: 2,
  co_op: 2,
  fitness: 3,
};

export type HomeProfile = {
  location_lat: number | null;
  location_lng: number | null;
  timezone: string;
  prayer_calc_method: string;
  asr_madhab: string;
};

export type HomePrayerRow = { id: string; prayer_name: string; status: string };
export type HomeAdhkarRow = { id: string; period: string; completed: boolean };
export type HomeKillListRow = { id: string; text: string; completed: boolean; position: number };
export type HomeTaskRow = {
  id: string;
  domain: "school" | "co_op";
  title: string;
  due_date: string | null;
  due_time: string | null;
  completed: boolean;
};

export type HomeDataSource = {
  getProfile: (userId: string) => Promise<HomeProfile | null>;
  getPrayers: (userId: string, date: string) => Promise<HomePrayerRow[]>;
  getAdhkarLogs: (userId: string, date: string) => Promise<HomeAdhkarRow[]>;
  getKillListItems: (userId: string, date: string) => Promise<HomeKillListRow[]>;
  getTasks: (userId: string, date: string) => Promise<HomeTaskRow[]>;
};

function defaultDataSource(): HomeDataSource {
  return {
    async getProfile(userId) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("profiles")
        .select("location_lat, location_lng, timezone, prayer_calc_method, asr_madhab")
        .eq("user_id", userId)
        .maybeSingle();
      return data ?? null;
    },
    async getPrayers(userId, date) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("prayers")
        .select("id, prayer_name, status")
        .eq("user_id", userId)
        .eq("date", date);
      return data ?? [];
    },
    async getAdhkarLogs(userId, date) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("adhkar_logs")
        .select("id, period, completed")
        .eq("user_id", userId)
        .eq("date", date);
      return data ?? [];
    },
    async getKillListItems(userId, date) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("kill_list_items")
        .select("id, text, completed, position")
        .eq("user_id", userId)
        .eq("date", date)
        .order("position", { ascending: true });
      return data ?? [];
    },
    async getTasks(userId, date) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("tasks")
        .select("id, domain, title, due_date, due_time, completed")
        .eq("user_id", userId)
        .eq("due_date", date);
      return (data ?? []) as HomeTaskRow[];
    },
  };
}

/** YYYY-MM-DD for `now` in the given IANA timezone (day boundary = midnight local, per spec). */
export function localDateString(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function localWeekday(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long" }).format(now);
}

/** Resolves a local "HH:MM" clock time on `dateStr` (in `timezone`) to a UTC Date. */
function resolveLocalTime(dateStr: string, timeStr: string, timezone: string): Date {
  // Binary-search the UTC offset for this timezone/date rather than hardcoding
  // DST rules — Intl.DateTimeFormat with timeZoneName gives the true offset.
  const [h, m] = timeStr.split(":").map(Number);
  const naiveUtc = new Date(`${dateStr}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
  const offsetMinutes = getTimezoneOffsetMinutes(naiveUtc, timezone);
  return new Date(naiveUtc.getTime() - offsetMinutes * 60_000);
}

function getTimezoneOffsetMinutes(date: Date, timezone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = dtf.formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  );
  return (asUtc - date.getTime()) / 60_000;
}

function urgencyBucket(dueAt: Date | null, now: Date): "right_now" | "later_today" {
  if (!dueAt) return "later_today";
  return dueAt.getTime() - now.getTime() <= RIGHT_NOW_WINDOW_MS ? "right_now" : "later_today";
}

export async function getPriorityItems(
  userId: string,
  now: Date,
  dataSource: HomeDataSource = defaultDataSource()
): Promise<PriorityItem[]> {
  const profile = await dataSource.getProfile(userId);
  const timezone = profile?.timezone ?? "UTC";
  const dateStr = localDateString(now, timezone);

  const [prayerRows, adhkarRows, killListRows, taskRows] = await Promise.all([
    dataSource.getPrayers(userId, dateStr),
    dataSource.getAdhkarLogs(userId, dateStr),
    dataSource.getKillListItems(userId, dateStr),
    dataSource.getTasks(userId, dateStr),
  ]);

  const items: Omit<PriorityItem, "date">[] = [];

  // Deen: prayers
  let prayerTimes: Record<PrayerName, Date> | null = null;
  if (profile?.location_lat != null && profile?.location_lng != null) {
    prayerTimes = calculatePrayerTimes({
      date: now,
      lat: profile.location_lat,
      lng: profile.location_lng,
      timezoneOffsetMinutes: getTimezoneOffsetMinutes(now, timezone),
      calcMethod: (profile.prayer_calc_method as CalcMethod) || "MWL",
      asrMadhab: (profile.asr_madhab as AsrMadhab) || "standard",
    });
  }

  const isFriday = localWeekday(now, timezone) === "Friday";
  for (const prayerName of PRAYER_NAMES) {
    const row = prayerRows.find((p) => p.prayer_name === prayerName);
    const status = row?.status ?? "pending";
    if (status !== "pending") continue; // already logged today — not actionable

    const dueAt = prayerTimes ? prayerTimes[prayerName] : null;
    const title = prayerName === "dhuhr" && isFriday
      ? "Jummah"
      : prayerName.charAt(0).toUpperCase() + prayerName.slice(1);

    items.push({
      id: `prayer-${prayerName}`,
      domain: "deen",
      title,
      dueAt,
      urgencyBucket: urgencyBucket(dueAt, now),
      completed: false,
      actionType: "toggle_prayer",
      actionRefId: prayerName,
    });
  }

  // Deen: adhkar (morning/evening — no specific due time, per spec)
  for (const period of ["morning", "evening"] as const) {
    const row = adhkarRows.find((a) => a.period === period);
    if (row?.completed) continue;
    items.push({
      id: `adhkar-${period}`,
      domain: "deen",
      title: period === "morning" ? "Morning adhkar" : "Evening adhkar",
      dueAt: null,
      urgencyBucket: "later_today",
      completed: false,
      actionType: "toggle_adhkar",
      actionRefId: period,
    });
  }

  // Business: kill list, rolled into a single item per spec
  const incompleteKillList = killListRows.filter((k) => !k.completed);
  if (incompleteKillList.length > 0) {
    const next = incompleteKillList[0];
    items.push({
      id: "kill-list",
      domain: "business",
      title:
        incompleteKillList.length === 1
          ? next.text
          : `${incompleteKillList.length} kill-list items remaining`,
      dueAt: null,
      urgencyBucket: "later_today",
      completed: false,
      actionType: "toggle_kill_list",
      actionRefId: next.id,
    });
  }

  // School / Co-op: tasks due today
  for (const task of taskRows) {
    if (task.completed || !task.due_date) continue;
    const dueAt = task.due_time ? resolveLocalTime(task.due_date, task.due_time, timezone) : null;
    items.push({
      id: `task-${task.id}`,
      domain: task.domain,
      title: task.title,
      dueAt,
      urgencyBucket: urgencyBucket(dueAt, now),
      completed: false,
      actionType: "toggle_task",
      actionRefId: task.id,
    });
  }

  // NOTE: today's scheduled-but-unlogged workout (Fitness) is intentionally not
  // included yet — PriorityItem.actionType has no workout-logging case, and
  // Task 4.2's toggleItem (which this type is shared with) doesn't either.
  // Wiring it requires Phase 7's logWorkout action to exist first. Documented
  // as a deferred gap in PROJECT_STATUS.md, to revisit in Phase 7.

  items.sort((a, b) => {
    if (a.urgencyBucket !== b.urgencyBucket) {
      return a.urgencyBucket === "right_now" ? -1 : 1;
    }
    const aTime = a.dueAt?.getTime() ?? Infinity;
    const bTime = b.dueAt?.getTime() ?? Infinity;
    if (aTime !== bTime) return aTime - bTime;
    return DOMAIN_PRIORITY[a.domain] - DOMAIN_PRIORITY[b.domain];
  });

  return items.map((item) => ({ ...item, date: dateStr }));
}

/**
 * Today's YYYY-MM-DD in the user's profile timezone — for callers (e.g. the
 * domain pulse rings) that need "today" independent of whether any
 * PriorityItem exists to read `.date` off of (the empty/all-clear state).
 */
export async function getTodayDateString(
  userId: string,
  now: Date,
  dataSource: Pick<HomeDataSource, "getProfile"> = defaultDataSource()
): Promise<string> {
  const profile = await dataSource.getProfile(userId);
  return localDateString(now, profile?.timezone ?? "UTC");
}
