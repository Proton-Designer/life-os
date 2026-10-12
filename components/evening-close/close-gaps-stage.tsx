"use client";

import { useState, useTransition } from "react";
import { ArrowLeft, Check, Coffee, Hourglass, ShoppingBag, Scissors, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { saveUntrackedGaps } from "@/app/(app)/close/gap-actions";
import { ACCENT_VAR, DOMAIN_ACCENT } from "@/lib/accent-tokens";
import { DOMAIN_ICON } from "@/lib/domain-icons";
import { formatClock12 } from "@/lib/date-utils";
import { GAP_STEP_MINUTES, splitGap, type GapChoice } from "@/lib/checkins/gaps";
import type { GapHint, UntrackedGap } from "@/lib/checkins/gaps-core";
import { formatDuration } from "@/lib/plan/plan-behavior";
import { cn } from "@/lib/utils";

type Ask = UntrackedGap;
type Answer = GapChoice | "skip";

const AREAS: { key: "business" | "school" | "fitness" | "co_op" | "deen"; label: string }[] = [
  { key: "business", label: "Business" },
  { key: "school", label: "School" },
  { key: "co_op", label: "Work" },
  { key: "fitness", label: "Fitness" },
  { key: "deen", label: "Faith" },
];

const CATCH_ALL: { key: "rest" | "errands" | "wasted"; label: string; icon: LucideIcon; wasted?: boolean }[] = [
  { key: "rest", label: "Rest or meals", icon: Coffee },
  { key: "errands", label: "Errands", icon: ShoppingBag },
  { key: "wasted", label: "Wasted", icon: Hourglass, wasted: true },
];

const LABEL: Record<GapChoice, string> = {
  business: "Business",
  school: "School",
  co_op: "Work",
  fitness: "Fitness",
  deen: "Faith",
  rest: "Rest or meals",
  errands: "Errands",
  wasted: "Wasted",
};

/**
 * "Your untracked time" (evening close). The stretches of the day nothing accounts for, asked one at a time: one big card per
 * stretch, one tap to say what it was. Nothing is typed. A stretch can be split in two (one slider), skipped ("Not sure",
 * which counts as unknown rather than wasted), or the whole remainder filled with one answer. Answers are saved together when
 * the last one is given (or from "Save what I've answered"); the server re-checks every one against the stretches it works out itself.
 */
export function CloseGapsStage({ gaps, timezone, deenMode }: { gaps: UntrackedGap[]; timezone: string; deenMode: boolean }) {
  const [asks, setAsks] = useState<Ask[]>(gaps);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [cursor, setCursor] = useState(0);
  const [splitting, setSplitting] = useState<number | null>(null);
  const [fillAll, setFillAll] = useState(false);
  const [phase, setPhase] = useState<"asking" | "done">("asking");
  const [saved, setSaved] = useState<{ choice: GapChoice; minutes: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (gaps.length === 0) return null;

  const clock = (iso: string) => formatClock12(new Date(iso), timezone);
  const total = asks.reduce((n, a) => n + a.minutes, 0);
  const areas = AREAS.filter((a) => a.key !== "deen" || deenMode);

  function save(finalAnswers: Answer[]) {
    const toSave = asks
      .map((a, i) => ({ ask: a, answer: finalAnswers[i] }))
      .filter((x): x is { ask: Ask; answer: GapChoice } => x.answer !== undefined && x.answer !== "skip");
    setError(null);
    if (toSave.length === 0) {
      setSaved([]);
      setPhase("done");
      return;
    }
    startTransition(async () => {
      try {
        await saveUntrackedGaps(toSave.map((x) => ({ start: x.ask.start, end: x.ask.end, choice: x.answer })));
        const sums = new Map<GapChoice, number>();
        for (const x of toSave) sums.set(x.answer, (sums.get(x.answer) ?? 0) + x.ask.minutes);
        setSaved([...sums.entries()].map(([choice, minutes]) => ({ choice, minutes })));
        setPhase("done");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save. Try again.");
      }
    });
  }

  function answer(choice: Answer) {
    const next = [...answers];
    if (fillAll && choice !== "skip") for (let i = cursor; i < asks.length; i++) next[i] = choice;
    else next[cursor] = choice;
    setAnswers(next);
    setSplitting(null);
    const last = fillAll && choice !== "skip" ? asks.length - 1 : cursor;
    if (last + 1 < asks.length) {
      setCursor(last + 1);
      setFillAll(false);
    } else save(next);
  }

  function confirmSplit(firstMinutes: number) {
    const ask = asks[cursor];
    const parts = splitGap({ start: new Date(ask.start), end: new Date(ask.end), minutes: ask.minutes }, firstMinutes);
    if (!parts) return;
    const toAsk = (g: { start: Date; end: Date; minutes: number }): Ask => ({ start: g.start.toISOString(), end: g.end.toISOString(), minutes: g.minutes, hint: null });
    setAsks([...asks.slice(0, cursor), toAsk(parts[0]), toAsk(parts[1]), ...asks.slice(cursor + 1)]);
    setAnswers(answers.slice(0, cursor));
    setSplitting(null);
  }

  if (phase === "done") {
    return (
      <section aria-labelledby="close-gaps-heading" className="rounded-2xl border border-border/40 bg-card p-4" data-testid="close-gaps-done">
        <h2 id="close-gaps-heading" className="flex items-center gap-2 text-sm font-medium">
          <Check className="size-4 text-accent-business" aria-hidden />
          Untracked time
        </h2>
        {saved.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">Left as unknown for tonight.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="What you logged">
            {saved.map((s) => (
              <li key={s.choice} className="rounded-full border border-border/40 px-2.5 py-1 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{formatDuration(s.minutes)}</span> {LABEL[s.choice]}
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  const ask = asks[cursor];
  const answeredCount = answers.filter((a) => a !== undefined && a !== "skip").length;
  const remaining = asks.length - cursor - 1;
  const current = answers[cursor];
  const canSplit = ask.minutes >= 3 * GAP_STEP_MINUTES; // two parts of at least one step each, with the slider room to move

  return (
    <section aria-labelledby="close-gaps-heading" className="rounded-2xl border border-border/40 bg-card p-4 sm:p-5" data-testid="close-gaps">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="close-gaps-heading" className="text-sm font-medium">
            Untracked time
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {formatDuration(total)} today with nothing logged. What was it?
          </p>
        </div>
        <p className="shrink-0 text-xs tabular-nums text-muted-foreground" aria-live="polite" data-testid="close-gaps-progress">
          {cursor + 1} of {asks.length}
        </p>
      </div>

      <div className="mt-1 flex gap-1" aria-hidden>
        {asks.map((_, i) => (
          <span key={i} className={cn("h-1 flex-1 rounded-full transition-colors", i < cursor || (i === cursor && current) ? "bg-accent-business" : i === cursor ? "bg-foreground/40" : "bg-border")} />
        ))}
      </div>

      <div key={`${ask.start}-${ask.end}`} className="mt-4 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200">
        <p className="text-xl font-semibold tracking-tight tabular-nums" data-testid="close-gaps-range">
          {clock(ask.start)} – {clock(ask.end)}
        </p>
        <p className="text-xs text-muted-foreground">{formatDuration(ask.minutes)}</p>

        {splitting !== null ? (
          <SplitPicker ask={ask} firstMinutes={splitting} clock={clock} onChange={setSplitting} onConfirm={() => confirmSplit(splitting)} onCancel={() => setSplitting(null)} />
        ) : (
          <>
            {fillAll ? (
              <p className="mt-3 text-xs font-medium text-accent-business" data-testid="close-gaps-fill-note">
                Pick one answer for all {asks.length - cursor} remaining stretches.
              </p>
            ) : null}

            {ask.hint && !fillAll ? <HintButton hint={ask.hint} selected={current === ask.hint.choice} onPick={() => answer(ask.hint!.choice)} /> : null}

            <div role="group" aria-label="What did you do?" className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {areas.map((a) => (
                <ChoiceButton key={a.key} label={a.label} icon={DOMAIN_ICON[a.key]} color={`var(${ACCENT_VAR[DOMAIN_ACCENT[a.key]]})`} selected={current === a.key} onPick={() => answer(a.key)} />
              ))}
              {CATCH_ALL.map((c) => (
                <ChoiceButton key={c.key} label={c.label} icon={c.icon} color={c.wasted ? `var(${ACCENT_VAR.noise})` : "var(--muted-foreground)"} selected={current === c.key} onPick={() => answer(c.key)} />
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-1 text-xs">
              {cursor > 0 ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => (setCursor(cursor - 1), setFillAll(false))} data-testid="close-gaps-back">
                  <ArrowLeft aria-hidden /> Back
                </Button>
              ) : null}
              <Button type="button" variant="ghost" size="sm" onClick={() => answer("skip")} data-testid="close-gaps-skip">
                Not sure
              </Button>
              {canSplit ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setSplitting(Math.round(ask.minutes / 2 / GAP_STEP_MINUTES) * GAP_STEP_MINUTES || GAP_STEP_MINUTES)} data-testid="close-gaps-split">
                  <Scissors aria-hidden /> Split
                </Button>
              ) : null}
              {remaining > 0 ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setFillAll((v) => !v)} aria-pressed={fillAll} data-testid="close-gaps-fill-all">
                  {fillAll ? "Just this one" : `Same for the other ${remaining}`}
                </Button>
              ) : null}
              {answeredCount > 0 && remaining > 0 ? (
                <Button type="button" variant="ghost" size="sm" className="ml-auto" disabled={pending} onClick={() => save(answers)} data-testid="close-gaps-save-now">
                  Save what I&apos;ve answered
                </Button>
              ) : null}
            </div>
          </>
        )}

        {error ? (
          <p role="alert" className="mt-2 text-xs text-destructive" data-testid="close-gaps-error">
            {error}
          </p>
        ) : null}
        {pending ? <p className="mt-2 text-xs text-muted-foreground">Saving…</p> : null}
      </div>
    </section>
  );
}

function ChoiceButton({ label, icon: Icon, color, selected, onPick }: { label: string; icon: LucideIcon; color: string; selected: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={selected}
      className={cn(
        "flex min-h-12 items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors",
        "hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:translate-y-px",
        selected ? "border-foreground/50 bg-muted" : "border-border/50",
      )}
    >
      <Icon className="size-4 shrink-0" style={{ color }} aria-hidden />
      <span className="leading-tight">{label}</span>
    </button>
  );
}

function HintButton({ hint, selected, onPick }: { hint: GapHint; selected: boolean; onPick: () => void }) {
  const Icon = DOMAIN_ICON[hint.choice as keyof typeof DOMAIN_ICON] ?? Check;
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={selected}
      data-testid="close-gaps-hint"
      className={cn(
        "mt-3 flex w-full items-center gap-3 rounded-xl border border-dashed px-3 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        selected ? "border-foreground/50 bg-muted" : "border-accent-business/50 bg-accent-business/5",
      )}
    >
      <Icon className="size-4 shrink-0 text-accent-business" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">Planned: {hint.title}</span>
        <span className="block text-xs text-muted-foreground">Tap if you did it</span>
      </span>
    </button>
  );
}

function SplitPicker({
  ask,
  firstMinutes,
  clock,
  onChange,
  onConfirm,
  onCancel,
}: {
  ask: Ask;
  firstMinutes: number;
  clock: (iso: string) => string;
  onChange: (m: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const mid = new Date(new Date(ask.start).getTime() + firstMinutes * 60_000).toISOString();
  return (
    <div className="mt-3 rounded-xl border border-border/50 p-3" data-testid="close-gaps-split-picker">
      <p className="text-sm font-medium">Where does it change?</p>
      <input
        type="range"
        aria-label="Where the stretch splits"
        min={GAP_STEP_MINUTES}
        max={ask.minutes - GAP_STEP_MINUTES}
        step={GAP_STEP_MINUTES}
        value={firstMinutes}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-3 w-full accent-[var(--accent-business)]"
        data-testid="close-gaps-split-range"
      />
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs tabular-nums text-muted-foreground">
        <p>
          <span className="block font-medium text-foreground">First part</span>
          {clock(ask.start)} – {clock(mid)}
        </p>
        <p>
          <span className="block font-medium text-foreground">Second part</span>
          {clock(mid)} – {clock(ask.end)}
        </p>
      </div>
      <div className="mt-3 flex gap-2">
        <Button type="button" size="sm" onClick={onConfirm} data-testid="close-gaps-split-confirm">
          Split it
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
