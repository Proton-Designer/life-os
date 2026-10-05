import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localDateString, formatShortDate } from "@/lib/date-utils";
import { isDeenModeOn } from "@/lib/deen/deen-mode";
import { getQuranOverviewCore } from "@/lib/quran/plan-core";
import { weeklyLookBack } from "@/lib/quran/surfaces";
import { QuranDateChoice } from "@/components/week/quran-date-choice";

/**
 * QURAN-02: the weekly reset's Quran line (inside "Look back"): pages read this week against the plan, where the plan
 * stands, and the finish date to keep or move. Deen ON with an unfinished plan only; nothing otherwise. The reader's week is
 * the CURRENT Sun–Sat week, so on the reset Sunday the page counts are labelled "so far this week".
 */
export async function QuranLookBack() {
  const profile = await getProfile();
  if (!isDeenModeOn(profile)) return null;
  const user = await getAuthedUser();
  if (!user) return null;
  const timezone = profile?.timezone ?? "UTC";
  const todayStr = localDateString(new Date(), timezone);
  const overview = await getQuranOverviewCore(await createClient(), user.id, todayStr).catch(() => null);
  const look = weeklyLookBack(overview);
  if (!look || overview?.plan?.status === "paused") return null;
  const standing = look.status === "behind" ? "A little behind" : look.status === "ahead" ? "Ahead of the plan" : "On track";
  return (
    <div className="rounded-lg border p-4 space-y-2" data-testid="quran-look-back">
      <p className="text-sm font-medium">Quran</p>
      <p className="text-sm">
        {standing} · {look.pagesRead} of {look.plannedToDate} planned pages so far this week · {look.readingDaysLast7} of last 7 days
      </p>
      <p className="text-xs text-muted-foreground">
        Finish date {formatShortDate(look.finishDate)}
        {look.projectedFinish ? ` · at your recent pace, ${formatShortDate(look.projectedFinish)}` : ""}
      </p>
      <QuranDateChoice finishDate={look.finishDate} suggestedDate={look.suggestedDate ?? look.projectedFinish} todayStr={todayStr} />
    </div>
  );
}
