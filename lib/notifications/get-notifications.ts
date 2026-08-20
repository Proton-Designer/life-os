import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/supabase/auth";
import { getPriorityItems } from "@/lib/home/get-priority-items";
import { localDateString, dayOfWeekFromDateString } from "@/lib/date-utils";
import type { ActionType, Domain } from "@/lib/home/types";

export type NotificationItem = {
  id: string;
  domain: Domain;
  title: string;
  body: string;
  href: string;
  dueAt: string | null;
};

// Where each PriorityItem action lands once you tap it — every target id
// here must exist as a real DOM anchor (id="...") on the destination page,
// with scroll-mt-20 to clear the sticky topbar. Kept as a lookup rather
// than baked into get-priority-items.ts itself, since that module is
// Home's "what's due right now" list and has no reason to know about
// routing — this is the one place that turns a PriorityItem into "go here
// and do this."
const ACTION_HREF: Record<ActionType, (item: { domain: Domain }) => string> = {
  toggle_prayer: () => "/deen#prayers",
  toggle_kill_list: () => "/business#kill-list",
  toggle_task: (item) => (item.domain === "co_op" ? "/co-op#weekly-agenda" : "/school#tasks"),
  toggle_habit: () => "/deen",
  toggle_adhkar: () => "/deen",
};

const ACTION_BODY: Record<ActionType, string> = {
  toggle_prayer: "Prayer window is open",
  toggle_kill_list: "Today's kill list needs attention",
  toggle_task: "Due today",
  toggle_habit: "Waiting on you today",
  toggle_adhkar: "Waiting on you today",
};

/**
 * Cross-domain "what needs your input" feed for the topbar notification
 * bell. Deliberately NOT persisted — every item here is re-derived from
 * live state on each poll (same pattern as the allocation check-in queue,
 * lib/checkins/allocation-queue-context.tsx), so there is no read/dismiss
 * state to reconcile: an item disappears the moment its underlying cause
 * is resolved (prayer marked, workout confirmed, waist logged), from
 * whichever screen that happens on.
 *
 * Reuses getPriorityItems for Deen/Business/School/Co-op — that's already
 * the canonical "what's due today" computation (Home's "Now" panel). Adds
 * the two Fitness signals that deliberately have no PriorityItem entry
 * (spec 2026-08-20: Fitness confirm can't be a bare blind tap) but still
 * belong in a notification, since a notification opens the real confirm
 * screen rather than completing anything blind.
 *
 * Business's Lock-In pending-hours signal (the allocation check-in queue)
 * is NOT computed here — it lives client-side in AllocationQueueProvider
 * and is merged into the bell's item list directly by NotificationsBell
 * (components/shell/notifications-bell.tsx), not re-derived through this
 * server aggregator. Folding it into this function would mean two
 * independent polls of the same underlying state (this server action's
 * 60s poll and the provider's own 60s poll) computing the same "is there
 * a pending window" answer separately — reading it straight off
 * useAllocationQueue() instead means the bell, the toast, and the (now
 * removed) badge all ever agree, by construction, since they share one
 * poll (2026-08-20, Opus Lead: CheckinQueueBadge returning null at count
 * 0 made the check-in feature invisible 3/4 of the day — the bell
 * replaces it as the persistent surface).
 */
export async function getNotifications(userId: string, now: Date): Promise<NotificationItem[]> {
  const [priorityItems, fitnessItems] = await Promise.all([
    getPriorityItems(userId, now),
    getFitnessNotificationItems(userId, now),
  ]);

  const fromPriority: NotificationItem[] = priorityItems.map((item) => ({
    id: item.id,
    domain: item.domain,
    title: item.title,
    body: ACTION_BODY[item.actionType],
    href: ACTION_HREF[item.actionType](item),
    dueAt: item.dueAt ? item.dueAt.toISOString() : null,
  }));

  const items = [...fromPriority, ...fitnessItems];
  items.sort((a, b) => {
    const aTime = a.dueAt ? Date.parse(a.dueAt) : Infinity;
    const bTime = b.dueAt ? Date.parse(b.dueAt) : Infinity;
    return aTime - bTime;
  });
  return items;
}

async function getFitnessNotificationItems(userId: string, now: Date): Promise<NotificationItem[]> {
  const supabase = await createClient();
  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const dateStr = localDateString(now, timezone);
  const todayDayOfWeek = dayOfWeekFromDateString(dateStr);

  const [{ data: scheduleRow }, { data: waistRow }] = await Promise.all([
    supabase
      .from("workout_schedule")
      .select("workout_id, workout_name")
      .eq("user_id", userId)
      .eq("day_of_week", todayDayOfWeek)
      .maybeSingle(),
    supabase
      .from("body_metrics")
      .select("date")
      .eq("user_id", userId)
      .not("waist_in", "is", null)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const items: NotificationItem[] = [];

  if (scheduleRow?.workout_id) {
    const { data: confirmedRow } = await supabase
      .from("workout_sessions")
      .select("id")
      .eq("user_id", userId)
      .eq("date", dateStr)
      .eq("workout_id", scheduleRow.workout_id)
      .eq("source", "confirmed")
      .maybeSingle();

    if (!confirmedRow) {
      items.push({
        id: "fitness-today-workout",
        domain: "fitness",
        title: scheduleRow.workout_name ?? "Today's workout",
        body: "Not confirmed yet",
        href: "/fitness#sessions",
        dueAt: null,
      });
    }
  }

  const lastWaistDate = waistRow?.date ?? null;
  const daysSinceWaist = lastWaistDate
    ? Math.floor((new Date(`${dateStr}T00:00:00Z`).getTime() - new Date(`${lastWaistDate}T00:00:00Z`).getTime()) / 86_400_000)
    : null;
  if (daysSinceWaist === null || daysSinceWaist >= 14) {
    items.push({
      id: "fitness-waist-due",
      domain: "fitness",
      title: "Waist measurement",
      body: lastWaistDate ? "It's been 2+ weeks since your last one" : "No measurement logged yet",
      href: "/fitness#body",
      dueAt: null,
    });
  }

  return items;
}
