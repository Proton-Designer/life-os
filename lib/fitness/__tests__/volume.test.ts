import { describe, expect, it } from "vitest";
import { MUSCLE_GROUPS, untaggedCount, weeklyVolume, type MuscleGroup, type SetEntry } from "../volume";

function zero(): Record<MuscleGroup, number> {
  const r = {} as Record<MuscleGroup, number>;
  for (const m of MUSCLE_GROUPS) r[m] = 0;
  return r;
}

describe("weeklyVolume", () => {
  it("returns a full record of zeros for no entries", () => {
    expect(weeklyVolume([])).toEqual(zero());
  });

  it("credits a single primary mover 1.0 per set, no secondary", () => {
    const entries: SetEntry[] = [{ sets: 3, primaryMuscles: ["chest"], secondaryMuscles: [] }];
    const result = weeklyVolume(entries);
    expect(result.chest).toBe(3);
    expect(result.back_lats).toBe(0);
  });

  it("credits a secondary mover 0.5 per set", () => {
    const entries: SetEntry[] = [{ sets: 4, primaryMuscles: ["chest"], secondaryMuscles: ["triceps"] }];
    const result = weeklyVolume(entries);
    expect(result.chest).toBe(4);
    expect(result.triceps).toBe(2);
  });

  it("sums across multiple entries hitting the same muscle group", () => {
    const entries: SetEntry[] = [
      { sets: 3, primaryMuscles: ["back_lats"], secondaryMuscles: ["biceps"] },
      { sets: 3, primaryMuscles: ["back_lats"], secondaryMuscles: ["biceps"] },
    ];
    const result = weeklyVolume(entries);
    expect(result.back_lats).toBe(6);
    expect(result.biceps).toBe(3);
  });

  it("equals sum(sets) for a set of entries that each have exactly one primary and no secondary", () => {
    const entries: SetEntry[] = [
      { sets: 3, primaryMuscles: ["side_delt"], secondaryMuscles: [] },
      { sets: 5, primaryMuscles: ["side_delt"], secondaryMuscles: [] },
      { sets: 2, primaryMuscles: ["side_delt"], secondaryMuscles: [] },
    ];
    const totalSets = entries.reduce((sum, e) => sum + e.sets, 0);
    expect(weeklyVolume(entries).side_delt).toBe(totalSets);
  });

  it("an entry with N secondaries (no primary) contributes exactly 0.5 * sets * N, spread across the N groups", () => {
    const entries: SetEntry[] = [
      { sets: 4, primaryMuscles: [], secondaryMuscles: ["rear_delt", "core", "biceps"] },
    ];
    const result = weeklyVolume(entries);
    const total = result.rear_delt + result.core + result.biceps;
    expect(total).toBe(0.5 * 4 * 3);
    expect(result.rear_delt).toBe(2);
    expect(result.core).toBe(2);
    expect(result.biceps).toBe(2);
  });

  it("RULING: a muscle in both primary and secondary credits 1.0, not 1.5 — primary wins", () => {
    const entries: SetEntry[] = [
      { sets: 3, primaryMuscles: ["chest"], secondaryMuscles: ["chest", "back_lats"] },
    ];
    const result = weeklyVolume(entries);
    expect(result.chest).toBe(3); // not 4.5
    expect(result.back_lats).toBe(1.5); // unaffected — different muscle
  });

  it("collapses duplicate muscles within the same primary array to a single credit", () => {
    const entries: SetEntry[] = [{ sets: 3, primaryMuscles: ["chest", "chest"], secondaryMuscles: [] }];
    expect(weeklyVolume(entries).chest).toBe(3); // not 6
  });

  it("collapses duplicate muscles within the same secondary array to a single credit", () => {
    const entries: SetEntry[] = [{ sets: 4, primaryMuscles: [], secondaryMuscles: ["triceps", "triceps"] }];
    expect(weeklyVolume(entries).triceps).toBe(2); // not 4
  });

  it("adding an entry never decreases any group's total (monotonicity over a growing list)", () => {
    const base: SetEntry[] = [
      { sets: 3, primaryMuscles: ["chest"], secondaryMuscles: ["triceps"] },
      { sets: 3, primaryMuscles: ["back_lats"], secondaryMuscles: ["biceps"] },
    ];
    const before = weeklyVolume(base);
    const after = weeklyVolume([...base, { sets: 3, primaryMuscles: ["core"], secondaryMuscles: [] }]);
    for (const m of MUSCLE_GROUPS) {
      expect(after[m]).toBeGreaterThanOrEqual(before[m]);
    }
  });

  it("result is never negative for any single entry (spot check)", () => {
    const entries: SetEntry[] = [{ sets: 3, primaryMuscles: ["chest"], secondaryMuscles: ["triceps"] }];
    const result = weeklyVolume(entries);
    for (const m of MUSCLE_GROUPS) expect(result[m]).toBeGreaterThanOrEqual(0);
  });

  describe("adversarial inputs — each decided and documented, not accidental", () => {
    it("NaN sets contributes nothing (sanitized to 0, not propagated as NaN)", () => {
      const entries: SetEntry[] = [{ sets: NaN, primaryMuscles: ["chest"], secondaryMuscles: [] }];
      const result = weeklyVolume(entries);
      expect(result.chest).toBe(0);
      expect(Number.isFinite(result.chest)).toBe(true);
    });

    it("Infinity sets contributes nothing rather than an infinite total", () => {
      const entries: SetEntry[] = [{ sets: Infinity, primaryMuscles: ["chest"], secondaryMuscles: [] }];
      expect(weeklyVolume(entries).chest).toBe(0);
    });

    it("-0 sets contributes nothing (treated as zero, not negative)", () => {
      const entries: SetEntry[] = [{ sets: -0, primaryMuscles: ["chest"], secondaryMuscles: [] }];
      expect(weeklyVolume(entries).chest).toBe(0);
    });

    it("negative sets contributes nothing rather than subtracting volume", () => {
      const entries: SetEntry[] = [
        { sets: 3, primaryMuscles: ["chest"], secondaryMuscles: [] },
        { sets: -5, primaryMuscles: ["chest"], secondaryMuscles: [] },
      ];
      expect(weeklyVolume(entries).chest).toBe(3); // not -2
    });

    it("an unrecognized muscle-group string is ignored, not credited to nothing catastrophically nor thrown", () => {
      const entries = [
        { sets: 3, primaryMuscles: ["chest", "made_up_muscle"], secondaryMuscles: [] },
      ] as unknown as SetEntry[];
      expect(() => weeklyVolume(entries)).not.toThrow();
      expect(weeklyVolume(entries).chest).toBe(3);
    });

    it("an entry whose arrays are entirely unrecognized strings contributes nothing", () => {
      const entries = [{ sets: 5, primaryMuscles: ["nope"], secondaryMuscles: ["also_nope"] }] as unknown as SetEntry[];
      const result = weeklyVolume(entries);
      for (const m of MUSCLE_GROUPS) expect(result[m]).toBe(0);
    });

    it("null/undefined entries array does not throw", () => {
      expect(() => weeklyVolume(null as unknown as SetEntry[])).not.toThrow();
      expect(() => weeklyVolume(undefined as unknown as SetEntry[])).not.toThrow();
    });

    it("missing primaryMuscles/secondaryMuscles on an entry does not throw", () => {
      const entries = [{ sets: 3 }] as unknown as SetEntry[];
      expect(() => weeklyVolume(entries)).not.toThrow();
    });
  });
});

describe("untaggedCount", () => {
  it("counts entries with both arrays empty", () => {
    const entries: SetEntry[] = [
      { sets: 3, primaryMuscles: [], secondaryMuscles: [] },
      { sets: 3, primaryMuscles: ["chest"], secondaryMuscles: [] },
    ];
    expect(untaggedCount(entries)).toBe(1);
  });

  it("counts an entry whose arrays are entirely unrecognized strings as untagged too", () => {
    const entries = [{ sets: 3, primaryMuscles: ["not_real"], secondaryMuscles: [] }] as unknown as SetEntry[];
    expect(untaggedCount(entries)).toBe(1);
  });

  it("returns 0 for an empty list", () => {
    expect(untaggedCount([])).toBe(0);
  });

  it("returns 0, not a throw, for a null/undefined entries array", () => {
    expect(untaggedCount(null as unknown as SetEntry[])).toBe(0);
    expect(untaggedCount(undefined as unknown as SetEntry[])).toBe(0);
  });

  it("counts an entry missing both muscle-array fields entirely as untagged", () => {
    const entries = [{ sets: 3 }] as unknown as SetEntry[];
    expect(untaggedCount(entries)).toBe(1);
  });

  it("counts an entry with a non-empty but entirely-unrecognized secondaryMuscles array as untagged", () => {
    const entries: SetEntry[] = [{ sets: 3, primaryMuscles: [], secondaryMuscles: ["not_real" as never] }];
    expect(untaggedCount(entries)).toBe(1);
  });
});

// docs/superpowers/plans/2026-08-20-fitness-redesign.md Phase 2 Step 2/3 —
// property test over >=20,000 randomized entries, including adversarial
// (invalid) inputs, not just valid ones. Same deterministic-PRNG technique
// as lib/checkins/__tests__/allocation.test.ts (mulberry32) rather than
// adding a property-testing dependency the project doesn't already have.
describe("property test: weeklyVolume invariants hold over >=20,000 randomized entries", () => {
  function mulberry32(seed: number) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const SEEDS = [1, 2, 3, 4, 5];
  const ENTRIES_PER_RUN = 4000; // 5 seeds * 4000 = 20,000

  const GARBAGE_SETS = [NaN, Infinity, -Infinity, -0, -7, 0];
  const GARBAGE_MUSCLES = ["not_a_muscle", "", "CHEST", "chest "];

  function randomMuscleList(rand: () => number, pick: <T>(arr: T[]) => T): MuscleGroup[] {
    const n = Math.floor(rand() * 3); // 0-2 entries, may include duplicates or garbage
    const list: MuscleGroup[] = [];
    for (let i = 0; i < n; i++) {
      list.push(rand() < 0.15 ? (pick(GARBAGE_MUSCLES) as unknown as MuscleGroup) : pick([...MUSCLE_GROUPS]));
    }
    return list;
  }

  for (const seed of SEEDS) {
    it(`holds for ${ENTRIES_PER_RUN} random entries (seed ${seed})`, () => {
      const rand = mulberry32(seed);
      const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];

      const entries: SetEntry[] = [];
      let prevResult = weeklyVolume(entries);

      for (let i = 0; i < ENTRIES_PER_RUN; i++) {
        const sets = rand() < 0.2 ? (pick(GARBAGE_SETS) as number) : Math.floor(rand() * 10);
        const primaryMuscles = randomMuscleList(rand, pick);
        const secondaryMuscles = randomMuscleList(rand, pick);
        entries.push({ sets, primaryMuscles, secondaryMuscles });

        // Check every 200 entries rather than every single one — 20,000
        // full-array recomputations plus assertions would make this suite
        // slow without adding coverage the sampled checks don't already give.
        if (i % 200 !== 0) continue;

        const result = weeklyVolume(entries);

        for (const m of MUSCLE_GROUPS) {
          expect(Number.isFinite(result[m])).toBe(true);
          expect(result[m]).toBeGreaterThanOrEqual(0);
          // Monotonicity: appending entries never decreases any group's total.
          expect(result[m]).toBeGreaterThanOrEqual(prevResult[m]);
        }

        prevResult = result;
      }
    });
  }
});
