import { MUSCLE_GROUPS, type MuscleGroup } from "@/lib/fitness/volume";

// 12-20 sets/muscle/week optimal range (spec §8, Baz-Valle et al. 2022 /
// Schoenfeld/Ogborn/Krieger 2017) — the band this hero reads volume
// against, not a number invented here.
const OPTIMAL_MIN = 12;
const OPTIMAL_MAX = 20;

const MUSCLE_LABEL: Record<MuscleGroup, string> = {
  chest: "Chest",
  back_lats: "Lats",
  back_mid: "Mid back",
  front_delt: "Front delt",
  side_delt: "Side delt",
  rear_delt: "Rear delt",
  biceps: "Biceps",
  triceps: "Triceps",
  core: "Core",
};

function bandLabel(sets: number): "under" | "in range" | "over" {
  if (sets < OPTIMAL_MIN) return "under";
  if (sets > OPTIMAL_MAX) return "over";
  return "in range";
}

/**
 * Weekly sets per muscle group against the evidence-backed target band,
 * plus an adherence FRACTION — never a streak (spec §9: a daily streak
 * punishes 2x/week-is-fine training and is an anti-signal, not a neutral
 * vanity metric). `adherence` is null for the week-one no-schedule case
 * (spec §5) rather than a manufactured "0/0".
 */
export function VolumeHero({
  volume,
  adherence,
}: {
  volume: Record<MuscleGroup, number>;
  adherence: { confirmed: number; scheduled: number } | null;
}) {
  const trackedGroups = MUSCLE_GROUPS.filter((m) => volume[m] > 0);

  return (
    <div className="flex flex-col gap-3" data-testid="volume-hero">
      {adherence && (
        <p className="font-mono text-2xl font-semibold tabular-nums" data-testid="adherence-fraction">
          {adherence.confirmed}/{adherence.scheduled}
          <span className="ml-2 text-xs font-normal text-muted-foreground">this week</span>
        </p>
      )}

      {trackedGroups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No confirmed sets yet this week.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {trackedGroups.map((m) => (
            <li key={m} className="flex items-center justify-between gap-2" data-testid={`volume-row-${m}`}>
              <span className="text-muted-foreground">{MUSCLE_LABEL[m]}</span>
              <span className="tabular-nums">
                {volume[m]} sets
                <span className="ml-1.5 text-xs text-muted-foreground">{bandLabel(volume[m])}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
