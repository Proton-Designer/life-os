import Link from "next/link";
import { AlertCircle, Clock, Gauge, Moon, Sunrise } from "lucide-react";
import { StatTile } from "@/components/ui/stat-tile";
import { Panel } from "@/components/ui/panel";
import { DeltaClockDisplay } from "@/components/day-structure/delta-clock-display";
import { TimeboxedTasks } from "@/components/day-structure/timeboxed-tasks";
import { DayBar } from "@/components/home/day-bar";
import { dayBarRange } from "@/lib/home/day-bar";
import { HOME_DAY_VIEW, type HomeDayView } from "@/lib/home/day-view";
import { DEFAULT_FOCUS_TARGET_MINUTES } from "@/lib/focus/target";
import type { DayRibbonLayout } from "@/lib/home/day-ribbon";
import { LockInHint } from "@/components/home/lock-in-hint";
import { StartDayButton } from "@/components/home/rhythm/start-day-button";
import { ReplanDialog } from "@/components/home/rhythm/replan-dialog";
import { formatHoursMinutes, hoursOfDailyTarget } from "@/lib/evening-close/format-hours";
import type { RhythmData } from "@/lib/home/rhythm-data";

/**
 * Home's day-rhythm section (IA-P2): one card for the phase of the day, chosen by homeRhythmState
 * (lib/home/rhythm-state.ts) -- Morning (last night's three + Start day + Re-plan), the Today strip
 * (Awake for, Hours, Efficiency, timeboxes) after Start Day, "Close the day" from wind-down, and
 * "Done for today" once the day is closed. A Server Component: every prop is plain data.
 */
export function RhythmSection({
  data,
  ribbon = null,
  timezone = "UTC",
  targetMinutes = DEFAULT_FOCUS_TARGET_MINUTES,
  dayView = HOME_DAY_VIEW,
}: {
  data: RhythmData;
  /** The day ribbon's layout (blocks, prayer spans) the Day bar projects onto its own range. */
  ribbon?: DayRibbonLayout | null;
  timezone?: string;
  /** Daily focus target in minutes (HOME-01a's reader; 240 until wired). */
  targetMinutes?: number;
  /** HOME-02: "bar" = Day bar; "classic" = the three tiles (and the separate day's-shape panel, rendered by the page). */
  dayView?: HomeDayView;
}) {
  switch (data.state) {
    case "morning":
      return (
        <Panel title="Good morning" data-testid="rhythm-morning">
          {data.plan.length === 0 ? (
            <div className="rounded-lg border p-4">
              <p className="text-sm">No plan was made last night.</p>
              <p className="mt-1 text-xs text-muted-foreground">Today is open. The close runs this evening.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Last night you chose these.</p>
              <ol className="space-y-2">
                {data.plan.map((t) => {
                  const crowned = t.mit_rank === 1;
                  return (
                    <li key={t.id} className={crowned ? "rounded-lg border-2 border-primary/60 p-3" : "rounded-lg border p-2.5"}>
                      <div className="flex items-start gap-2">
                        <span aria-hidden className="shrink-0 text-sm text-muted-foreground">
                          {crowned ? "★" : t.mit_rank}
                        </span>
                        <span className={crowned ? "text-base font-medium" : "text-sm"}>{t.title}</span>
                      </div>
                      <span className="sr-only">
                        {crowned ? "crowned" : `rank ${t.mit_rank}`}
                        {t.completed ? ", already done" : ""}
                      </span>
                    </li>
                  );
                })}
              </ol>
              {data.diff.changed ? (
                <div role="status" className="flex items-start gap-2 rounded-lg border border-accent-info/30 bg-accent-info/10 p-3 text-sm text-accent-info">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>{data.diff.message}</span>
                </div>
              ) : null}
            </div>
          )}
          <div className="mt-3 flex items-center gap-3">
            <StartDayButton />
            <ReplanDialog />
          </div>
        </Panel>
      );
    case "today": {
      if (dayView === "bar") {
        // DAYBAR-03: the bar is always the whole local day, 12 AM -> 12 AM; Start Day is a marker on it.
        const range = dayBarRange(new Date(data.nowIso), timezone);
        return (
          <div className="flex flex-col gap-3" data-testid="rhythm-today">
            <DayBar
              layout={ribbon}
              wokeAtIso={data.wokeAtIso}
              rangeStartIso={range.start.toISOString()}
              endIso={range.end.toISOString()}
              nowIso={data.nowIso}
              hoursTodayMinutes={data.hoursTodayMinutes}
              targetMinutes={targetMinutes}
              efficiencyPercent={data.efficiencyPercent}
              timezone={timezone}
              localDate={data.localDate}
            />
            <TimeboxedTasks tasks={data.timeboxed} />
          </div>
        );
      }
      return (
        <div className="flex flex-col gap-3" data-testid="rhythm-today">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatTile icon={Sunrise} accent="info" label="Awake for" value={<DeltaClockDisplay wokeAtIso={data.wokeAtIso} initialSeconds={data.deltaSeconds} />} />
            <div className="flex flex-col gap-1.5">
              <StatTile
                icon={Clock}
                accent="info"
                label="Hours today"
                value={hoursOfDailyTarget(data.hoursTodayMinutes, targetMinutes)}
                delta={{ direction: "flat", text: formatHoursMinutes(data.hoursTodayMinutes) }}
              />
              <LockInHint localDate={data.localDate} hoursTodayMinutes={data.hoursTodayMinutes} />
            </div>
            <StatTile icon={Gauge} accent="info" label="Efficiency" value={data.efficiencyPercent === null ? "—" : `${data.efficiencyPercent}%`} />
          </div>
          <TimeboxedTasks tasks={data.timeboxed} />
        </div>
      );
    }
    case "wind_down":
      return (
        <Panel title="Wind down" data-testid="rhythm-wind-down">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-muted-foreground">Close the day: account for it, reflect, and choose tomorrow&apos;s three.</p>
              {data.bedtime ? (
                <p className="mt-1 text-xs text-muted-foreground" data-testid="lights-out">
                  Lights out by {data.bedtime}
                </p>
              ) : null}
            </div>
            <Link
              href="/close"
              prefetch
              className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
              data-testid="close-the-day"
            >
              <Moon className="size-4" aria-hidden />
              Close the day
            </Link>
          </div>
        </Panel>
      );
    case "done":
      return (
        <Panel title="Done for today" data-testid="rhythm-done">
          {data.bedtime ? (
            <p className="mb-2 text-sm font-medium" data-testid="lights-out">
              Lights out by {data.bedtime}
            </p>
          ) : null}
          {data.tomorrow.length === 0 ? (
            <p className="text-sm text-muted-foreground">The day is closed. Nothing is planned for tomorrow yet.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">The day is closed. Tomorrow you chose:</p>
              <ol className="space-y-1.5">
                {data.tomorrow.map((t) => (
                  <li key={t.id} className="flex items-start gap-2 text-sm">
                    <span aria-hidden className="text-muted-foreground">{t.mitRank === 1 ? "★" : t.mitRank}</span>
                    <span className={t.mitRank === 1 ? "font-medium" : ""}>{t.title}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </Panel>
      );
  }
}
