"use client";

import { useState, useTransition } from "react";
import { dumpLine, savePlanRanks } from "@/app/(app)/close/plan-actions";
import { MAX_STARRED } from "@/lib/night-plan/night-plan";

/**
 * Stage (c): dump → star three → crown one, in that order.
 *
 * The order is the mechanism, not a flow. This component renders only the
 * affordance for the step the user is actually on — so a crown control never
 * sits beside an unstarred line, which is how "dump → star → crown" collapses
 * into "pick your top item" and loses the two-stage narrowing that makes the
 * crown cost something.
 *
 * A FOURTH STAR IS REFUSED, NOT ABSORBED. No silent eviction of the oldest:
 * SPEC §2 — "a cap that quietly drops something turns a deliberate choice into
 * a queue". The star control is HIDDEN at the cap rather than left live, because
 * a control that accepts input and discards it is worse than one that isn't there.
 *
 * Server actions are IMPORTED here, not passed down as props. A function prop
 * from a Server Component is the RSC boundary bug AGENTS.md records twice;
 * importing removes the hazard rather than testing for it.
 */

type Line = { id: string; title: string };

export function ClosePlanStage({ initialLines }: { initialLines: Line[] }) {
  const [lines, setLines] = useState<Line[]>(initialLines);
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
      const res = await dumpLine(title);
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

  function commit() {
    setError(null);
    startTransition(async () => {
      const res = await savePlanRanks(starred, crowned);
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
        Plan tomorrow
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
