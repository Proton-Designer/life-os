import type { PlannedItem } from "@/app/(app)/close/actions";
import { formatHoursMinutes } from "@/lib/evening-close/format-hours";
import { dayWonVerdict } from "@/lib/evening-close/day-won";
import { formatDurationMagnitude } from "@/lib/date-utils";
import { computeEfficiency } from "@/lib/day-structure/efficiency";

/**
 * Stage (b) of the evening close: reflect.
 *
 * WHAT THIS RENDERS TODAY (#38, close-out stats complete). BOSS-VISION §6
 * lists Hours vs baseline, Day Won, today's three, and thirty-day verdicts
 * on promoted lessons. Hours, Day Won, Delta and Efficiency are all real
 * now (Delta/Efficiency landed with Day Structure #33-#36); thirty-day
 * verdicts need promoted lessons, which do not exist yet.
 *
 * HOURS IS SHOWN ALONE WHEN THERE IS NO BASELINE (R58).
 * `user_settings.weekday_baselines` arrives in migration 122 and is
 * populated by the rhythm screen. Until a baseline is set the comparison is
 * ABSENT — not zero. Rendering "2:10 / 0:00" against an unset baseline would
 * read as a day massively exceeded, and "0 of 0" as a failed one; both are
 * answers to a question the user has never been asked.
 *
 * DELTA/EFFICIENCY ARE SHOWN ONLY WHEN A WAKE MARK EXISTS FOR TODAY, same
 * absent-is-not-zero rule: `deltaMinutes === null` means Start Day was never
 * tapped today, not "woke up zero minutes ago". Nagging someone at close time
 * to go tap a morning ritual they skipped is exactly the kind of thing this
 * screen exists to NOT do — it reports what happened, silently omitting what
 * was never asked.
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
  deltaMinutes,
}: {
  todaysThree: PlannedItem[];
  hoursTodayMinutes: number;
  weekdayBaselines: number[] | null;
  weekdayIndex: number;
  /** Minutes since today's Start Day tap (#33/#34). Null = not tapped today. */
  deltaMinutes: number | null;
}) {
  const done = todaysThree.filter((t) => t.completed).length;
  const verdict = dayWonVerdict(hoursTodayMinutes, weekdayBaselines, weekdayIndex);
  const efficiency = deltaMinutes !== null ? computeEfficiency(hoursTodayMinutes, deltaMinutes) : null;

  return (
    <section aria-labelledby="close-reflect-heading" className="space-y-4">
      <h2 id="close-reflect-heading" className="text-sm font-medium text-muted-foreground">
        Reflect
      </h2>

      <div className="rounded-lg border p-4 space-y-3">
        <p className="text-sm">
          Hours today <span className="font-medium tabular-nums">{formatHoursMinutes(hoursTodayMinutes)}</span>
        </p>
        {/* Four outcomes. `absent` renders NOTHING extra — the hours line stands
            alone, which is the correct rendering of a question never asked.
            Adding "no baseline set" here would nag someone about a setting on
            the screen meant to close their day. */}
        {verdict.kind === "rest" ? (
          <p className="text-xs text-muted-foreground">A rest day. Nothing to beat.</p>
        ) : null}
        {verdict.kind === "won" ? (
          <p className="text-xs font-medium text-primary">Day won — {verdict.baselineHours}h was the bar.</p>
        ) : null}
        {verdict.kind === "short" ? (
          <p className="text-xs text-muted-foreground">
            {formatHoursMinutes(verdict.shortByMinutes)} short of {verdict.baselineHours}h.
          </p>
        ) : null}

        {/* Delta/Efficiency — omitted entirely (not "—" or "0%") when Start
            Day was never tapped today, per the header note above. */}
        {deltaMinutes !== null ? (
          <div className="flex items-center gap-4 border-t pt-3 text-sm">
            <p>
              Awake <span className="font-medium tabular-nums">{formatDurationMagnitude(deltaMinutes)}</span>
            </p>
            {efficiency ? (
              <p>
                Efficiency <span className="font-medium tabular-nums">{efficiency.percent}%</span>
              </p>
            ) : null}
          </div>
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
