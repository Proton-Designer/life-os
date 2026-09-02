import { describe, expect, it } from "vitest";
import {
  DOMAIN_KEYS,
  STEP,
  TOTAL_MINUTES,
  decrement,
  emptyAllocation,
  increment,
  minutesFor,
  setMinutes,
  wastedMinutes,
  type Allocation,
  type DomainKey,
} from "../allocation";

function isMultipleOf15(n: number): boolean {
  return n % STEP === 0;
}

describe("wastedMinutes", () => {
  it("is TOTAL when nothing is allocated", () => {
    expect(wastedMinutes(emptyAllocation())).toBe(TOTAL_MINUTES);
  });

  it("is TOTAL minus the sum of allocations", () => {
    const a: Allocation = { deen: 15, business: 60, school: 0, fitness: 0, co_op: 0 };
    expect(wastedMinutes(a)).toBe(45);
  });

  it("floors at 0 rather than going negative", () => {
    // Not reachable via the public operations, but wastedMinutes itself must
    // never report negative for a hypothetical over-allocated row (e.g. one
    // written directly to the DB by something other than these functions).
    const a: Allocation = { deen: 120, business: 30, school: 0, fitness: 0, co_op: 0 };
    expect(wastedMinutes(a)).toBe(0);
  });
});

describe("increment", () => {
  it("adds a full STEP when the pool has room", () => {
    const a = increment(emptyAllocation(), "deen");
    expect(a.deen).toBe(15);
    expect(wastedMinutes(a)).toBe(105);
  });

  it("adds only what's left of the pool when less than STEP remains", () => {
    let a: Allocation = { deen: 0, business: 0, school: 0, fitness: 0, co_op: 0 };
    // Fill the pool to exactly 105 assigned, 15 wasted, via a domain that
    // isn't the one under test, then increment past the remaining 15.
    for (let i = 0; i < 7; i++) a = increment(a, "business"); // 105 assigned, 15 wasted
    a = increment(a, "deen"); // takes exactly the remaining 15
    expect(a.deen).toBe(15);
    expect(wastedMinutes(a)).toBe(0);
  });

  it("is a no-op, not an error, at a full pool", () => {
    let a: Allocation = emptyAllocation();
    for (let i = 0; i < 8; i++) a = increment(a, "school"); // fills the pool
    expect(wastedMinutes(a)).toBe(0);
    const before = a;
    const after = increment(a, "deen");
    expect(after).toEqual(before);
  });
});

describe("decrement", () => {
  it("subtracts a full STEP and returns it to the pool", () => {
    let a = increment(emptyAllocation(), "deen");
    a = increment(a, "deen"); // deen: 30
    const before = wastedMinutes(a);
    a = decrement(a, "deen");
    expect(a.deen).toBe(15);
    expect(wastedMinutes(a)).toBe(before + STEP);
  });

  it("floors at 0 and is a no-op below that", () => {
    const a = emptyAllocation();
    const after = decrement(a, "deen");
    expect(after).toEqual(a);
  });

  it("frees exactly the decremented amount for another domain to consume", () => {
    let a: Allocation = emptyAllocation();
    for (let i = 0; i < 8; i++) a = increment(a, "school"); // full pool, school: 120
    a = decrement(a, "school"); // school: 105, wasted: 15
    expect(wastedMinutes(a)).toBe(15);
    a = increment(a, "fitness"); // should succeed for exactly the freed 15
    expect(a.fitness).toBe(15);
    expect(wastedMinutes(a)).toBe(0);
  });
});

describe("setMinutes (drag entry point)", () => {
  it("snaps to the nearest STEP", () => {
    const a = setMinutes(emptyAllocation(), "deen", 22);
    expect(a.deen).toBe(15);
    const b = setMinutes(emptyAllocation(), "deen", 23);
    expect(b.deen).toBe(30);
  });

  it("clamps a negative request to 0", () => {
    const a = setMinutes(emptyAllocation(), "deen", -30);
    expect(a.deen).toBe(0);
  });

  it("clamps a request beyond own + wasted to exactly own + wasted", () => {
    let a: Allocation = emptyAllocation();
    for (let i = 0; i < 4; i++) a = increment(a, "business"); // business: 60, wasted: 60
    a = setMinutes(a, "deen", 999); // deen's ceiling is 0 + 60
    expect(a.deen).toBe(60);
    expect(wastedMinutes(a)).toBe(0);
  });

  it("lets a domain keep its own existing minutes plus the free pool, not just the pool", () => {
    let a: Allocation = emptyAllocation();
    a = setMinutes(a, "deen", 30); // deen: 30, wasted: 90
    a = setMinutes(a, "deen", 500); // ceiling is 30 (own) + 90 (wasted) = 120
    expect(a.deen).toBe(120);
  });

  // Regression: a drag handler derives `requested` from pointer position
  // over element width; width 0 (not yet laid out, hidden breakpoint,
  // mid-transition) divides-by-zero into NaN. Every arithmetic guard here
  // (Math.max/min/round) passes NaN through silently, which corrupted the
  // domain's value permanently and made every subsequent operation return
  // NaN too, since wastedMinutes(a) itself becomes NaN once one field is.
  // Found by the Opus Lead's adversarial sweep — the seeded property test
  // below only generated valid random inputs, never garbage ones.
  it.each([NaN, undefined])("is a no-op for non-finite requested that resolves to NaN (%s)", (bad) => {
    let a: Allocation = emptyAllocation();
    a = setMinutes(a, "deen", 30);
    const before = a;
    // @ts-expect-error — exercising a hostile runtime value, not the declared type
    const after = setMinutes(a, "deen", bad);
    expect(after).toEqual(before);
    expect(Number.isFinite(wastedMinutes(after))).toBe(true);
  });

  it("still clamps Infinity/-Infinity correctly rather than treating them as a no-op", () => {
    let a: Allocation = emptyAllocation();
    a = setMinutes(a, "business", 30); // business: 30, wasted: 90
    expect(setMinutes(a, "deen", Infinity).deen).toBe(90); // ceiling = deen's own (0) + wasted (90)
    expect(setMinutes(a, "deen", -Infinity).deen).toBe(0);
  });
});

// Ruling (b): Allocation must not be closed to the 5 legacy domain keys —
// a user-created Work subdomain (or any future registry key) has to be
// able to hold real allocation minutes through exactly the same pure pool
// math, with no separate code path. This is the type-level widening most
// of the other tests in this file don't exercise (they all pass DOMAIN_KEYS
// literals, which remain valid — this proves something NEITHER in that
// list works too).
describe("Allocation admits keys outside the legacy 5 (ruling b)", () => {
  it("emptyAllocation accepts an arbitrary key list, not just the legacy default", () => {
    const a = emptyAllocation(["acme_inc", "night_shift"]);
    expect(a).toEqual({ acme_inc: 0, night_shift: 0 });
  });

  it("increment/decrement/setMinutes work identically for a non-legacy key", () => {
    let a = emptyAllocation(["acme_inc"]);
    a = increment(a, "acme_inc");
    expect(a.acme_inc).toBe(15);
    expect(wastedMinutes(a)).toBe(105);
    a = decrement(a, "acme_inc");
    expect(a.acme_inc).toBe(0);
    a = setMinutes(a, "acme_inc", 47);
    expect(a.acme_inc).toBe(45);
  });

  it("a mix of legacy and non-legacy keys shares one pool correctly", () => {
    let a = emptyAllocation(["deen", "acme_inc"]);
    a = increment(a, "deen"); // deen: 15
    a = increment(a, "acme_inc"); // acme_inc: 15
    expect(wastedMinutes(a)).toBe(90);
  });

  it("emptyAllocation with no argument still defaults to the legacy 5 (unchanged for every existing caller)", () => {
    expect(emptyAllocation()).toEqual({ deen: 0, business: 0, school: 0, fitness: 0, co_op: 0 });
  });
});

// Opus Lead's caution on ruling (b): Record<DomainKey, number> guaranteed
// every key existed; the open Allocation map does not. Bare `a[domain]`
// used to be safely `number` and is now silently `undefined` for a key the
// object never had — invisible to tsc since noUncheckedIndexedAccess isn't
// on, and NaN-through-arithmetic is the null-is-never-zero rule failing in
// the direction nobody notices. These prove the distinction is real and
// that reading through `minutesFor` (not a bare index) keeps a ratio
// calculation correct rather than corrupted, even for a genuinely sparse
// allocation object.
describe("a missing key is not silently 0 — ruling (b)'s NaN risk, closed via minutesFor", () => {
  it("bare bracket access on a missing key is undefined, not 0 — the distinction the risk depends on is real", () => {
    const a: Allocation = { deen: 30 };
    expect(a.business).toBeUndefined();
    expect(a.business).not.toBe(0);
  });

  it("minutesFor returns an explicit 0 for a missing key, never undefined", () => {
    const a: Allocation = { deen: 30 };
    expect(minutesFor(a, "business")).toBe(0);
  });

  it("a sum built from bare indexing into a sparse allocation goes NaN — the exact failure mode the Lead flagged", () => {
    const a: Allocation = { deen: 30 };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately exercising unsafe bare access
    const naiveSum = DOMAIN_KEYS.reduce((sum, k) => sum + (a as any)[k], 0);
    expect(Number.isNaN(naiveSum)).toBe(true);
  });

  it("the same sum built through minutesFor stays a correct, finite ratio input for a sparse allocation", () => {
    const a: Allocation = { deen: 30 };
    const sum = DOMAIN_KEYS.reduce((total, k) => total + minutesFor(a, k), 0);
    expect(sum).toBe(30);
    expect(wastedMinutes(a)).toBe(TOTAL_MINUTES - 30);
  });
});

describe("acceptance criterion 1 — property test: no sequence of operations ever breaks the invariants", () => {
  // Deterministic PRNG (mulberry32) so this is reproducible without adding a
  // property-testing dependency the project doesn't already have. Runs many
  // random operation sequences rather than hand-picked cases, per the spec.
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
  const OPS_PER_RUN = 500;

  for (const seed of SEEDS) {
    it(`holds for ${OPS_PER_RUN} random operations (seed ${seed})`, () => {
      const rand = mulberry32(seed);
      const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];

      let a: Allocation = emptyAllocation();
      for (let i = 0; i < OPS_PER_RUN; i++) {
        const domain: DomainKey = pick(DOMAIN_KEYS);
        const opKind = pick(["increment", "decrement", "setMinutes"] as const);
        if (opKind === "increment") {
          a = increment(a, domain);
        } else if (opKind === "decrement") {
          a = decrement(a, domain);
        } else {
          // Includes negative/out-of-range values AND hostile garbage
          // (NaN, undefined, ±Infinity, non-multiples-of-15) — a purely
          // valid-domain generator is exactly what let the NaN-corruption
          // bug (see the regression tests above) slip past this suite
          // originally.
          const garbage = [NaN, undefined, Infinity, -Infinity, 0.1, 7];
          const requested =
            rand() < 0.2
              ? garbage[Math.floor(rand() * garbage.length)]
              : Math.floor(rand() * 400) - 100;
          // @ts-expect-error — deliberately feeding hostile runtime values
          a = setMinutes(a, domain, requested);
        }

        expect(wastedMinutes(a)).toBeGreaterThanOrEqual(0);
        for (const k of DOMAIN_KEYS) {
          expect(isMultipleOf15(a[k])).toBe(true);
          expect(a[k]).toBeGreaterThanOrEqual(0);
        }
        const sum = DOMAIN_KEYS.reduce((s, k) => s + a[k], 0);
        expect(sum).toBeLessThanOrEqual(TOTAL_MINUTES);
        expect(sum + wastedMinutes(a)).toBe(TOTAL_MINUTES);
      }
    });
  }
});
