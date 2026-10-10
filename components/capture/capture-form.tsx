"use client";

import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { localDateString, formatShortDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import { parseUtterance, type ParsedUtterance } from "@/lib/capture/parse-utterance";
import { captureTask, captureDistraction, captureDump } from "@/lib/capture/actions";
import { defaultCaptureArea, type CaptureArea, type CaptureAreaConfig } from "@/lib/capture/areas";
import type { DistractionDomain } from "@/lib/distractions/types";
import { useDictation } from "@/components/shared/use-dictation";
import { formatHourMinute12, localClockHHMM } from "@/lib/date-utils";

type CaptureType = "task" | "distraction" | "worry" | "note";

// R57, re-enabled 2026-09-02 once migrations 119 (tasks.domain nullable) and 120
// (tasks.dump_source) landed on production. captureDump now writes domain: null always;
// dump_source depends on WHICH of these two is picked (Boss correction, 2026-09-02):
// Worry is a KIND the Night Plan's seeding/anti-worry hour must find regardless of
// surface, so it writes dump_source "worry"; Note is an undifferentiated capture with no
// kind, so it writes "capture" — see handleConfirm and captureDump's own comment.
const TYPE_OPTIONS: { label: string; value: CaptureType }[] = [
  { label: "Task", value: "task" },
  { label: "Distraction", value: "distraction" },
  { label: "Worry", value: "worry" },
  { label: "Note", value: "note" },
];

const LEGACY_AREAS: CaptureAreaConfig = {
  options: [
    { value: "school", label: "School" },
    { value: "co_op", label: "Work" },
    { value: "none", label: "No area (Inbox)" },
  ],
  workTabs: [],
};

const DISTRACTION_DOMAINS: { label: string; value: DistractionDomain }[] = [
  { label: "Faith", value: "deen" },
  { label: "Business", value: "business" },
  { label: "School", value: "school" },
  { label: "Fitness", value: "fitness" },
  { label: "Co-op", value: "co_op" },
];

/**
 * Infers which distraction domain to show as the default, per the current screen — it is
 * SHOWN and changeable, never applied silently (BOSS-VISION §5, and the explicit rule
 * this whole surface exists under). Falls back to "school" for a route with no domain
 * meaning (Now, Review, /capture) — same fallback captureTask/captureDump already use for
 * the columns that have no domain-agnostic option, so a default that has to exist anyway
 * stays consistent everywhere it appears.
 */
function inferDefaultDomain(pathname: string, deenMode: boolean): DistractionDomain {
  if (deenMode && pathname.startsWith("/deen")) return "deen";
  if (pathname.startsWith("/business")) return "business";
  if (pathname.startsWith("/fitness")) return "fitness";
  if (pathname.startsWith("/work")) return "co_op";
  return "school";
}

// Minutes since local midnight, in the user's IANA zone — never derived from a raw
// `Date`'s UTC parts, same discipline as `localDateString` itself (AGENTS.md).
function nowMinutesIntoDayFor(timezone: string): number {
  const [hour, minute] = localClockHHMM(new Date(), timezone).split(":").map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}

/** "HH:MM" (24h, zero-padded) for `tasks.due_time` — the column addTaskCore writes.
 * Kept separate from formatParsedWhen, which renders a locale time for display only. */
function formatParsedTime(time: { hour: number; minute: number }): string {
  return `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`;
}

function formatParsedWhen(parsed: ParsedUtterance, todayStr: string): string | null {
  if (parsed.date == null && parsed.time == null) return null;
  const dateLabel = parsed.date != null ? formatShortDate(parsed.date, todayStr) : "no date";
  const timeLabel =
    parsed.time != null
      ? formatHourMinute12(parsed.time.hour, parsed.time.minute)
      : null;
  return timeLabel ? `${dateLabel}, ${timeLabel}` : dateLabel;
}

/**
 * P3-17: the classify/parse/confirm form itself, extracted verbatim out of
 * GlobalCaptureSheet (BOSS-VISION §5) so the dedicated `/capture` route
 * (capture-page-client.tsx) and the Dialog-based sheet
 * (global-capture-sheet.tsx) share one implementation instead of two
 * copies drifting apart. Deliberately NOT a Dialog itself — it owns only
 * the fields and the write; the caller decides how to frame it (a sheet
 * closes on `onCaptured`/`onCancel`, the dedicated page resets in place).
 *
 * `onCaptured` is required, not "default no-op" — persisting an entry and
 * silently doing nothing about it is never correct for either caller.
 */
export function CaptureForm({
  timezone,
  onCaptured,
  onCancel,
  cancelLabel = "Cancel",
  confirmLabel = "Confirm",
  autoFocus = true,
  deenMode = false,
  areas,
  distractionLogger,
}: {
  /** The task homes this account has (School / Work / No area) plus its work-tab kinds. Absent = the legacy two + Inbox. */
  areas?: CaptureAreaConfig;
  /**
   * When given, picking the Distraction tab shows THIS (the app's one distraction logger, embedded) in place of the
   * text form -- under the same tab bar, so the user can still switch to Task / Worry / Note.
   */
  distractionLogger?: React.ReactNode;
  /** profiles.deen_mode as a plain boolean; fails closed (off). Off drops the "Deen" distraction domain. */
  deenMode?: boolean;
  timezone: string;
  onCaptured: () => void;
  onCancel: () => void;
  cancelLabel?: string;
  confirmLabel?: string;
  autoFocus?: boolean;
}) {
  const pathname = usePathname();
  const [text, setText] = useState("");
  const [captureType, setCaptureType] = useState<CaptureType>("task");
  const areaConfig = areas ?? LEGACY_AREAS;
  const [area, setArea] = useState<CaptureArea>(() => defaultCaptureArea(pathname, areaConfig));
  const [domain, setDomain] = useState<DistractionDomain>(() => inferDefaultDomain(pathname, deenMode));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // P2-16 extracted this into a shared hook (components/shared/use-dictation.ts)
  // so Self-Mastery's free-recall answer could reuse it verbatim.
  const dictation = useDictation((transcript) => setText((prev) => (prev ? `${prev} ${transcript}` : transcript)));

  const todayStr = localDateString(new Date(), timezone);
  const parsed = useMemo(
    () => parseUtterance(text, { today: todayStr, nowMinutesIntoDay: nowMinutesIntoDayFor(timezone) }),
    [text, todayStr, timezone]
  );
  const ambiguous = text.trim().length === 0 || parsed.title.trim().length === 0;
  const whenLabel = formatParsedWhen(parsed, todayStr);

  async function handleConfirm() {
    if (ambiguous || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      if (captureType === "task") {
        await captureTask({
          title: parsed.title,
          area,
          dueDate: parsed.date,
          dueTime: parsed.time ? formatParsedTime(parsed.time) : null,
        });
      } else if (captureType === "distraction") {
        await captureDistraction({ title: parsed.title, domain });
      } else if (captureType === "worry") {
        // "worry" is a KIND the Night Plan's seeding/anti-worry hour must find regardless
        // of surface — never flattened to "capture" (Boss correction, 2026-09-02).
        await captureDump({ title: parsed.title, source: "worry" });
      } else {
        // "note": an undifferentiated capture with no kind to seed by.
        await captureDump({ title: parsed.title, source: "capture" });
      }
      onCaptured();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that — try again");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <SegmentedControl
        options={TYPE_OPTIONS.map((o) => ({ ...o, active: o.value === captureType }))}
        onSelect={(value) => {
          setCaptureType(value as CaptureType);
        }}
      />

      {captureType === "distraction" && distractionLogger ? (
        distractionLogger
      ) : (
        <>
      <div className="flex items-start gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            captureType === "task"
              ? "e.g. Submit lab report tomorrow at 5pm"
              : captureType === "distraction"
                ? "What pulled your attention?"
                : captureType === "worry"
                  ? "What's on your mind?"
                  : "Anything worth writing down"
          }
          aria-label="Capture input"
          autoFocus={autoFocus}
          rows={3}
          className="min-h-20 flex-1 rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {dictation.supported && (
          <button
            type="button"
            onClick={dictation.toggle}
            aria-label={dictation.dictating ? "Listening" : "Dictate"}
            aria-pressed={dictation.dictating}
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-full border border-input",
              dictation.dictating ? "bg-destructive/10 text-destructive" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Mic className="size-4" aria-hidden />
          </button>
        )}
      </div>

      {/* The parsed preview IS the confirm-before-persist gate — nothing here has been
          saved yet. Shown even when unresolved, so the user can see exactly what will
          (and won't) be captured before confirming. */}
      <div className="flex flex-col gap-2 rounded-md border border-border/40 p-3 text-sm">
        <p className="text-muted-foreground">
          {parsed.title.trim().length > 0 ? (
            <>
              Will capture: <span className="font-medium text-foreground">{parsed.title}</span>
            </>
          ) : (
            "Nothing to capture yet — say what it is, not just when."
          )}
        </p>
        {whenLabel && <p className="text-xs text-muted-foreground">When: {whenLabel}</p>}
        {captureType === "task" && (
          <div role="radiogroup" aria-label="Area" className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            Area
            {areaConfig.options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={area === o.value}
                onClick={() => setArea(o.value)}
                className={cn(
                  "min-h-8 rounded-full border px-2.5",
                  area === o.value ? "border-primary bg-primary/10 text-foreground" : "border-input hover:text-foreground"
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
        {captureType === "distraction" && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Category
            <select
              value={domain}
              onChange={(e) => setDomain(e.target.value as DistractionDomain)}
              aria-label="Distraction category"
              className="rounded-md border border-input bg-transparent px-2 py-1 text-xs"
            >
              {DISTRACTION_DOMAINS.filter((d) => deenMode || d.value !== "deen").map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button type="button" onClick={handleConfirm} disabled={ambiguous || submitting}>
          {submitting ? "Saving…" : confirmLabel}
        </Button>
      </div>
        </>
      )}
    </div>
  );
}
