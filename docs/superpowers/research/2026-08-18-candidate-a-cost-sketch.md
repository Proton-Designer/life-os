# Candidate A cost sketch — if-then kill-list entry

**Author:** Engineer 1, 2026-08-18. Sketch only, per the Lead's instruction — **not built**, so the
brainstorm can weigh the mechanism against its actual price rather than an assumed one.

## The finding that changes the estimate

`KillListSlot` (`components/business/kill-list.tsx`) initializes each slot's edit state as
`useState(!slot.text)`. On a brand-new day with zero items, **all three slots independently start in
edit mode at once** — this isn't a sequential fill-one-then-the-next flow, it's three simultaneous
mini-forms stacked in one column. That's the actual baseline candidate A would be adding a second field
to, and it's exactly the density risk worth pricing before deciding.

## Migration

One additive, nullable column, same shape as tonight's `anchor_cue`:

```sql
alter table public.kill_list_items add column trigger_cue text;
```

No default (same reasoning as `anchor_cue`/`commitment_note`: a default empty string would make "never
set" indistinguishable from "cleared"). Applied via psql, hand-updated in `database.types.ts`, both
per tonight's established pattern — no new process, just repeating a known-cheap step.

## Touched files

- `supabase/migrations/019_kill_list_trigger_cue.sql` (new)
- `lib/supabase/database.types.ts` — hand-add `trigger_cue: string | null` to `kill_list_items`'s Row/
  Insert/Update, same three-line pattern as `deen_habits` tonight.
- `app/(app)/business/actions.ts` — `setKillListItem(date, position, text, triggerCue?)`, normalizing
  blank → null exactly like `createDeenHabit` does tonight. No new action needed for editing an
  existing cue — the same upsert already handles it.
- `app/(app)/business/page.tsx` — add `trigger_cue` to the existing `kill_list_items` select (line 57);
  thread it into `KillListSlotData`.
- `components/business/kill-list.tsx` — the component itself; see below.
- `components/business/__tests__/kill-list.test.tsx`, `app/(app)/business/__tests__/actions.test.ts` —
  both already exist and already cover this exact component/action pair, so this is extending coverage,
  not standing up a new test surface.

Seven files, five of them mechanical repeats of a pattern already exercised twice tonight
(`anchor_cue`, `commitment_note`). The genuinely novel work is entirely in `kill-list.tsx`'s layout.

## The entry UI, and the density problem specifically

**The naive version** — a second `<Input>` stacked under the existing one, always visible in edit
mode — is what I'd build if I were only pattern-matching against Habit Builder's create form. It's also
wrong here, for a reason Habit Builder didn't have: Habit Builder's picker renders **once**, for one
habit at a time, opened deliberately. A fresh kill-list day renders **three** of these simultaneously,
unrequested, the moment the page loads. Two inputs × three slots = six text fields plus three Save
buttons in one column before the user has typed anything, on a 390px screen where the panel is already
competing with everything else on the Business page.

**What I'd propose the brainstorm actually weigh — collapsed-by-default per slot:**
the cue field starts hidden behind a small "+ cue" affordance next to Save, matching the existing
`useState`-per-slot pattern (one more boolean, `showCue`, next to `editing`). Typing the item text and
hitting Save/Enter works exactly as it does today, completely unchanged, if the cue is never opened.
Density at 390px stays at today's baseline in the default case; the second field only exists in DOM/
layout for a slot the user has actively chosen to expand.

**The honest trade-off, not smoothed over:** Gollwitzer's evidence comes from studies where forming the
if-then plan was part of the task, not an opt-in step behind a toggle. Collapsing it protects density but
may suppress uptake — if it's rarely opened, the mechanism the whole candidate is justified by rarely
fires. That tension is real and I'm not resolving it here; it's the actual decision the brainstorm needs
to make, now that both sides of it are visible.

## The non-happy paths, named individually as asked

**1. Item entered with no cue.** `trigger_cue` stays null. Rendering degrades exactly like Habit
Builder's `AnchorCueTag` already does tonight — no tag renders, bare item text only, no dangling
fragment. Zero-cost, already-proven pattern.

**2. An existing item is edited.** Clicking "Edit" on a saved slot currently re-enters edit mode
pre-filled from `slot.text` only. It would need to also pre-fill the cue field from `slot.triggerCue`
(shown expanded rather than collapsed if a cue already exists — collapsing a cue that's already there
would look like it silently vanished). One more piece of state to thread through the same edit-entry
path, not a new path.

**3. The fresh-day, three-simultaneous-forms case.** Covered above — this is the case that actually
drives the design, not an edge case relative to it. Worth being explicit that this is the **normal**
morning state for someone using the Kill List as intended, not a rare corner.

## What this sketch does not include

I haven't estimated the actual pixel/line-height math at 390px — that needs a real render to confirm the
collapsed-by-default version actually holds the line, the same way tonight's Habit Builder density claim
got verified live rather than assumed. If candidate A survives the brainstorm, that's the first thing
I'd check before writing any component code, not after.
