import { describe, expect, it } from "vitest";
import {
  DOMAIN_KEYS,
  STEP,
  TOTAL_MINUTES,
  decrement,
  emptyAllocation,
  increment,
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
          const requested = Math.floor(rand() * 400) - 100; // includes negative and out-of-range
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
