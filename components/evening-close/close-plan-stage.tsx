"use client";

import { useState, useTransition } from "react";
import { dumpLine, savePlanRanks, claimSeedLines, type PlanMode, type SeedLine, type SeedSource } from "@/app/(app)/close/plan-actions";
import { MAX_STARRED, type DumpItem } from "@/lib/night-plan/night-plan";
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
 * SEEDED LINES (#28/#45, `seeds` prop) are worries and unfinished goal
 * milestones — real candidates for tonight's dump that are NOT yet `tasks`
 * rows for this `plannedDate`. They render exactly like a typed line (star,
 * crown, or leave alone) with one extra action: "Not a worry anymore" /
 * "Not this month", which marks the underlying worry Handled (reusing
 * `/worries`' own action) or simply drops the milestone line from view. That
 * IS this ceremony's "removing a seeded line is a planning act" — a seed
 * left alone (neither starred nor dismissed) reappears next time, which is
 * correct for something still genuinely unresolved.
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

function isSeedable(item: DumpItem): item is DumpItem & { source: SeedSource } {
  return item.source === "worry" || item.source === "goal_milestone";
}

export function ClosePlanStage({
  initialLines,
  seeds = [],
  mode = "tonight",
}: {
  initialLines: { id: string; title: string }[];
  seeds?: DumpItem[];
  mode?: PlanMode;
}) {
  const [lines, setLines] = useState<Line[]>([
    ...initialLines,
    ...seeds.filter(isSeedable).map((s) => ({ id: s.id, title: s.title, seedSource: s.source })),
  ]);
  const [starred, setStarred] = useState<string[]>([]);
  const [crowned, setCrowned] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const atStarCap = starred.length >= MAX_STARRED;

  function add() {
    const title = draft.trim();
    if (title.length === 0) return;
    setError(null);
    startTransition(async () => {
      const res = await dumpLine(title, mode);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setLines((prev) => [...prev, { id: res.id, title }]);
      setDraft("");
    });
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

  function commit() {
    setError(null);
    startTransition(async () => {
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

      const res = await savePlanRanks(remappedStarred, remappedCrowned, mode);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setSaved(true);
    });
  }

  return (
    <section aria-labelledby="close-plan-heading" className="space-y-4">
      <h2 id="close-plan-heading" className="text-sm font-medium text-muted-foreground">
        Plan {mode === "today" ? "today" : "tomorrow"}
      </h2>

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
                    {l.seedSource === "worry" ? "worry" : "goal"}
                  </span>
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
              </li>
            );
          })}
        </ul>
      )}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

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
    </section>
  );
}
