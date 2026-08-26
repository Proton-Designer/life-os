# 2026-08-26 afternoon — expanded class view, Ayman's request verbatim

Word-for-word, typos intact. This file is the scope authority: do not
paraphrase it, do not "clean it up", and do not resolve its ambiguities
here. Rulings live in the second half of this file, clearly separated.

Received 2026-08-26 15:20 CDT. One screenshot attached: the expanded class
view for **Ameri Studies (AMS-2341-HN1)**, showing the Assessments table
with "Midterm/Final" colliding into "2026-10-06", per-row Remove buttons,
an unbordered Syllabus panel with View / Swap out / Remove, and a Task list
whose filters include an "All classes" dropdown and whose groups read
Today·0, This Week·0, This Month·0, Future·6.

---

1. [Image #12] For the expanded class view screen, as you can see in the screenshot, alot of the lemetns overlap, the screen isn't looking well strcutured/professional/polished it looks barebones, you need to sturcutre this better use frontend design skill. Also for this popup screen, you can slihgtly increase the size of the popup as well, no need ot make it this small. Also make the dates be displayed with Month and day not the numbered date, so for example Sep. 3rd, instead of 09-03-2026. Also in the exapnded class view, when you click Add button for adding tasks, it first prompts you for what class, the user is already in the expanded view for a particular class no need to ask this again, it should just take the class for which the user is in. In this expanded view there is also no option to edit/remove tasks, add this funcitonaltiy. Also I want you to add subtle borders around the indiviudal cards/sections in this expanded view because right now all 3 sections (Assessments, Syllabus, and Task list) dont have a border and its kind of confusing. And for the syllabus section, when hte user presses view syllabus it downloads the syllabus to the user's machine, that is wrong funcitonaltiy, it shouldt download, it should jsut pull up a popup and allow them to view the syllabus. And instead of keeping the Remove button to the right of the exams in the assessments section, take out the remove buttons and instaed put all editint functioantly for all 3 sections + the course details into the edit button whcih is already in the top right, so right now when you press that it allows the user to edit the course details, but instead make it so that when that button is pressed it allows the user to edit the content of all of the sections, edit/remove, and when this edit button is pressed, there shoudl be a save and cancel buttons present in the top right instead of the edit, these should have their intended funcitoanlty. Another issue with this expanded class view is that whenever you press on View to open the expanded view, it first opens the popup displaying class details, then takes a second of half a second to slowly/sequentially load the other sections, this is suboptimal for user experience, make sure it all loads instaltly right away with teh most updated information, and ameks ure informait is correctly and quickly uupdated across different machiens and different views, etc. Also in the school screen, reposition/reorder the classes so they are in the following order: Prob & Stats, DSA, Lin Alg, Ameri Studies, Phys, Phys Lab

---

# Rulings (Opus Lead) — NOT part of the verbatim text above

## Ownership

| Engineer | Files (exclusive) |
|---|---|
| **A** `lxhsireh` | `supabase/migrations/052_*.sql`, `lib/supabase/database.types.ts`, `lib/school/get-class-cards.ts`, `app/(app)/school/page.tsx`, `components/school/class-card.tsx` |
| **B** `9ye5fqku` | `components/school/class-detail-dialog.tsx`, `components/school/class-assessments.tsx` |
| **C** `usvggmr2` | `components/school/syllabus-panel.tsx`, `syllabus-viewer-dialog.tsx`, `task-wizard-dialog.tsx`, `task-list-module.tsx`, `task-edit-dialog.tsx`, `package.json` |
| Lead | `lib/date-utils.ts` (landed `7c8f08d`) |

## R1 — Class order is data, not a hardcoded CASE

Ayman's order (Prob & Stats, DSA, Lin Alg, Ameri Studies, Phys, Phys Lab) is
neither alphabetical nor derivable from anything already stored. Add
`classes.position int null`; order by `position asc nulls last, code asc`.

Do **not** write a `CASE` over his course codes. Migration 048's backfill
comment sets the precedent and the reasoning is unchanged: baking one real
account's course-code strings into schema history does nothing for a class
added tomorrow and permanently embeds personal data in a migration. Backfill
from a guarded values list; leave unmatched classes null so they sort last
rather than disappearing.

## R2 — The load waterfall is a data-fetching bug, fixed server-side

`class-detail-dialog.tsx` fetches assessments and tasks in a `useEffect`
that runs *after* the dialog opens. Two round-trips land after first paint;
that is precisely the "slowly/sequentially load" he describes.

The fix is **not** a spinner, a skeleton, or a client-side cache.
`getClassCards` already runs server-side on `/school` and already queries
both `tasks` and `class_assessments`. Widen those two existing queries to
carry each class's full lists, pass them down as props, delete the
`useEffect`. Net round-trips on open: zero. Net queries added: zero.

This also answers "updated across different machines and different views":
the data now arrives with the server render, so `router.refresh()` after any
mutation — and any navigation — yields current data. Note `staleTimes.dynamic`
is already 60s (`99b9566`). True realtime remains held from last night and is
**not** in scope here; do not start it.

## R3 — The syllabus "download" is docx-only

Verified directly against the five signed URLs before assigning: every one
returns `content-disposition: null` and a correct `content-type`. PDFs
already render inline in the existing iframe. The failure is confined to the
single `.docx` (Ameri Studies — the class in his screenshot), because no
browser renders `.docx` in an iframe and Chrome falls back to downloading.

Branch on type: PDF keeps the iframe; DOCX renders via `docx-preview`
(v0.4.0, ~975KB), dynamically imported so it stays out of the main bundle.
Chosen over `mammoth` (2.2MB) for size and because it preserves layout
rather than flattening to semantic HTML. Any failure path must be an
explicit "can't preview + Download" — never a silent auto-download, which is
the exact behaviour being complained about.

## R4 — Edit mode is staged, and Cancel really rolls back

"These should have their intended functionality" is load-bearing. One
`editing` flag in the dialog governs all three sections plus course details.
Edits accumulate in client state; Save commits **deletes → updates →
inserts** then refreshes; Cancel discards and restores. A throw during Save
keeps the user in edit mode with their staged changes intact.

Syllabus upload/remove is the one carve-out: a Storage file operation can't
be meaningfully staged client-side, so it writes through immediately and
only its destructive controls are gated behind `editing`.

## R5 — `formatShortDate`, and the date-parsing trap

`formatShortDate(dateStr, referenceDateStr?)` → `"Sep. 3rd"`. Year is shown
only when it differs from the reference year, so a Dec 2027 exam can't read
identically to a Dec 2026 one.

It parses by splitting the string. `new Date("2026-09-03")` is UTC midnight,
which is **Sep 2** in `America/Chicago` — AGENTS.md records this exact bug
class shipping three times in one night. There is no instant here and no
timezone is needed: a calendar date string is already local, and formatting
it must not round-trip through `Date` at all.

## R6 — Build once, gate with a prop

The wizard keeps its three steps; a `lockedClass` prop starts it at step 2
and hides step 1. Do not fork a second wizard. Same for the class filter in
the class-scoped task list, and for `TaskEditDialog`'s class reassignment.

## R7 — The redundant "All classes" filter

Visible in his screenshot: the class-scoped task list still offers a class
filter over a single class. He didn't name it, but it is the same redundancy
he named for the Add wizard ("no need to ask this again"). In scope.

## Standing constraints

- Commit only via `./scripts/agent-commit.sh` — shared tree, shared index.
- Never a plain function prop Server → Client (AGENTS.md). Invisible to both
  `tsc` and `vitest`; browser console only.
- Accessible names must be unique within a dialog. Per-row edit/remove
  buttons are about to create a dozen — name them by row ("Edit Midterm
  Exam"), not bare "Edit". Four such collisions shipped last night.
- Migrations run against the live production DB via `$DATABASE_URL_POOLER`.
  `$DATABASE_URL` is IPv6-only and does not resolve on this network.
- **Verify in a live browser.** Last night a component was built, unit
  tested, handed over as a snippet, and never pasted in; every automated
  check was green and `/school` would have shipped without it.
