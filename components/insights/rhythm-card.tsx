import { Panel } from "@/components/ui/panel";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { addDaysToDateString, formatHHMM12, localDateString } from "@/lib/date-utils";
import { isOptInFeatureOnForRequest } from "@/lib/opt-in-guard";
import { getDayStartsForRange } from "@/lib/day-structure/day-start";
import { getEveningClosesForRange } from "@/lib/day-structure/closed-day";
import { getWindDownSettingsCore } from "@/lib/rhythm/wind-down-core";
import { closeVsBedtime, wakeSpread, MIN_POINTS } from "@/lib/rhythm/insights";

const WINDOW_DAYS = 14;

/**
 * Insights "Rhythm" (IA-P4a, opt-in with the Sleep plan): how steady the wake time is (from Start
 * Day marks) and whether the evening close finished by the planned bedtime. Counts and spreads
 * over the last 14 days — no score, no streak — and an honest empty state under 3 data points.
 * Renders nothing when the Sleep plan is OFF; the data is never touched.
 */
export async function RhythmCard() {
  if (!(await isOptInFeatureOnForRequest("sleep_plan"))) return null;
  const user = await getAuthedUser();
  if (!user) return null;
  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const today = localDateString(new Date(), timezone);
  const start = addDaysToDateString(today, -(WINDOW_DAYS - 1));
  const end = addDaysToDateString(today, 1);
  const supabase = await createClient();
  const [starts, closes, plan] = await Promise.all([
    getDayStartsForRange(supabase, user.id, start, end),
    getEveningClosesForRange(supabase, user.id, start, end),
    getWindDownSettingsCore(supabase, user.id),
  ]);
  const wake = wakeSpread([...starts.values()], timezone);
  const close = closeVsBedtime([...closes.values()], plan.plan?.bedtime ?? null, timezone);

  return (
    <Panel title="Rhythm" data-testid="rhythm-card">
      <div className="space-y-3 text-sm">
        {wake ? (
          <p>
            <span className="font-medium">Wake time:</span> usually around {formatHHMM12(wake.median)}, between {formatHHMM12(wake.earliest)} and {formatHHMM12(wake.latest)} ({wake.spreadMinutes} min spread over {wake.n} mornings).
          </p>
        ) : (
          <p className="text-muted-foreground">Wake time: needs {MIN_POINTS} mornings with Start day tapped in the last {WINDOW_DAYS} days.</p>
        )}
        {!plan.plan ? (
          <p className="text-muted-foreground">Bedtime: set your wake time and sleep need in Settings to compare the close with your bedtime.</p>
        ) : close ? (
          <p>
            <span className="font-medium">Close vs bedtime ({formatHHMM12(plan.plan.bedtime)}):</span> finished by bedtime on {close.onTime} of {close.n} nights
            {close.medianMinutesLate > 0 ? `, typically ${close.medianMinutesLate} min after` : close.medianMinutesLate < 0 ? `, typically ${Math.abs(close.medianMinutesLate)} min before` : ""}.
          </p>
        ) : (
          <p className="text-muted-foreground">Close vs bedtime: needs {MIN_POINTS} closed days in the last {WINDOW_DAYS} days.</p>
        )}
      </div>
    </Panel>
  );
}
