import { redirect } from "next/navigation";
import { Sunrise, Clock, Gauge } from "lucide-react";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatTile } from "@/components/ui/stat-tile";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localDateString } from "@/lib/date-utils";
import { getTodayDayStart } from "@/lib/day-structure/day-start";
import { computeDeltaMinutes, computeDeltaSeconds } from "@/lib/day-structure/delta-clock";
import { computeEfficiency } from "@/lib/day-structure/efficiency";
import { getHoursTodayMinutes } from "@/lib/evening-close/hours-today";
import { formatHoursMinutes, hoursOfDailyTarget } from "@/lib/evening-close/format-hours";
import { DeltaClockDisplay } from "@/components/day-structure/delta-clock-display";

/**
 * Merged Today (#36) — "Delta · Hours · Efficiency in one view." The day-
 * at-a-glance screen the rest of Day Structure exists to feed: #33's Start
 * Day tap gives this page a clock to start from, #34 derives Delta from it
 * live, #35 divides today's Hours (lib/evening-close/hours-today.ts, the
 * SAME query the evening close reads — see that file's own header) by
 * Delta to get Efficiency.
 *
 * REACHED FROM: /open's "Start day" tap (app/(app)/open/actions.ts
 * redirects here on success) — that is tap two of the morning open's
 * two-tap budget. Also reachable directly by URL/revisit at any point in
 * the day, which is the point of a "day at a glance" screen: it is not
 * only a morning-ritual redirect target.
 *
 * NO WAKE MARK YET IS A REAL STATE, NOT AN ERROR. A direct visit before
 * Start Day was tapped (a bookmarked URL, or simply not having started the
 * ritual yet today) has nothing to derive Delta or Efficiency from — this
 * renders the same Start Day affordance rather than a "0:00" that would
 * misreport "just woke up" for someone who never marked waking at all.
 */
export default async function MergedTodayPage() {
  const user = await getAuthedUser();
  if (!user) redirect("/login");

  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const now = new Date();
  const today = localDateString(now, timezone);

  const supabase = await createClient();
  const wakeMark = await getTodayDayStart(supabase, user.id, timezone, now);

  if (!wakeMark) {
    return (
      <PageContainer>
        <PageHeader title="Today's shape" />
        <EmptyState
          icon={Sunrise}
          message="Start day hasn't been tapped yet today. Delta, Hours and Efficiency all measure from that moment."
          action={{ label: "Start day", href: "/open" }}
        />
      </PageContainer>
    );
  }

  const deltaMinutes = computeDeltaMinutes(wakeMark.wokeAtIso, now);
  const deltaSeconds = computeDeltaSeconds(wakeMark.wokeAtIso, now);
  const hoursTodayMinutes = await getHoursTodayMinutes(supabase, user.id, today, timezone, now);
  const efficiency = computeEfficiency(hoursTodayMinutes, deltaMinutes);

  return (
    <PageContainer>
      <PageHeader
        title="Today's shape"
        description="Derived from this morning's Start Day tap — nothing here is stored beyond the tap itself."
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile
          icon={Sunrise}
          accent="info"
          label="Delta — awake for"
          value={<DeltaClockDisplay wokeAtIso={wakeMark.wokeAtIso} initialSeconds={deltaSeconds} />}
        />
        <StatTile
          icon={Clock}
          accent="info"
          label="Hours today"
          value={hoursOfDailyTarget(hoursTodayMinutes)}
          delta={{ direction: "flat", text: formatHoursMinutes(hoursTodayMinutes) }}
        />
        <StatTile
          icon={Gauge}
          accent="info"
          label="Efficiency"
          value={efficiency ? `${efficiency.percent}%` : "—"}
        />
      </div>
    </PageContainer>
  );
}
