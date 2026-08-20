/**
 * spec §6 — ONE object, two lines, always rendered together. No prop lets a
 * caller show weight without waist or vice versa: there is no `weightOnly`
 * escape hatch, no conditional render around either line. During a
 * successful recomposition the scale can sit flat for months while waist
 * moves — weight alone would tell him he's failing during the exact period
 * he's succeeding, which is the failure mode this structural pairing
 * exists to make impossible, not just discourage.
 *
 * Weight always displays as the 7-day rolling average, never the raw daily
 * reading (day-to-day variation is 1.5-3 lb of water). `null` renders as an
 * honest "—" rather than a fabricated 0 or a hidden line.
 */
export function BodyModule({
  weightAvg7d,
  waist,
}: {
  weightAvg7d: number | null;
  waist: { valueIn: number; date: string } | null;
}) {
  return (
    <div className="flex flex-col gap-1 text-sm" data-testid="body-module">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">Weight</span>
        <span className="tabular-nums">
          {weightAvg7d !== null ? `${weightAvg7d} lb` : "—"}
          {weightAvg7d !== null && <span className="ml-1.5 text-xs text-muted-foreground">7-day avg</span>}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">Waist</span>
        <span className="tabular-nums">
          {waist ? `${waist.valueIn} in` : "—"}
          {waist && (
            <span className="ml-1.5 text-xs text-muted-foreground">
              {/* Caught live: toLocaleDateString with no timeZone reads the
                  server's LOCAL system clock, which rolled a UTC-midnight
                  date back a day whenever that local offset is negative
                  (e.g. logging "2026-08-20" displayed as "Aug 19"). This is
                  a plain calendar date, not a moment in time, so it must
                  format against UTC — the same zone it was constructed
                  with — not whatever zone the process happens to run in. */}
              {new Date(`${waist.date}T00:00:00Z`).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                timeZone: "UTC",
              })}
            </span>
          )}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Body fat is mostly a diet outcome — training shapes what&apos;s underneath it.
      </p>
    </div>
  );
}
