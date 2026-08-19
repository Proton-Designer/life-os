/**
 * Check-in allocation math — pure functions, no React, no I/O.
 * docs/superpowers/specs/2026-08-19-checkin-allocation-system.md
 *
 * The window is a QUANTITY to divide, not a timeline — there is no ordering
 * or chronology here, only "how much." `wasted` is derived, never an input:
 * it is what's left of the 120-minute pool once every domain's allocation is
 * subtracted. Every operation below clamps against that pool, which is what
 * makes "no operation can ever take minutes from another domain" fall out of
 * the model instead of needing separate enforcement.
 */

export const TOTAL_MINUTES = 120;
export const STEP = 15;

export type DomainKey = "deen" | "business" | "school" | "fitness" | "co_op";

export const DOMAIN_KEYS: DomainKey[] = ["deen", "business", "school", "fitness", "co_op"];

export type Allocation = Record<DomainKey, number>;

export function emptyAllocation(): Allocation {
  return { deen: 0, business: 0, school: 0, fitness: 0, co_op: 0 };
}

function assignedMinutes(a: Allocation): number {
  return DOMAIN_KEYS.reduce((sum, k) => sum + a[k], 0);
}

/** TOTAL - sum(allocations), floored at 0. */
export function wastedMinutes(a: Allocation): number {
  return Math.max(0, TOTAL_MINUTES - assignedMinutes(a));
}

/** Adds min(STEP, wasted) to `domain`. A full pool is a no-op — not an error. */
export function increment(a: Allocation, domain: DomainKey): Allocation {
  const wasted = wastedMinutes(a);
  if (wasted === 0) return a;
  return { ...a, [domain]: a[domain] + Math.min(STEP, wasted) };
}

/** Subtracts min(STEP, a[domain]) from `domain`, floored at 0. Freed minutes return to wasted. */
export function decrement(a: Allocation, domain: DomainKey): Allocation {
  if (a[domain] === 0) return a;
  return { ...a, [domain]: a[domain] - Math.min(STEP, a[domain]) };
}

/**
 * Drag entry point. Snaps `requested` to the nearest STEP, then clamps to
 * [0, own + wasted] — the domain's own minutes plus the free pool. Ayman's
 * rule verbatim: "increase it by whatever it can be increased but stop it
 * off by whatever was extra."
 */
export function setMinutes(a: Allocation, domain: DomainKey, requested: number): Allocation {
  // A drag handler derives `requested` from pointer position over element
  // width — width 0 (not yet laid out, hidden breakpoint, mid-transition)
  // is a divide-by-zero producing NaN (undefined behaves the same way once
  // it hits arithmetic). Every guard below passes NaN through silently
  // (Math.max/min/round of NaN is NaN), which would otherwise corrupt this
  // domain's value permanently. Guarded as a no-op, same shape as
  // increment() at a full pool. Infinity/-Infinity are deliberately NOT
  // guarded here — they clamp correctly through the existing Math.min/max
  // below (to `ceiling` / 0 respectively) and that's the desired behavior.
  const snapped = Math.round(requested / STEP) * STEP;
  if (Number.isNaN(snapped)) return a;
  const ceiling = a[domain] + wastedMinutes(a);
  const clamped = Math.min(Math.max(snapped, 0), ceiling);
  return { ...a, [domain]: clamped };
}
