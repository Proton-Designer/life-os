import type { PlannedItem } from "@/app/(app)/close/actions";
import { formatHoursMinutes } from "@/lib/evening-close/format-hours";
import { dayWonVerdict } from "@/lib/evening-close/day-won";

/**
 * Stage (b) of the evening close: reflect.
 *
 * WHAT THIS RENDERS TODAY, AND WHAT IT DOESN'T. BOSS-VISION §6 lists four
 * things: Hours vs baseline, Day Won, today's three, and thirty-day verdicts
 * on promoted lessons. Hours and today's three are real now; the comparison is
 * not.
 *
 * HOURS IS SHOWN ALONE, WITHOUT A BASELINE (R58). `user_settings.weekday_baselines`
 * arrives in migration 122 and is populated by the rhythm screen. Until a
 * baseline is set the comparison is ABSENT — not zero. Rendering "2:10 / 0:00"
 * against an unset baseline would read as a day massively exceeded, and
 * "0 of 0" as a failed one; both are answers to a question the user has never
 * been asked. Absent is a real state, and this is the fifth place tonight it
 * has mattered.
 *
 * Thirty-day verdicts need promoted lessons, which do not exist yet.
 *
 * EMPTY IS A REAL ANSWER. No ranked rows for today means no plan was made last
 * night — which is the honest thing to reflect on, not a loading state and not
 * an error. It gets its own sentence rather than an empty list.
 */
export function CloseReflectStage({
  todaysThree,
  hoursTodayMinutes,
  weekdayBaselines,
  weekdayIndex,
}: {
  todaysThree: PlannedItem[];
  hoursTodayMinutes: number;
  weekdayBaselines: number[] | null;
  weekdayIndex: number;
}) {
  const done = todaysThree.filter((t) => t.completed).length;
  const verdict = dayWonVerdict(hoursTodayMinutes, weekdayBaselines, weekdayIndex);

  return (
    <section aria-labelledby="close-reflect-heading" className="space-y-4">
      <h2 id="close-reflect-heading" className="text-sm font-medium text-muted-foreground">
        Reflect
      </h2>

      <div className="rounded-lg border p-4">
        <p className="text-sm">
          Hours today <span className="font-medium tabular-nums">{formatHoursMinutes(hoursTodayMinutes)}</span>
        </p>
        {/* Four outcomes. `absent` renders NOTHING extra — the hours line stands
            alone, which is the correct rendering of a question never asked.
            Adding "no baseline set" here would nag someone about a setting on
            the screen meant to close their day. */}
        {verdict.kind === "rest" ? (
          <p className="mt-1 text-xs text-muted-foreground">A rest day. Nothing to beat.</p>
        ) : null}
        {verdict.kind === "won" ? (
          <p className="mt-1 text-xs font-medium text-primary">
            Day won — {verdict.baselineHours}h was the bar.
          </p>
        ) : null}
        {verdict.kind === "short" ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {formatHoursMinutes(verdict.shortByMinutes)} short of {verdict.baselineHours}h.
          </p>
        ) : null}
      </div>

      {todaysThree.length === 0 ? (
        <div className="rounded-lg border p-4">
          <p className="text-sm">No plan was made for today.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Nothing was crowned last night, so there is nothing to hold today against.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border p-4 space-y-3">
          <p className="text-sm">
            {done} of {todaysThree.length} done
          </p>
          <ul className="space-y-2">
            {todaysThree.map((t) => (
              <li key={t.id} className="flex items-start gap-2 text-sm">
                <span
                  aria-hidden
                  className="mt-0.5 w-5 shrink-0 text-xs tabular-nums text-muted-foreground"
                >
                  {t.mitRank === 1 ? "★" : t.mitRank}
                </span>
                <span className={t.completed ? "line-through text-muted-foreground" : undefined}>{t.title}</span>
                <span className="sr-only">
                  {t.mitRank === 1 ? "crowned, " : `rank ${t.mitRank}, `}
                  {t.completed ? "done" : "not done"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
