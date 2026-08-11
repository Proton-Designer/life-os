import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localDateString, getWeekStartDate, resolveLocalTime } from "@/lib/date-utils";
import { getFocusMap } from "@/lib/insights/focus-map";
import { computeRatioDisplay } from "@/lib/insights/ratio-display";
import { cn } from "@/lib/utils";

const SEGMENT_LABEL: Record<string, string> = {
  deen: "Deen",
  business: "Business",
  fitness: "Fitness",
  school_co_op: "School/Co-op",
  noise: "Noise",
  other_work: "Other work",
};

const SEGMENT_COLOR: Record<string, string> = {
  deen: "var(--accent-deen)",
  business: "var(--accent-business)",
  fitness: "var(--accent-fitness)",
  school_co_op: "var(--accent-school)",
  noise: "var(--accent-noise)",
  other_work: "var(--muted-foreground)",
};

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; domain?: string }>;
}) {
  const { range: rangeParam, domain: highlightDomain } = await searchParams;
  const range = rangeParam === "day" ? "day" : "week";

  const user = await getAuthedUser();
  if (!user) redirect("/login");
  const userId = user.id;
  const now = new Date();

  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const todayStr = localDateString(now, timezone);
  const anchor =
    range === "week"
      ? resolveLocalTime(getWeekStartDate(todayStr), "00:00", timezone)
      : resolveLocalTime(todayStr, "00:00", timezone);

  const { segments, globalRatio } = await getFocusMap(userId, range, anchor);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-8 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Insights</h1>
        <div className="flex gap-2 text-sm">
          <Link
            href="/insights?range=day"
            className={cn("rounded-full px-3 py-1", range === "day" ? "bg-accent" : "text-muted-foreground")}
          >
            Day
          </Link>
          <Link
            href="/insights?range=week"
            className={cn("rounded-full px-3 py-1", range === "week" ? "bg-accent" : "text-muted-foreground")}
          >
            Week
          </Link>
        </div>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Focus Map</h2>
        {segments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No check-ins answered in this range yet.</p>
        ) : (
          <>
            <div className="flex h-4 overflow-hidden rounded-full">
              {segments.map((s) => (
                <div
                  key={s.domain}
                  style={{ width: `${s.pct}%`, backgroundColor: SEGMENT_COLOR[s.domain] ?? "var(--muted)" }}
                  title={`${SEGMENT_LABEL[s.domain] ?? s.domain}: ${Math.round(s.pct)}%`}
                />
              ))}
            </div>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {segments.map((s) => (
                <li key={s.domain} className="flex items-center gap-1.5">
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: SEGMENT_COLOR[s.domain] ?? "var(--muted)" }}
                  />
                  {SEGMENT_LABEL[s.domain] ?? s.domain} · {Math.round(s.pct)}%
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="rounded-lg border border-border/40 p-4">
        <p className="text-sm text-muted-foreground">Global Signal:Noise</p>
        <p className="text-2xl font-semibold">{globalRatio}</p>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Per-domain</h2>
        <ul className="flex flex-col gap-2">
          {segments
            .filter((s) => s.domain !== "noise" && s.domain !== "other_work")
            .map((s) => {
              // Using pct instead of raw counts is fine — both are divided by
              // the same total, so the ratio between them is identical.
              const noiseSegment = segments.find((n) => n.domain === "noise");
              const display = computeRatioDisplay(s.pct, noiseSegment?.pct ?? 0, true);
              return (
                <li
                  key={s.domain}
                  className={cn(
                    "flex items-center justify-between rounded-lg border border-border/40 px-4 py-3 text-sm",
                    highlightDomain === s.domain && "border-accent-business/60"
                  )}
                >
                  <span>{SEGMENT_LABEL[s.domain] ?? s.domain}</span>
                  <span className="font-medium">{display}</span>
                </li>
              );
            })}
        </ul>
      </section>
    </div>
  );
}
