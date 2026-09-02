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

/**
 * A press on the bar for a domain still at 0 (no drag yet, nothing to
 * "grab") creates this starter block instead of doing nothing — the bar
 * segment at 0 minutes renders at 0% width, so there was never a
 * draggable target to begin with. Deliberately not STEP: this is a
 * one-time "start here" tap, not a drag increment, and 5 reads as a
 * placeholder nudge rather than a real allocation. The very next drag
 * or increment/decrement still snaps to STEP as usual.
 */
export const STARTER_BLOCK_MINUTES = 5;

/**
 * The legacy default registry — deen/business/school/fitness/co_op — kept
 * as a plain convenience export, NOT a type constraint any more (ruling b).
 * `Allocation` itself is an open, registry-driven map: every real call site
 * today still only ever populates it with these 5 keys (nothing yet tags
 * allocation minutes to a user-created Work subdomain), so passing this as
 * `emptyAllocation()`'s default keeps every existing caller's behavior
 * byte-for-byte unchanged. The type system no longer assumes it's the only
 * possible key set, which is the actual deliverable — a registry (e.g. a
 * user's real domains + Work subdomains, once that wiring exists) can be
 * passed to `emptyAllocation` instead, and every operation below already
 * works over it with zero further changes, since none of them ever
 * hardcoded a key list internally.
 */
export type DomainKey = "deen" | "business" | "school" | "fitness" | "co_op";

export const DOMAIN_KEYS: DomainKey[] = ["deen", "business", "school", "fitness", "co_op"];

export type Allocation = Record<string, number>;

export function emptyAllocation(keys: string[] = DOMAIN_KEYS): Allocation {
  return Object.fromEntries(keys.map((k) => [k, 0]));
}

function assignedMinutes(a: Allocation): number {
  return Object.values(a).reduce((sum, v) => sum + v, 0);
}

/**
 * The Opus Lead's caution on ruling (b), verbatim: `Record<DomainKey,
 * number>` guaranteed every key existed; the open `Allocation` map does
 * not. Direct bracket access (`a[domain]`) that used to be safely `number`
 * can now silently be `undefined` for a key the object never had — which
 * is invisible here because `noUncheckedIndexedAccess` isn't on, so
 * TypeScript still reports it as `number` while the runtime value is
 * `undefined`. Fed into arithmetic, that becomes `NaN`, which typically
 * renders as blank or (worse) coerces into something that reads as a real
 * zero — the null-is-never-zero rule failing in exactly the direction
 * nobody notices. Every read of a specific domain's minutes should go
 * through this, not a bare `a[domain]`.
 */
export function minutesFor(a: Allocation, domain: string): number {
  return a[domain] ?? 0;
}

/** TOTAL - sum(allocations), floored at 0. */
export function wastedMinutes(a: Allocation): number {
  return Math.max(0, TOTAL_MINUTES - assignedMinutes(a));
}

/** Adds min(STEP, wasted) to `domain`. A full pool is a no-op — not an error. */
export function increment(a: Allocation, domain: string): Allocation {
  const wasted = wastedMinutes(a);
  if (wasted === 0) return a;
  return { ...a, [domain]: minutesFor(a, domain) + Math.min(STEP, wasted) };
}

/** Subtracts min(STEP, a[domain]) from `domain`, floored at 0. Freed minutes return to wasted. */
export function decrement(a: Allocation, domain: string): Allocation {
  const own = minutesFor(a, domain);
  if (own === 0) return a;
  return { ...a, [domain]: own - Math.min(STEP, own) };
}

/**
 * Drag entry point. Snaps `requested` to the nearest STEP, then clamps to
 * [0, own + wasted] — the domain's own minutes plus the free pool. Ayman's
 * rule verbatim: "increase it by whatever it can be increased but stop it
 * off by whatever was extra."
 */
export function setMinutes(a: Allocation, domain: string, requested: number): Allocation {
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
  const ceiling = minutesFor(a, domain) + wastedMinutes(a);
  const clamped = Math.min(Math.max(snapped, 0), ceiling);
  return { ...a, [domain]: clamped };
}
