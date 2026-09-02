"use client";

import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { Mic, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { localDateString, formatShortDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import { parseUtterance, type ParsedUtterance } from "@/lib/capture/parse-utterance";
import { captureTask, captureDistraction, captureDump } from "@/lib/capture/actions";
import type { DistractionDomain } from "@/lib/distractions/types";

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

const DISTRACTION_DOMAINS: { label: string; value: DistractionDomain }[] = [
  { label: "Deen", value: "deen" },
  { label: "Business", value: "business" },
  { label: "School", value: "school" },
  { label: "Fitness", value: "fitness" },
  { label: "Co-op", value: "co_op" },
];

/**
 * Infers which distraction domain to show as the default, per the current screen — it is
 * SHOWN and changeable, never applied silently (BOSS-VISION §5, and the explicit rule
 * this whole surface exists under). Falls back to "school" for a route with no domain
 * meaning (Now, Review) — same fallback captureTask/captureDump already use for the
 * columns that have no domain-agnostic option, so a default that has to exist anyway
 * stays consistent everywhere it appears.
 */
function inferDefaultDomain(pathname: string): DistractionDomain {
  if (pathname.startsWith("/deen")) return "deen";
  if (pathname.startsWith("/business")) return "business";
  if (pathname.startsWith("/fitness")) return "fitness";
  if (pathname.startsWith("/work")) return "co_op";
  return "school";
}

// Minutes since local midnight, in the user's IANA zone — never derived from a raw
// `Date`'s UTC parts, same discipline as `localDateString` itself (AGENTS.md).
function nowMinutesIntoDayFor(timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(
    new Date()
  );
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

function formatParsedWhen(parsed: ParsedUtterance, todayStr: string): string | null {
  if (parsed.date == null && parsed.time == null) return null;
  const dateLabel = parsed.date != null ? formatShortDate(parsed.date, todayStr) : "no date";
  const timeLabel =
    parsed.time != null
      ? new Date(2000, 0, 1, parsed.time.hour, parsed.time.minute).toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
        })
      : null;
  return timeLabel ? `${dateLabel}, ${timeLabel}` : dateLabel;
}

/**
 * Global capture (BOSS-VISION §5): one tap, from any screen — type or dictate, parse,
 * confirm-before-persist. `parseUtterance` (lib/capture/parse-utterance.ts) is
 * deliberately dumb: it extracts a title/date/time and resolves nothing it isn't sure
 * of, leaving the confirm step to ask. An utterance with no title left after parsing
 * (e.g. "tomorrow" alone) is AMBIGUOUS — there is nothing to capture — and Confirm is
 * disabled rather than persisting an empty row.
 *
 * Persists through existing actions only (lib/capture/actions.ts): task -> the school
 * task action, distraction -> the distractions review action, worry/note -> the Night
 * Plan dump. This component owns classification (which of the three, and — for
 * distraction — which domain) and confirmation; it computes and shows the destination
 * rather than deciding it silently.
 */
export function GlobalCaptureSheet({ timezone }: { timezone: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [captureType, setCaptureType] = useState<CaptureType>("task");
  const [domain, setDomain] = useState<DistractionDomain>(() => inferDefaultDomain(pathname));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dictationSupported] = useState(
    () => typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)
  );
  const [dictating, setDictating] = useState(false);

  const todayStr = localDateString(new Date(), timezone);
  const parsed = useMemo(
    () => parseUtterance(text, { today: todayStr, nowMinutesIntoDay: nowMinutesIntoDayFor(timezone) }),
    [text, todayStr, timezone]
  );
  const ambiguous = text.trim().length === 0 || parsed.title.trim().length === 0;
  const whenLabel = formatParsedWhen(parsed, todayStr);

  function reset() {
    setText("");
    setCaptureType("task");
    setDomain(inferDefaultDomain(pathname));
    setError(null);
    setDictating(false);
  }

  // The single close path — used by Cancel AND by Radix's own onOpenChange (escape,
  // overlay click). A Cancel button that only called setOpen(false) directly would
  // bypass this and leave the next open showing the discarded draft.
  function handleClose() {
    setOpen(false);
    reset();
  }

  function toggleDictation() {
    if (!dictationSupported) return;
    // Not in TypeScript's standard DOM lib (webkit-prefixed, non-standard API) — this is
    // the narrow slice this component actually uses, not a claim about the full API.
    type MinimalSpeechRecognition = {
      lang: string;
      interimResults: boolean;
      onresult: ((event: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
      onend: (() => void) | null;
      start: () => void;
    };
    const SpeechRecognitionCtor = (
      window as unknown as {
        SpeechRecognition?: new () => MinimalSpeechRecognition;
        webkitSpeechRecognition?: new () => MinimalSpeechRecognition;
      }
    ).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => MinimalSpeechRecognition }).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) return;
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) setText((prev) => (prev ? `${prev} ${transcript}` : transcript));
    };
    recognition.onend = () => setDictating(false);
    setDictating(true);
    recognition.start();
  }

  async function handleConfirm() {
    if (ambiguous || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      if (captureType === "task") {
        await captureTask({ title: parsed.title, dueDate: parsed.date });
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
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that — try again");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        size="icon"
        aria-label="Capture"
        onClick={() => setOpen(true)}
        className="fixed bottom-24 right-4 z-40 size-12 rounded-full shadow-lg lg:bottom-6"
      >
        <Plus className="size-5" aria-hidden />
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (next) setOpen(true);
          else handleClose();
        }}
      >
        <DialogContent className="flex w-full max-w-md flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Capture</DialogTitle>
          </DialogHeader>

          <SegmentedControl
            options={TYPE_OPTIONS.map((o) => ({ ...o, active: o.value === captureType }))}
            onSelect={(value) => setCaptureType(value as CaptureType)}
          />

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
              autoFocus
              rows={3}
              className="min-h-20 flex-1 rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {dictationSupported && (
              <button
                type="button"
                onClick={toggleDictation}
                aria-label={dictating ? "Listening" : "Dictate"}
                aria-pressed={dictating}
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-full border border-input",
                  dictating ? "bg-destructive/10 text-destructive" : "text-muted-foreground hover:text-foreground"
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
            {captureType === "distraction" && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Category
                <select
                  value={domain}
                  onChange={(e) => setDomain(e.target.value as DistractionDomain)}
                  aria-label="Distraction category"
                  className="rounded-md border border-input bg-transparent px-2 py-1 text-xs"
                >
                  {DISTRACTION_DOMAINS.map((d) => (
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
            <Button type="button" variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="button" onClick={handleConfirm} disabled={ambiguous || submitting}>
              {submitting ? "Saving…" : "Confirm"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
