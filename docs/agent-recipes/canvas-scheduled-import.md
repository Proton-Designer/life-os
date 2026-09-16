# Recipe: scheduled Canvas import (for schools that block personal access tokens)

**Who this is for:** an AI platform (GPT, Gemini, Perplexity, Claude, or any
agent runtime with a scheduled/cron task feature) acting on behalf of a
LifeOS user whose school does not let students mint a Canvas personal
access token. The platform logs into Canvas on the user's behalf (however
that platform normally authenticates to a third-party site), reads the
user's course/assignment/announcement data, and reports it into LifeOS in
one call per run.

**What LifeOS never does:** ask for, store, or see a Canvas credential. This
recipe's only LifeOS-side authentication is the user's own LifeOS
Connector token (a bearer token created in LifeOS Settings → Connectors,
`write` scope). Canvas access lives entirely on the agent's side.

## 1. Connect once

The user creates a LifeOS Connector token in Settings and gives it to the
agent platform as it would any other API key for a scheduled task.

## 2. Read from Canvas

Once per run (a daily cadence is a reasonable default — Canvas assignments
and announcements don't change faster than that in practice), read:

- **Courses** the student is actively enrolled in this term.
- **Graded assignments** — Canvas's own `include[]=submission`-style view
  of "assignments I have a grade for" is the right scope. Only send
  assignments with a real numeric grade; there is nothing useful to import
  for an ungraded assignment yet.
- **Announcements** posted recently (the last 1–2 weeks is enough — an
  older announcement is very unlikely to describe a still-relevant
  deliverable).

Keep each Canvas course's own numeric/string id (`canvas_course_id`), each
assignment's id (`canvas_assignment_id`), and each announcement's id
(`canvas_announcement_id`) exactly as Canvas reports them — these are the
stable ids the idempotency guarantee below depends on.

## 3. Call `write`

One call, `domain: "school"`, `entity: "canvas_import"`, `action:
"run_batch"`, with `patch.items` — an array (max 200 items) mixing any
number of the three item shapes below.

```json
{
  "domain": "school",
  "entity": "canvas_import",
  "action": "run_batch",
  "patch": {
    "items": [
      { "kind": "course", "canvas_course_id": "10231", "canvas_course_name": "Organic Chemistry II", "canvas_course_code": "CHEM-2412" },
      { "kind": "assessment", "canvas_course_id": "10231", "canvas_assignment_id": "88213", "name": "Problem Set 4", "due_at": "2026-09-22T23:59:00Z", "points_possible": 20, "points_earned": 18, "grading_type": "points" },
      { "kind": "announcement", "canvas_course_id": "10231", "canvas_announcement_id": "55021", "text": "The midterm has moved to Friday the 26th; you'll need a calculator." }
    ]
  }
}
```

Field notes:

- `course` items map a Canvas course to a local LifeOS class. Send one
  whenever you see a course this batch's assignments/announcements
  reference — LifeOS auto-maps it to an existing class ONLY when the
  Canvas course name/code exactly matches (case-insensitively) exactly one
  of the user's own classes; otherwise it stays mapped-but-unassigned
  until the user maps it themselves in Settings. LifeOS never invents a
  new class on its own.
- `assessment` items never overwrite a grade the user typed in by hand,
  and never create a duplicate assessment — an assignment with no
  confident local match is staged for the user to review/confirm, the
  same review step the in-app "paste a syllabus" flow already uses.
- `announcement` items go through the same extraction step the in-app
  "paste an announcement" flow uses, so a real deliverable mentioned in an
  announcement (a moved exam, a new assignment) is surfaced for the user
  to confirm — this is not committed automatically either.
- `due_at`/`points_possible` are optional and nullable; `points_earned` is
  required for an `assessment` item (there's nothing to import for a grade
  that doesn't exist yet — wait for a real numeric score).
- `grading_type` is optional but matters: send Canvas's own assignment
  `grading_type` value verbatim. Only `"points"` and `"percent"` actually
  apply the grade — every other value (`pass_fail`, `letter_grade`,
  `gpa_scale`, `not_graded`, or omitted entirely) still links the
  assignment to the local assessment (so it's found next time and can be
  graded by hand) but never writes a number into it. This is deliberate:
  a pass/fail or letter-grade assignment's raw score is not directly
  comparable to a points total, and guessing would risk feeding a
  meaningless number into grade-weighted math.

## 4. Read the per-item result

The response reports **one real outcome per item**, never one opaque
batch success:

```json
{
  "results": [
    { "kind": "course", "ref": "10231", "outcome": "updated", "reason": "refreshed name/code" },
    { "kind": "assessment", "ref": "88213", "outcome": "updated", "reason": "grade recorded (matched to an existing assessment)" },
    { "kind": "announcement", "ref": "55021", "outcome": "created", "reason": "staged 1 item(s) for review" }
  ],
  "counts": { "created": 1, "updated": 2, "skipped": 0 }
}
```

`outcome` is one of `created` (a new mapping or a new staged item),
`updated` (an existing local row changed — most often a grade), or
`skipped` (nothing changed; `reason` always says why — e.g. "existing
grade was entered by hand," "already staged from a prior import," or
"course not mapped to a local class"). `ref` is the exact Canvas id you
sent for that item, so you can match a result back to what you sent
without LifeOS inventing a second id scheme.

## 5. What happens on a repeat run

Send the exact same batch again (the same Canvas ids, whether or not
anything on Canvas changed) and LifeOS reproduces the identical end state:

- A `course` item re-sent with the same name/code is a no-op refresh
  (`outcome: "updated"`, harmless).
- An `assessment` item already linked to that `canvas_assignment_id`
  re-applies the same grade (a genuine value change is a real update; an
  identical value is a no-op update).
- An `assessment` item already staged from a prior run is reported
  `skipped` — it is never staged twice.
- An `announcement` item already staged from a prior run is reported
  `skipped` — it never spends a second extraction pass.

This means the safe, recommended pattern for a scheduled task is: **read
everything relevant each run and send it all again** — there is no need to
track "what did I already send" on the agent's own side. LifeOS is the
source of truth for what's already been imported.
