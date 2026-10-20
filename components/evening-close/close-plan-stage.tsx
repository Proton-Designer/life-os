"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { dumpLine, refreshCloseViews, commitPlan, carryOverUnfinished, claimSeedLines, triageInboxItem, type PlanMode, type SeedLine, type SeedSource } from "@/app/(app)/close/plan-actions";
import { MAX_STARRED, type DumpItem } from "@/lib/night-plan/night-plan";
import type { PlanLineState } from "@/lib/night-plan/plan-line";
import type { PlanLineInput } from "@/lib/night-plan/plan-details";
import type { PlanArea } from "@/lib/plan/plan-behavior";
import { EMPTY_PLAN_DRAFT, PlanLineDetails, planDraftSummary, type PlanLineDraft, type PlanWorkTabOption } from "@/components/plan/plan-line-details";
import { enqueueByKey } from "@/lib/client/keyed-queue";
import { useScheduleRefresh } from "@/lib/client/use-optimistic-item";
import { markWorryHandled } from "@/app/(app)/worries/actions";

/**
 * Stage (c): dump → star three → crown one, in that order.
 *
 * The order is the mechanism, not a flow. This component renders only the
 * affordance for the step the user is actually on — so a crown control never
 * sits beside an unstarred line, which is how "dump → star → crown" collapses
 * into "pick your top item" and loses the two-stage narrowing that makes the
 * crown cost something. `crown()` refuses an unstarred id rather than
 * starring it for you; the surface must not paper over that with a
 * convenience tap.
 *
 * A FOURTH STAR IS REFUSED, NOT ABSORBED. No silent eviction of the oldest:
 * SPEC §2 — "a cap that quietly drops something turns a deliberate choice into
 * a queue". The star control is HIDDEN at the cap rather than left live, because
 * a control that accepts input and discards it is worse than one that isn't there.
 *
 * SEEDED LINES (#28/#45, `seeds` prop) are worries, unfinished goal
 * milestones, AND risk-ranked school deliverables due the planning date
 * (school_risk, fixed 2026-09-14 — see `isSeedable`'s own comment for why
 * this source was computed and passed here for a while before it actually
 * rendered) — real candidates for tonight's dump that are NOT yet `tasks`
 * rows for this `plannedDate`. They render exactly like a typed line (star,
 * crown, or leave alone) with one extra action: "Not a worry anymore" /
 * "Not this month" / "Not tonight", which marks the underlying worry Handled
 * (reusing `/worries`' own action) or simply drops the milestone/school line
 * from view. That IS this ceremony's "removing a seeded line is a planning
 * act" — a seed left alone (neither starred nor dismissed) reappears next
 * time, which is correct for something still genuinely unresolved.
 *
 * Nothing about a seed is written to the database merely by being shown.
 * Every seed still present in `lines` at Finish is claimed
 * (`claimSeedLines`) into a real dumped row for `plannedDate` BEFORE ranks
 * are saved — see `commit()` below.
 *
 * `mode` (item #29) says which day this ceremony is targeting: "tonight"
 * (the ordinary evening close, plans the user's local tomorrow) or "today"
 * (only `/close/replan`, plans the user's local today with no `+1`). It is
 * plain data, not a function — passing it down is not the RSC function-prop
 * hazard.
 *
 * EACH LINE CAN CARRY DETAILS (2026-10-06): an optional domain (Business also offers "Add to Kill List", preselected),
 * a start time and a timer, open under the row's summary. Lines can also be reordered and removed, and a line that
 * already has a star / crown / details (Edit Plan, or reopening tonight's plan) arrives with them. Nothing here is
 * written until Finish / Save, which sends the whole plan in ONE `commitPlan` call -- removals, line details and
 * ranks together -- so Edit Plan is one wait, not a chain. The star cap and the crown-needs-a-star rule are unchanged.
 *
 * Server actions are IMPORTED here, not passed down as props. A function prop
 * from a Server Component is the RSC boundary bug AGENTS.md records twice;
 * importing removes the hazard rather than testing for it.
 */

type Line = { id: string; title: string; seedSource?: SeedSource; draft: PlanLineDraft };
type InitialLine = { id: string; title: string } & Partial<Omit<PlanLineState, "id" | "title">>;
type InboxEntry = { id: string; title: string; dueDate?: string | null };
type InboxAreas = { value: "school" | "co_op"; label: string }[];

// #28 fix (2026-09-14): school_risk was computed by computePlanSeeds and passed here as
// props, then silently dropped by this exact filter — the "built, computed, and never
// rendered" disease, one layer past where #28's original tests looked (they only ever
// exercised computePlanSeeds, never this component). See plan-actions.ts's own
// SCHOOL_RISK doc for the full mechanism.
function isSeedable(item: DumpItem): item is DumpItem & { source: SeedSource } {
  return item.source === "worry" || item.source === "goal_milestone" || item.source === "school_risk";
}

// Lazy on purpose: the action is only touched when the debounced refresh fires.
const refreshClose = () => refreshCloseViews();

function draftFrom(state: Partial<PlanLineState> | undefined): PlanLineDraft {
  if (!state) return EMPTY_PLAN_DRAFT;
  return { area: state.area ?? null, addToKillList: state.addToKillList ?? false, startTime: state.startTime ?? "", durationMinutes: state.durationMinutes ?? null, criteria: state.criteria ?? "", subdomain: state.subdomain ?? null };
}

export function ClosePlanStage({
  initialLines,
  seeds = [],
  carryOver = [],
  mode = "tonight",
  inbox = [],
  inboxAreas = [],
  killList = false,
  areas = [],
  workTabs = [],
  timezone = "UTC",
  onSaved,
  registerFlush,
  onTotalMinutesChange,
}: {
  /** Lines already on the plan day. Each may carry what the person already decided (star, crown, domain, time, timer). */
  initialLines: InitialLine[];
  seeds?: DumpItem[];
  /** Today's unfinished plan lines, offered for carrying over to tomorrow (the nightly close only). */
  carryOver?: PlanLineState[];
  mode?: PlanMode;
  /** IA-P1a: items the "+" sheet parked without an area (Notes, "No area" Tasks), triaged here in one tap each. */
  inbox?: InboxEntry[];
  /** The task homes this account has (School / Work) — one "Make it a task" button per entry. */
  inboxAreas?: InboxAreas;
  /** The account has a Business Kill List: a line attached to Business can be added to it (preselected). */
  killList?: boolean;
  /** The person's own domains a line can be attached to. Empty hides the picker; start time and timer still work. */
  areas?: PlanArea[];
  /** The person's Work tabs: picking Work asks which one. */
  workTabs?: PlanWorkTabOption[];
  /** IANA timezone, for the time picker's "Now" shortcuts. */
  timezone?: string;
  /** Called after a successful save (Edit Plan closes its dialog). A plain callback between client components. */
  onSaved?: () => void;
  /** Edit Plan only: hands the parent a function that saves whatever changed (called on every render, so it is always current). */
  registerFlush?: (flush: () => Promise<boolean>) => void;
  /** Reports the summed timers of every line on the plan, live as they are set, changed or removed (Edit Plan's total banner). */
  onTotalMinutesChange?: (minutes: number) => void;
}) {
  const [inboxItems, setInboxItems] = useState<InboxEntry[]>(inbox);
  const pendingPlanTriage = useRef(new Map<string, Promise<boolean>>());
  const [lines, setLines] = useState<Line[]>([
    ...initialLines.map((l) => ({ id: l.id, title: l.title, draft: draftFrom(l) })),
    ...seeds.filter(isSeedable).map((s) => ({ id: s.id, title: s.title, seedSource: s.source, draft: EMPTY_PLAN_DRAFT })),
  ]);
  const [starred, setStarred] = useState<string[]>(() => {
    const ids = initialLines.filter((l) => l.starred).map((l) => l.id);
    return ids.slice(0, MAX_STARRED);
  });
  const [crowned, setCrowned] = useState<string | null>(() => initialLines.find((l) => l.crowned && l.starred)?.id ?? null);
  const [removed, setRemoved] = useState<string[]>([]);
  // Unfinished lines from the closed day not yet carried over; all selected until the person unticks some.
  const [carryable, setCarryable] = useState<PlanLineState[]>(() => (mode === "tonight" ? carryOver.filter((c) => !initialLines.some((l) => l.id === c.id)) : []));
  const [carryUnticked, setCarryUnticked] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  // True once the draft differs from what was last written (any edit, add or remove); cleared by a successful save.
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();
  const scheduleRefresh = useScheduleRefresh(refreshClose);

  const atStarCap = starred.length >= MAX_STARRED;

  const totalMinutes = lines.reduce((sum, l) => sum + (l.draft.durationMinutes ?? 0), 0);
  useEffect(() => {
    onTotalMinutesChange?.(totalMinutes);
  }, [totalMinutes, onTotalMinutesChange]);

  function markDirty() {
    setSaved(false);
    setDirty(true);
  }

  function toggleOpen(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const anyOpen = expanded.size > 0;

  function carryOverSelected() {
    const ids = carryable.filter((c) => !carryUnticked.has(c.id)).map((c) => c.id);
    if (ids.length === 0) return;
    setError(null);
    startTransition(async () => {
      const res = await carryOverUnfinished(ids).catch(() => ({ error: "Couldn't carry those over. Try again." }));
      if ("error" in res) {
        setError(res.error);
        return;
      }
      const moved = new Set(res.lines.map((l) => l.id));
      markDirty();
      setLines((prev) => [...prev, ...res.lines.filter((l) => !prev.some((p) => p.id === l.id)).map((l) => ({ id: l.id, title: l.title, draft: draftFrom(l) }))]);
      setCarryable((prev) => prev.filter((c) => !moved.has(c.id)));
      setCarryUnticked(new Set());
    });
  }

  // PERF-4: the draft clears at once so the next line can be typed while this one saves;
  // lines are written in order on one queue, appear with their real id when written, and a
  // failed write puts the text back with the error. One deferred refresh per burst.
  function add() {
    const title = draft.trim();
    if (title.length === 0) return;
    setError(null);
    setDraft("");
    void enqueueByKey(`close-dump:${mode}`, () => dumpLine(title, mode))
      .then((res) => {
        if ("error" in res) {
          setError(res.error);
          setDraft((d) => (d.length === 0 ? title : d));
          return;
        }
        markDirty();
        // A new line goes on TOP: it is the one whose domain / time / timer still need setting, so it must not sit below the fold.
        setLines((prev) => [{ id: res.id, title, draft: EMPTY_PLAN_DRAFT }, ...prev]);
      })
      .catch(() => {
        setError("Couldn't add that line. Try again.");
        setDraft((d) => (d.length === 0 ? title : d));
      })
      .finally(scheduleRefresh);
  }

  // IA-P1a: each Inbox tap removes the item at once and writes on its own per-item queue; a
  // failed write puts the item back (and, for "Plan", takes the line back out) with the error.
  // One deferred refresh per burst.
  function triage(item: InboxEntry, action: "plan" | "school" | "co_op" | "worry" | "done") {
    setError(null);
    setInboxItems((prev) => prev.filter((i) => i.id !== item.id));
    if (action === "plan") {
      markDirty();
      setLines((prev) => [...prev, { id: item.id, title: item.title, draft: EMPTY_PLAN_DRAFT }]);
    }
    const undo = (message: string) => {
      setError(message);
      setInboxItems((prev) => (prev.some((i) => i.id === item.id) ? prev : [...prev, item]));
      if (action === "plan") {
        setLines((prev) => prev.filter((l) => l.id !== item.id));
        setStarred((prev) => prev.filter((x) => x !== item.id));
        setCrowned((c) => (c === item.id ? null : c));
      }
    };
    const write = enqueueByKey(`close-inbox:${item.id}`, () => triageInboxItem(item.id, action, mode))
      .then((res): boolean => {
        if ("error" in res) {
          undo(res.error);
          return false;
        }
        return true;
      })
      .catch((): boolean => {
        undo("Couldn't sort that item. Try again.");
        return false;
      })
      .finally(() => {
        scheduleRefresh();
        pendingPlanTriage.current.delete(item.id);
      });
    // A "Plan" line is not on the plan day until its write lands; Finish waits for it (commit()) --
    // the rank write is scoped by planned_date, so ranking an id whose planned_date write is still in
    // flight would fail (P1a review F1).
    if (action === "plan") pendingPlanTriage.current.set(item.id, write);
  }

  function toggleStar(id: string) {
    markDirty();
    if (starred.includes(id)) {
      // Unstarring drops the crown with it — a crown on an unstarred item is
      // not a state this ceremony has.
      if (crowned === id) setCrowned(null);
      setStarred((prev) => prev.filter((x) => x !== id));
      return;
    }
    if (atStarCap) return; // refused, not absorbed
    setStarred((prev) => [...prev, id]);
  }

  /** Takes a line out of the local plan (and out of the star/crown). */
  function dropLocal(id: string) {
    markDirty();
    setLines((prev) => prev.filter((l) => l.id !== id));
    setStarred((prev) => prev.filter((x) => x !== id));
    if (crowned === id) setCrowned(null);
    setExpanded((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  /** Seeded-worry-only: "this isn't weighing on me anymore" removes the line AND marks the worry Handled — see this file's header on why that IS the SPEC's "removing a seeded line is a planning act". */
  function dismissWorrySeed(line: Line) {
    dropLocal(line.id);
    startTransition(async () => {
      await markWorryHandled(line.id);
    });
  }

  /** Seeded-milestone / school-risk: purely local — nothing was claimed for it, so there is nothing to undo server-side. It reappears next time it is still due, which is correct: dismissing it here is "not now," not "resolved." */
  function dismissSeed(line: Line) {
    dropLocal(line.id);
  }

  /** Edit Plan's remove for a real line: dropped from the screen now, taken off the plan (typed lines deleted, worries only un-planned) at Save. */
  function removeLine(line: Line) {
    dropLocal(line.id);
    setRemoved((prev) => [...prev, line.id]);
  }

  function move(id: string, delta: -1 | 1) {
    markDirty();
    setLines((prev) => {
      const i = prev.findIndex((l) => l.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  }

  function setLineDraft(id: string, next: PlanLineDraft) {
    markDirty();
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, draft: next } : l)));
  }

  /** Writes the whole plan in one `commitPlan`. "saved" = written with nothing to read; "notice" = written, with a message the person should see; "failed" = nothing was saved (the error is on screen). */
  async function runCommit(): Promise<"saved" | "notice" | "failed"> {
    setError(null);
    {
      // Settle in-flight "Plan" triage writes first; if one failed it already put the item back
      // and showed its error, so stop here and let the user finish again.
      const settled = await Promise.all([...pendingPlanTriage.current.values()]);
      if (settled.some((ok) => !ok)) return "failed";
      const seedLines: SeedLine[] = lines
        .filter((l): l is Line & { seedSource: SeedSource } => l.seedSource !== undefined)
        .map((l) => ({ id: l.id, title: l.title, source: l.seedSource }));

      let idMap = new Map<string, string>();
      if (seedLines.length > 0) {
        const claimRes = await claimSeedLines(seedLines, mode);
        if ("error" in claimRes) {
          setError(claimRes.error);
          return "failed";
        }
        idMap = new Map(claimRes.claimed.map((c) => [c.seedId, c.taskId]));
      }
      // A seed dropped mid-claim (someone handled the worry elsewhere) has no
      // entry in idMap — remap drops it from the plan rather than ranking an id
      // that no longer represents this plan's dump.
      const remap = (id: string) => idMap.get(id) ?? (lines.some((l) => l.id === id && !l.seedSource) ? id : null);
      const remappedStarred = starred.map(remap).filter((id): id is string => id !== null);
      const remappedCrowned = crowned === null ? null : remap(crowned);

      const planLines: PlanLineInput[] = [];
      lines.forEach((l, order) => {
        const id = remap(l.id);
        if (id === null) return;
        planLines.push({
          id,
          area: l.draft.area,
          addToKillList: l.draft.area === "business" && killList && l.draft.addToKillList,
          startTime: l.draft.startTime === "" ? null : l.draft.startTime,
          durationMinutes: l.draft.durationMinutes,
          order: Math.min(order, 999),
          criteria: l.draft.criteria.trim() === "" ? null : l.draft.criteria.trim(),
          subdomain: l.draft.area === "business" || l.draft.area === "work" ? l.draft.subdomain : null,
        });
      });

      const res = await commitPlan({ mode, starred: remappedStarred, crowned: remappedCrowned, lines: planLines, removed });
      if ("error" in res) {
        setError(res.error);
        return "failed";
      }
      const messages = [
        res.killListOverflow.length > 0 ? `Your Kill List is already full, so these stayed off it: ${res.killListOverflow.join(", ")}.` : null,
        ...res.notices,
      ].filter((m): m is string => m !== null);
      setNotice(messages.length > 0 ? messages.join(" ") : null);
      setRemoved([]);
      setSaved(true);
      setDirty(false);
      if (messages.length === 0) onSaved?.();
      // The nightly close ends here: one press saves AND goes Home (Edit Plan is there if it needs a change).
      // With a notice to read (e.g. the Kill List was full) it stays, so the message isn't lost.
      if (mode === "tonight" && messages.length === 0) router.push("/");
      return messages.length === 0 ? "saved" : "notice";
    }
  }

  function commit() {
    startTransition(async () => {
      await runCommit();
    });
  }

  // Edit Plan (today) has no Save button: the dialog asks for this when it is being closed (X, Esc, a tap outside).
  // True = nothing is left unsaved and it can close; false = it stays open, showing the error or notice.
  const [saving, setSaving] = useState(false);
  async function flush(): Promise<boolean> {
    if (!dirty) return true;
    setSaving(true);
    try {
      return (await runCommit()) === "saved";
    } finally {
      setSaving(false);
    }
  }
  useEffect(() => {
    registerFlush?.(flush);
  });

  return (
    <section aria-labelledby="close-plan-heading" className="space-y-4">
      <h2 id="close-plan-heading" className="text-sm font-medium text-muted-foreground">
        Plan {mode === "today" ? "today" : "tomorrow"}
      </h2>

      {carryable.length > 0 ? (
        <div data-testid="close-carry-over" role="group" aria-labelledby="close-carry-heading" className="space-y-2 rounded-md border p-3">
          <h3 id="close-carry-heading" className="text-xs font-medium text-muted-foreground">
            Unfinished today · {carryable.length}
          </h3>
          <ul className="space-y-1">
            {carryable.map((c) => (
              <li key={c.id}>
                <label className="flex min-h-9 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={!carryUnticked.has(c.id)}
                    onChange={(e) =>
                      setCarryUnticked((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.delete(c.id);
                        else next.add(c.id);
                        return next;
                      })
                    }
                  />
                  {c.title}
                </label>
              </li>
            ))}
          </ul>
          <button
            type="button"
            data-testid="close-carry-over-button"
            onClick={carryOverSelected}
            disabled={pending || carryable.every((c) => carryUnticked.has(c.id))}
            className="min-h-9 rounded-md border px-3 text-sm transition-colors enabled:hover:bg-accent disabled:opacity-50"
          >
            Carry over to tomorrow
          </button>
        </div>
      ) : null}

      {inboxItems.length > 0 ? (
        <div data-testid="close-inbox" aria-labelledby="close-inbox-heading" role="group" className="space-y-2">
          <h3 id="close-inbox-heading" className="text-xs font-medium text-muted-foreground">
            Inbox · {inboxItems.length}
          </h3>
          <ul className="space-y-2">
            {inboxItems.map((item) => (
              <li key={item.id} className="space-y-1.5 rounded-md border p-2">
                <p className="text-sm">{item.title}</p>
                <div className="flex flex-wrap gap-1.5">
                  <InboxButton label={mode === "today" ? "Plan today" : "Plan tonight"} onClick={() => triage(item, "plan")} title={item.title} />
                  {inboxAreas.map((a) => (
                    <InboxButton key={a.value} label={`Task in ${a.label}`} onClick={() => triage(item, a.value)} title={item.title} />
                  ))}
                  <InboxButton label="It's a worry" onClick={() => triage(item, "worry")} title={item.title} />
                  <InboxButton label="Done" onClick={() => triage(item, "done")} title={item.title} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="What's on your mind?"
          aria-label="Dump a line"
          className="h-10 flex-1 rounded-md border bg-background px-3 text-sm"
        />
        <button
          type="button"
          onClick={add}
          disabled={pending || draft.trim().length === 0}
          className="h-10 shrink-0 rounded-md border px-3 text-sm transition-colors enabled:hover:bg-accent disabled:opacity-50"
        >
          Add
        </button>
      </div>

      {lines.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Everything on your mind, then star three, then crown one. An empty list is a real answer.
        </p>
      ) : (
        <>
          {lines.length > 1 ? (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setExpanded(anyOpen ? new Set() : new Set(lines.map((l) => l.id)))}
                className="min-h-8 px-1 text-xs text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
              >
                {anyOpen ? "Collapse all" : "Expand all"}
              </button>
            </div>
          ) : null}
          <ul className="space-y-2">
            {lines.map((l, index) => {
              const isStarred = starred.includes(l.id);
              const isCrowned = crowned === l.id;
              const isOpen = expanded.has(l.id);
              const summary = planDraftSummary({ ...l.draft, addToKillList: l.draft.addToKillList && killList }, workTabs);
              return (
                <li key={l.id} className="space-y-2 rounded-md border p-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleStar(l.id)}
                      aria-pressed={isStarred}
                      aria-label={isStarred ? `Unstar ${l.title}` : `Star ${l.title}`}
                      hidden={!isStarred && atStarCap}
                      className="shrink-0 text-sm"
                    >
                      {isStarred ? "★" : "☆"}
                    </button>
                    <span className="min-w-0 flex-1 break-words text-sm">{l.title}</span>
                    {l.seedSource ? (
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[0.65rem] text-muted-foreground">
                        {l.seedSource === "worry" ? "worry" : l.seedSource === "goal_milestone" ? "goal" : "school"}
                      </span>
                    ) : null}
                    {/* The crown affordance exists ONLY for starred lines. That is
                        the two-stage narrowing, enforced by absence. */}
                    {isStarred ? (
                      <button
                        type="button"
                        onClick={() => {
                          markDirty();
                          setCrowned(isCrowned ? null : l.id);
                        }}
                        aria-pressed={isCrowned}
                        aria-label={isCrowned ? `Remove crown from ${l.title}` : `Crown ${l.title}`}
                        className="shrink-0 rounded border px-2 py-0.5 text-xs transition-colors hover:bg-accent"
                      >
                        {isCrowned ? "Crowned" : "Crown"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => toggleOpen(l.id)}
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? "Hide" : "Show"} details for ${l.title}`}
                      data-testid="plan-line-chevron"
                      className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <ChevronDown aria-hidden className={`size-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => toggleOpen(l.id)}
                      aria-expanded={isOpen}
                      aria-label={`Details for ${l.title}`}
                      data-testid="plan-line-details-toggle"
                      className="min-h-8 rounded-md border border-dashed px-2.5 text-xs text-muted-foreground aria-expanded:border-primary aria-expanded:text-primary"
                    >
                      {summary.length > 0 ? summary.join(" · ") : "Add domain, time, timer or criteria"}
                    </button>
                    <span className="ml-auto flex items-center gap-1">
                      <button type="button" onClick={() => move(l.id, -1)} disabled={index === 0} aria-label={`Move ${l.title} up`} className="min-h-8 min-w-8 rounded border text-xs transition-colors enabled:hover:bg-accent disabled:opacity-30">
                        ↑
                      </button>
                      <button type="button" onClick={() => move(l.id, 1)} disabled={index === lines.length - 1} aria-label={`Move ${l.title} down`} className="min-h-8 min-w-8 rounded border text-xs transition-colors enabled:hover:bg-accent disabled:opacity-30">
                        ↓
                      </button>
                      {l.seedSource === "worry" ? (
                        <button type="button" onClick={() => dismissWorrySeed(l)} className="px-1 text-xs text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground">
                          Not a worry anymore
                        </button>
                      ) : l.seedSource === "goal_milestone" ? (
                        <button type="button" onClick={() => dismissSeed(l)} className="px-1 text-xs text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground">
                          Not this month
                        </button>
                      ) : l.seedSource === "school_risk" ? (
                        <button type="button" onClick={() => dismissSeed(l)} className="px-1 text-xs text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground">
                          Not tonight
                        </button>
                      ) : (
                        <button type="button" onClick={() => removeLine(l)} aria-label={`Remove ${l.title}`} className="px-1 text-xs text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground">
                          Remove
                        </button>
                      )}
                    </span>
                  </div>

                  {isOpen ? (
                    <PlanLineDetails
                      id={l.id}
                      title={l.title}
                      draft={l.draft}
                      onChange={(next) => setLineDraft(l.id, next)}
                      areas={areas}
                      killListAvailable={killList}
                      workTabs={workTabs}
                      timezone={timezone}
                      relativeToNow={mode === "today"}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
          {lines.length > 1 ? <p className="text-xs text-muted-foreground">Lines with a start time run in clock order; the rest follow the order here.</p> : null}
        </>
      )}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {notice ? <p data-testid="plan-notice" className="text-sm text-muted-foreground">{notice}</p> : null}

      {/* Edit Plan ("today") always has a Save: domains, times and timers are worth saving with no star or crown.
          The nightly ceremony keeps its rule -- Finish is absent until a crown exists, for the same reason Continue is
          absent while a rewrite is outstanding: a disabled control still says there is a way through. */}
      {mode === "today" ? (
        <p data-testid="plan-autosave" role="status" className="text-xs text-muted-foreground">
          {saving ? "Saving…" : dirty ? "Changes save when you close this." : "Everything is saved."}
        </p>
      ) : crowned !== null ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={commit}
            disabled={pending}
            className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors enabled:hover:bg-primary/85 disabled:opacity-50"
          >
            {saved ? "Saved" : pending ? "Saving…" : "Finish"}
          </button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {starred.length === 0 ? "Star up to three." : `${starred.length} starred. Crown one to finish.`}
        </p>
      )}
      {mode === "tonight" ? <p className="text-xs text-muted-foreground">Domains, times and timers are saved when you Finish.</p> : null}

      {/* IA-P2: the close ends on "Done for today" -- Home shows the same state from here on. A clean Finish goes straight
          Home (commit()); this card is only left behind when there is a notice to read first. */}
      {saved && mode === "tonight" && notice ? (
        <div role="status" data-testid="close-done" className="rounded-lg border border-primary/40 bg-primary/5 p-4">
          <p className="text-sm font-medium">Done for today.</p>
          <p className="mt-1 text-xs text-muted-foreground">Tomorrow&apos;s plan is set. Rest well.</p>
          <a href="/" className="mt-3 inline-flex h-9 items-center rounded-md border px-3 text-sm">
            Back to Home
          </a>
        </div>
      ) : null}
    </section>
  );
}

function InboxButton({ label, onClick, title }: { label: string; onClick: () => void; title: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={`${label}: ${title}`} className="min-h-9 rounded-md border px-2.5 text-xs transition-colors hover:bg-accent">
      {label}
    </button>
  );
}
