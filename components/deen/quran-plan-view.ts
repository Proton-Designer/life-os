import type { QuranOverview } from "@/lib/quran/plan-core";
import type { LedgerEntry } from "@/lib/quran/ledger";
import type { QuranPlanView } from "@/components/deen/quran-plan-types";

/**
 * QURAN-02: maps QURAN-01's one QuranOverview read onto the card's view model. Pure and client-safe (type-only import of
 * plan-core). null in (Deen off / no overview) -> the setup state; the page decides whether to render the card at all.
 */
export function toQuranPlanView(o: QuranOverview | null, ledger: LedgerEntry[] = []): QuranPlanView {
  if (!o?.plan) return { kind: "none" };
  const { plan, portion, status } = o;
  const kind = status?.kind;
  // QURAN-01 adds juz.completedToday; read defensively until it lands.
  const completedToday = (o.juz as { completedToday?: number[] }).completedToday ?? [];
  return {
    kind: "plan",
    khatmNumber: plan.khatmNumber,
    state: plan.status,
    currentPage: plan.currentPage,
    currentAyah: plan.currentAyah,
    startPage: plan.startPage,
    startDate: plan.startDate,
    ledger,
    daily: o.daily,
    percent: plan.percent,
    targetDate: status?.effectiveTargetDate ?? plan.targetDate,
    pagesPerDay: Math.round(plan.pacePagesPerDay),
    portion: portion ? { fromPage: portion.from, toPage: portion.to, pages: portion.pages, label: `${portion.surahLabel} · ${portion.juzFrom === portion.juzTo ? `Juz ${portion.juzFrom}` : `Juz ${portion.juzFrom}–${portion.juzTo}`}` } : null,
    portionDone: portion?.done ?? false,
    status:
      status && (kind === "on_track" || kind === "behind" || kind === "ahead")
        ? { kind, pages: status.pages, days: status.days > 0 ? status.days : null, neededPerDay: Math.ceil(status.neededPerDay), projectedFinish: status.recent.usedPlanPace ? null : status.projectedFinish, suggestedDate: status.suggestedDate ?? status.projectedFinish, suggestMove: status.suggestMoveDate }
        : null,
    last7Days: o.readingDaysLast7,
    juzComplete: completedToday.length > 0 ? { juz: Math.max(...completedToday) } : null,
  };
}
