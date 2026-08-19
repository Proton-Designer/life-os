# Missed Lock-In hours count as noise, and every hour is editable

**Status:** design, ruled by Ayman 2026-08-19 16:45 CDT — build it
**Author:** Opus Lead
**Changes:** the "silence keeps its coarse credit" decision in
`2026-08-19-checkin-allocation-system.md` and the reasoning logged under it in PROJECT_STATUS.

## The ruling

> "a missed check in during lock in session should be counted as noise, but the user can go back and
> update/change status of a specific hour if needed"

This **reverses** what the Lead and Engineer 3 settled earlier today. That earlier decision was defensible
on its own terms — session presence had been accepted evidence since before the feature, and treating
silence as unknown would have been a behaviour change smuggled in under a bug fix. But it produced a
consequence flagged to Ayman: **ignoring every hourly prompt was the highest-scoring path — full signal,
no visible trace.** He has ruled that the loophole matters more than the consistency argument. His call,
and it's the right one: a metric whose easiest path is also its most flattering one is not measuring
anything.

**The two halves are one design and neither works alone.** Auto-marking noise without editability would
punish him for being deep in work or away from his phone — exactly the "measurement destroys the thing
it measures" failure. Editability without auto-marking leaves the loophole open. Ship both together.

## Rules

**1. A missed hour resolves to `wasted`.**
"Missed" reuses the existing grace-period semantics in `computeSessionCheckinSlots`: an hour is missed
once a *newer* slot has fired (`missedSlots`), not the moment it goes unanswered. The current `dueSlot`
is still answerable and stays **pending** — not yet resolved, not yet noise.

**2. Derive it, don't write it with a job.**
Same architecture as `lib/deen/prayer-status.ts`: **a stored row always wins; silence plus a superseded
slot derives as `wasted`.** No cron, no background writer, no rows appearing without the user acting.
An edit is what creates a stored row.

**3. Every hour is editable, during the session and after it ends.**
Signal ⇄ wasted, any hour, any time. An edited hour is a stored row and never re-derives.

**4. "Resolved" replaces "confirmed" in the double-count guard.**
`subtractConfirmedHours` currently strips explicitly-answered hours from the coarse Lock-In overlap
credit. An auto-missed hour now *also* has a precise value, so it must be subtracted too — otherwise the
window's coarse credit re-adds business minutes for an hour we've just called wasted, and the numbers
contradict each other.

**Rename it to `subtractResolvedHours`** and widen the input to answered ∪ missed. **Keep and extend the
per-hour comment** — the boundary-hour reasoning it records is unchanged and still the thing that stops
someone simplifying it back to a window-coverage check.

Only the current `dueSlot` and not-yet-fired hours keep coarse overlap credit, which is correct: they are
the only hours with no definite value yet.

**5. `isWindowCoveredBySessionHours` follows the same widening** — a window fully covered by *resolved*
hours (answered or missed) is fully accounted for and must not queue a redundant allocation ask.

## UI

**During a session:** the Lock-In card's activity log already lists confirmed and missed hours. Make each
row **tappable to change its status.** No new surface.

**After it ends:** the same hours must stay reachable. Business already renders a last-completed-session
card — extend it, or surface the session's hours somewhere adjacent. **Do not** build a separate
"edit history" screen; if the hours aren't reachable from where he already looks at sessions, this half
of the ruling doesn't exist in practice.

**Copy matters here.** A missed hour is not an accusation — it reads as *"not confirmed"*, neutral, with
the edit affordance visible rather than hidden. He is being invited to correct a default, not scolded.
Wasted stays muted, never red — same treatment as everywhere else in this system.

## Acceptance

1. An unanswered hour, once superseded, resolves to `wasted` in every surface that reads it — session
   ratio, Signal:Noise, Focus Map — with no row written until he edits.
2. The current `dueSlot` reads pending, not wasted.
3. Editing any hour, during or after the session, changes it in all of the above.
4. An edited hour never re-derives.
5. **No double-count**: a session with one answered hour, one missed hour and one pending hour must
   total exactly the window length across its own rows plus the coarse pre-fill. Prove it with real
   numbers, as the 165-vs-120 check did — green assertions alone are not enough here.
6. Reachable from where sessions are already looked at, not a new screen.
7. `tsc`, `eslint`, full `vitest`, `next build` clean; live pass at 1600/1024/390 with a clean console;
   all seeded data cleaned up and confirmed zero.
