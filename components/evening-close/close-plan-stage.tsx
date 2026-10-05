"use client";

import { useRef, useState, useTransition } from "react";
import { dumpLine, refreshCloseViews, savePlanRanks, claimSeedLines, triageInboxItem, type PlanMode, type SeedLine, type SeedSource } from "@/app/(app)/close/plan-actions";
import { MAX_STARRED, type DumpItem } from "@/lib/night-plan/night-plan";
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
 * Server actions are IMPORTED here, not passed down as props. A function prop
 * from a Server Component is the RSC boundary bug AGENTS.md records twice;
 * importing removes the hazard rather than testing for it.
 */

type Line = { id: string; title: string; seedSource?: SeedSource };
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

export function ClosePlanStage({
  initialLines,
  seeds = [],
  mode = "tonight",
  inbox = [],
  inboxAreas = [],
  killList = false,
}: {
  initialLines: { id: string; title: string }[];
  seeds?: DumpItem[];
  mode?: PlanMode;
  /** IA-P1a: items the "+" sheet parked without an area (Notes, "No area" Tasks), triaged here in one tap each. */
  inbox?: InboxEntry[];
  /** The task homes this account has (School / Work) — one "Make it a task" button per entry. */
  inboxAreas?: InboxAreas;
  /** The account has a Business Kill List: starred lines can be marked "Business" and are mirrored into it on Finish (one top three). */
  killList?: boolean;
}) {
  const [inboxItems, setInboxItems] = useState<InboxEntry[]>(inbox);
  const pendingPlanTriage = useRef(new Map<string, Promise<boolean>>());
  const [lines, setLines] = useState<Line[]>([
    ...initialLines,
    ...seeds.filter(isSeedable).map((s) => ({ id: s.id, title: s.title, seedSource: s.source })),
  ]);
  const [starred, setStarred] = useState<string[]>([]);
  const [crowned, setCrowned] = useState<string | null>(null);
  const [business, setBusiness] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const scheduleRefresh = useScheduleRefresh(refreshClose);

  const atStarCap = starred.length >= MAX_STARRED;

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
        setLines((prev) => [...prev, { id: res.id, title }]);
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
    if (action === "plan") setLines((prev) => [...prev, { id: item.id, title: item.title }]);
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
    // savePlanRanks clears old ranks first and then ranks by planned_date, so ranking an id whose
    // planned_date write is still in flight would clear ranks and then fail (P1a review F1).
    if (action === "plan") pendingPlanTriage.current.set(item.id, write);
  }

  function toggleStar(id: string) {
    setSaved(false);
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

  /** Seeded-worry-only: "this isn't weighing on me anymore" removes the line AND marks the worry Handled — see this file's header on why that IS the SPEC's "removing a seeded line is a planning act". */
  function dismissWorrySeed(line: Line) {
    setLines((prev) => prev.filter((l) => l.id !== line.id));
    setStarred((prev) => prev.filter((x) => x !== line.id));
    if (crowned === line.id) setCrowned(null);
    startTransition(async () => {
      await markWorryHandled(line.id);
    });
  }

  /** Seeded-milestone-only: purely local — nothing was ever claimed for it, so there is nothing to undo server-side. It simply isn't part of tonight's dump. */
  function dismissMilestoneSeed(line: Line) {
    setLines((prev) => prev.filter((l) => l.id !== line.id));
    setStarred((prev) => prev.filter((x) => x !== line.id));
    if (crowned === line.id) setCrowned(null);
  }

  /** Seeded-school-risk-only: same purely-local shape as the milestone dismiss above —
   * nothing is claimed for a school_risk seed until Finish, so there is nothing to undo
   * server-side. It reappears next time getSchoolTodayFeed still finds it due, which is
   * correct: dismissing it here is "not tonight," not "resolved." */
  function dismissSchoolSeed(line: Line) {
    setLines((prev) => prev.filter((l) => l.id !== line.id));
    setStarred((prev) => prev.filter((x) => x !== line.id));
    if (crowned === line.id) setCrowned(null);
  }

  function commit() {
    setError(null);
    startTransition(async () => {
      // Settle in-flight "Plan" triage writes first; if one failed it already put the item back
      // and showed its error, so stop here and let the user finish again.
      const settled = await Promise.all([...pendingPlanTriage.current.values()]);
      if (settled.some((ok) => !ok)) return;
      const seedLines: SeedLine[] = lines
        .filter((l): l is Line & { seedSource: SeedSource } => l.seedSource !== undefined)
        .map((l) => ({ id: l.id, title: l.title, source: l.seedSource }));

      let idMap = new Map<string, string>();
      if (seedLines.length > 0) {
        const claimRes = await claimSeedLines(seedLines, mode);
        if ("error" in claimRes) {
          setError(claimRes.error);
          return;
        }
        idMap = new Map(claimRes.claimed.map((c) => [c.seedId, c.taskId]));
      }
      // A seed dropped mid-claim (someone handled the worry elsewhere) has no
      // entry in idMap — remap drops it from starred/crowned rather than
      // ranking an id that no longer represents tonight's dump.
      const remap = (id: string) => idMap.get(id) ?? (lines.some((l) => l.id === id && !l.seedSource) ? id : null);
      const remappedStarred = starred.map(remap).filter((id): id is string => id !== null);
      const remappedCrowned = crowned === null ? null : remap(crowned);

      const remappedBusiness = killList ? business.map(remap).filter((id): id is string => id !== null) : [];
      const res = remappedBusiness.length > 0 ? await savePlanRanks(remappedStarred, remappedCrowned, mode, remappedBusiness) : await savePlanRanks(remappedStarred, remappedCrowned, mode);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setNotice(res.killListOverflow?.length ? `Your Kill List is already full, so these stayed off it: ${res.killListOverflow.join(", ")}.` : null);
      setSaved(true);
    });
  }

  return (
    <section aria-labelledby="close-plan-heading" className="space-y-4">
      <h2 id="close-plan-heading" className="text-sm font-medium text-muted-foreground">
        Plan {mode === "today" ? "today" : "tomorrow"}
      </h2>

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
          className="h-10 shrink-0 rounded-md border px-3 text-sm disabled:opacity-50"
        >
          Add
        </button>
      </div>

      {lines.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Everything on your mind, then star three, then crown one. An empty list is a real answer.
        </p>
      ) : (
        <ul className="space-y-2">
          {lines.map((l) => {
            const isStarred = starred.includes(l.id);
            const isCrowned = crowned === l.id;
            return (
              <li key={l.id} className="flex items-center gap-2 rounded-md border p-2">
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
                <span className="flex-1 text-sm">{l.title}</span>
                {l.seedSource ? (
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[0.65rem] text-muted-foreground">
                    {l.seedSource === "worry" ? "worry" : l.seedSource === "goal_milestone" ? "goal" : "school"}
                  </span>
                ) : null}
                {/* One top three: a starred line marked Business is mirrored into that day's Kill List on Finish. */}
                {killList && isStarred ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSaved(false);
                      setBusiness((prev) => (prev.includes(l.id) ? prev.filter((x) => x !== l.id) : [...prev, l.id]));
                    }}
                    aria-pressed={business.includes(l.id)}
                    aria-label={business.includes(l.id) ? `Remove ${l.title} from the Kill List` : `Add ${l.title} to the Kill List`}
                    data-testid="plan-business"
                    className="shrink-0 rounded border px-2 py-0.5 text-xs aria-pressed:border-primary aria-pressed:text-primary"
                  >
                    Business
                  </button>
                ) : null}
                {/* The crown affordance exists ONLY for starred lines. That is
                    the two-stage narrowing, enforced by absence. */}
                {isStarred ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSaved(false);
                      setCrowned(isCrowned ? null : l.id);
                    }}
                    aria-pressed={isCrowned}
                    aria-label={isCrowned ? `Remove crown from ${l.title}` : `Crown ${l.title}`}
                    className="shrink-0 rounded border px-2 py-0.5 text-xs"
                  >
                    {isCrowned ? "Crowned" : "Crown"}
                  </button>
                ) : null}
                {l.seedSource === "worry" ? (
                  <button
                    type="button"
                    onClick={() => dismissWorrySeed(l)}
                    className="shrink-0 text-xs text-muted-foreground underline underline-offset-4"
                  >
                    Not a worry anymore
                  </button>
                ) : null}
                {l.seedSource === "goal_milestone" ? (
                  <button
                    type="button"
                    onClick={() => dismissMilestoneSeed(l)}
                    className="shrink-0 text-xs text-muted-foreground underline underline-offset-4"
                  >
                    Not this month
                  </button>
                ) : null}
                {l.seedSource === "school_risk" ? (
                  <button
                    type="button"
                    onClick={() => dismissSchoolSeed(l)}
                    className="shrink-0 text-xs text-muted-foreground underline underline-offset-4"
                  >
                    Not tonight
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {notice ? <p data-testid="plan-notice" className="text-sm text-muted-foreground">{notice}</p> : null}

      {/* Absent until a crown exists, for the same reason Continue is absent
          while a rewrite is outstanding: a disabled control still says there is
          a way through. */}
      {crowned !== null ? (
        <button
          type="button"
          onClick={commit}
          disabled={pending}
          className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {saved ? "Saved" : "Finish"}
        </button>
      ) : (
        <p className="text-xs text-muted-foreground">
          {starred.length === 0 ? "Star up to three." : `${starred.length} starred. Crown one to finish.`}
        </p>
      )}

      {/* IA-P2: the close ends on "Done for today" -- Home shows the same state from here on. */}
      {saved && mode === "tonight" ? (
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
    <button type="button" onClick={onClick} aria-label={`${label}: ${title}`} className="min-h-9 rounded-md border px-2.5 text-xs">
      {label}
    </button>
  );
}
