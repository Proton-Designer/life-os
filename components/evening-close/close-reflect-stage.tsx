import type { PlannedItem } from "@/app/(app)/close/actions";

/**
 * Stage (b) of the evening close: reflect.
 *
 * WHAT THIS RENDERS TODAY, AND WHAT IT DOESN'T. BOSS-VISION §6 lists four
 * things for this stage: Hours vs baseline, Day Won, today's three, and any
 * thirty-day verdicts due on promoted lessons. **Only today's three exists as
 * real data in LifeOS right now** — it reads back what last night's close
 * crowned and starred, via migration 113's `planned_date` / `mit_rank`.
 *
 * The other three are CollegeOS concepts with no LifeOS derivation yet, and
 * inventing semantics for "Day Won" here would produce a number that looks
 * authoritative and means whatever I guessed. A missing section is visibly
 * missing; a fabricated one is not.
 *
 * EMPTY IS A REAL ANSWER. No ranked rows for today means no plan was made last
 * night — which is the honest thing to reflect on, not a loading state and not
 * an error. It gets its own sentence rather than an empty list.
 */
export function CloseReflectStage({ todaysThree }: { todaysThree: PlannedItem[] }) {
  const done = todaysThree.filter((t) => t.completed).length;

  return (
    <section aria-labelledby="close-reflect-heading" className="space-y-4">
      <h2 id="close-reflect-heading" className="text-sm font-medium text-muted-foreground">
        Reflect
      </h2>

      {todaysThree.length === 0 ? (
        <div className="rounded-lg border p-4">
          <p className="text-sm">No plan was made for today.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Nothing was crowned last night, so there is nothing to hold today against.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border p-4 space-y-3">
          <p className="text-sm">
            {done} of {todaysThree.length} done
          </p>
          <ul className="space-y-2">
            {todaysThree.map((t) => (
              <li key={t.id} className="flex items-start gap-2 text-sm">
                <span
                  aria-hidden
                  className="mt-0.5 w-5 shrink-0 text-xs tabular-nums text-muted-foreground"
                >
                  {t.mitRank === 1 ? "★" : t.mitRank}
                </span>
                <span className={t.completed ? "line-through text-muted-foreground" : undefined}>{t.title}</span>
                <span className="sr-only">
                  {t.mitRank === 1 ? "crowned, " : `rank ${t.mitRank}, `}
                  {t.completed ? "done" : "not done"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
