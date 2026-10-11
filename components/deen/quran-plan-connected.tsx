"use client";

import { QuranPlanCard } from "@/components/deen/quran-plan-card";
import type { QuranPlanActions, QuranPlanView, QuranStartInput } from "@/components/deen/quran-plan-types";
import {
  keepOrMoveFinishDate,
  deleteQuranLogEntry,
  editQuranLogEntry,
  logQuranReading,
  pauseQuranPlan,
  resumeQuranPlan,
  startNextKhatm,
  startQuranPlan,
  undoLastQuranLog,
} from "@/app/(app)/deen/quran-plan-actions";
import type { QuranPlanPreset } from "@/lib/quran/plan";

const presetFor = (input: QuranStartInput): QuranPlanPreset => {
  if ("targetDate" in input) return { kind: "custom_date", targetDate: input.targetDate };
  if ("pagesPerDay" in input) return { kind: "custom_pace", pagesPerDay: input.pagesPerDay };
  if (input.preset === "30d") return { kind: "days", days: 30 };
  if (input.preset === "6m") return { kind: "six_months" };
  if (input.preset === "ramadan") return { kind: "ramadan" };
  return { kind: "days", days: 60 };
};

/** Real QURAN-01 actions behind the card's QuranPlanActions (the card itself stays testable with mocks). */
export const quranPlanActions: QuranPlanActions = {
  start: (input, startPage) => startQuranPlan({ preset: presetFor(input), startFrom: startPage > 1 ? "current_page" : "beginning", startPage }),
  logPortion: (forDate) => logQuranReading({ todaysPortion: true }, { forDate }),
  log: (input, forDate) => logQuranReading(input, { forDate }),
  undoLast: () => undoLastQuranLog(),
  editEntry: (id, patch) => editQuranLogEntry(id, patch),
  deleteEntry: (id) => deleteQuranLogEntry(id),
  keepDate: () => keepOrMoveFinishDate(null),
  moveDate: (date) => keepOrMoveFinishDate(date),
  pause: () => pauseQuranPlan(),
  resume: () => resumeQuranPlan(),
  startNext: () => startNextKhatm(),
};

/** The Deen page's Quran card: a serializable view in, the real actions wired here (never passed down from a Server Component). */
export function QuranPlanConnected({ view, todayStr }: { view: QuranPlanView; todayStr: string }) {
  return <QuranPlanCard view={view} actions={quranPlanActions} todayStr={todayStr} />;
}
