import { DomainPeekCard, type PeekDomain } from "./domain-peek-card";
import { formatElapsedDuration } from "@/lib/business/format-elapsed";
import type { DomainSnapshots } from "@/lib/home/get-domain-snapshots";
import { ACCENT_VAR } from "@/lib/accent-tokens";

const PRAYER_LABEL: Record<string, string> = {
  fajr: "Fajr",
  dhuhr: "Dhuhr",
  asr: "Asr",
  maghrib: "Maghrib",
  isha: "Isha",
};

function relativeTime(dueAtIso: string | null, now: Date): string {
  if (!dueAtIso) return "";
  const diffMin = Math.round((new Date(dueAtIso).getTime() - now.getTime()) / 60_000);
  if (diffMin < -1) return `${Math.abs(diffMin)} min overdue`;
  if (diffMin <= 1) return "now";
  if (diffMin < 60) return `in ${diffMin} min`;
  const hours = Math.round(diffMin / 60);
  return `in ${hours} hr${hours === 1 ? "" : "s"}`;
}

// Semantic mapping mirrors Badge's variant colors (positive/warning/negative)
// — on-time is a clean completion (positive/business green), qada is a
// completion that arrived late (warning/deen amber), missed is negative/red.
// Pending (not yet due) stays an unfilled outline, same as before.
const PRAYER_STATUS_VAR: Record<string, string> = {
  on_time: ACCENT_VAR.business,
  qada: ACCENT_VAR.deen,
  missed: "--destructive",
};

function PrayerDots({ statuses }: { statuses: { name: string; status: string }[] }) {
  return (
    <div className="flex gap-1.5">
      {statuses.map((p) => {
        const colorVar = PRAYER_STATUS_VAR[p.status];
        return (
          <span
            key={p.name}
            title={PRAYER_LABEL[p.name]}
            className={colorVar ? "size-2 rounded-full" : "size-2 rounded-full border border-border"}
            style={colorVar ? { backgroundColor: `var(${colorVar})` } : undefined}
          />
        );
      })}
    </div>
  );
}

function ProgressBar({ fraction }: { fraction: number }) {
  const pct = Math.min(100, Math.round(fraction * 100));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-accent-deen" style={{ width: `${pct}%` }} />
    </div>
  );
}

function DeenBody({ snapshot, now }: { snapshot: DomainSnapshots["deen"]; now: Date }) {
  return (
    <>
      <div className="text-muted-foreground">
        {snapshot.nextPrayer ? (
          <>
            <span className="font-medium text-foreground">{PRAYER_LABEL[snapshot.nextPrayer.name]}</span>
            {snapshot.nextPrayer.dueAt && ` ${relativeTime(snapshot.nextPrayer.dueAt, now)}`}
          </>
        ) : (
          "All prayers logged"
        )}
      </div>
      <PrayerDots statuses={snapshot.prayerStatuses} />
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Qur&apos;an this week</span>
          <span>
            {snapshot.quranWeekPages}
            {snapshot.quranWeeklyTarget ? ` / ${snapshot.quranWeeklyTarget}` : ""} pages
          </span>
        </div>
        {snapshot.quranWeeklyTarget && (
          <ProgressBar fraction={snapshot.quranWeekPages / snapshot.quranWeeklyTarget} />
        )}
      </div>
      {snapshot.habitFocusName && (
        <div className="text-xs text-muted-foreground">
          Focus: <span className="text-foreground">{snapshot.habitFocusName}</span>
          {snapshot.habitFocusStreak > 0 && ` · ${snapshot.habitFocusStreak}d streak`}
        </div>
      )}
    </>
  );
}

function BusinessBody({ snapshot }: { snapshot: DomainSnapshots["business"] }) {
  if (snapshot.activeSession) {
    return (
      <>
        <div className="font-medium text-foreground">
          Locked in · {formatElapsedDuration(snapshot.activeSession.elapsedMs)}
        </div>
        <div className="text-xs text-muted-foreground">Session S:N: {snapshot.activeSession.sessionRatioDisplay}</div>
      </>
    );
  }
  return (
    <>
      <div className="text-muted-foreground">
        Kill list: <span className="font-medium text-foreground">{snapshot.killListDone}/{snapshot.killListTotal || 3}</span>
      </div>
      <div className="text-xs text-muted-foreground">This week&apos;s S:N: {snapshot.weeklyRatioDisplay}</div>
    </>
  );
}

function FitnessBody({ snapshot }: { snapshot: DomainSnapshots["fitness"] }) {
  return (
    <>
      <div className="text-muted-foreground">
        {snapshot.scheduledWorkoutName ? (
          <>
            <span className="font-medium text-foreground">{snapshot.scheduledWorkoutName}</span>{" "}
            {snapshot.workoutDone ? "· done" : "· not yet"}
          </>
        ) : (
          "Rest day"
        )}
      </div>
      <div className="text-xs text-muted-foreground">{Math.round(snapshot.weeklyConsistency * 100)}% consistency this week</div>
    </>
  );
}

function TaskDomainBody({ snapshot }: { snapshot: DomainSnapshots["school"] }) {
  return (
    <>
      <div className="text-muted-foreground">
        <span className="font-medium text-foreground">{snapshot.dueTodayCount}</span> due today
      </div>
      {snapshot.nextDueTitle && <div className="truncate text-xs text-muted-foreground">Next: {snapshot.nextDueTitle}</div>}
    </>
  );
}

const CARD_HREF: Record<PeekDomain, string> = {
  deen: "/deen",
  business: "/business",
  fitness: "/fitness",
  school: "/school",
  co_op: "/co-op",
};

export const ALL_PEEK_DOMAINS: PeekDomain[] = ["deen", "business", "fitness", "school", "co_op"];

export function DomainPeekCards({
  snapshots,
  now,
  domains = ALL_PEEK_DOMAINS,
}: {
  snapshots: DomainSnapshots;
  now: Date;
  /** Which cards to render, in order — lets the page split them across desktop's two rails without duplicating this list. */
  domains?: PeekDomain[];
}) {
  return (
    <>
      {domains.map((domain) => (
        <DomainPeekCard key={domain} domain={domain} href={CARD_HREF[domain]} pulse={snapshots[domain].pulse}>
          {domain === "deen" && <DeenBody snapshot={snapshots.deen} now={now} />}
          {domain === "business" && <BusinessBody snapshot={snapshots.business} />}
          {domain === "fitness" && <FitnessBody snapshot={snapshots.fitness} />}
          {domain === "school" && <TaskDomainBody snapshot={snapshots.school} />}
          {domain === "co_op" && <TaskDomainBody snapshot={snapshots.co_op} />}
        </DomainPeekCard>
      ))}
    </>
  );
}
