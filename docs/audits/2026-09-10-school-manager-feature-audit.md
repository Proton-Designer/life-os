# School Manager Feature List — Implementation Audit vs. Life OS

*Cross-referenced the "School Manager: Feature List" doc against the actual `tracking-app` (Life OS) codebase on 2026-09-10, via 5 parallel code-crawling passes covering the School domain (`app/(app)/school`, `lib/school`) and the Self-Mastery/ULM domain (`components/self-mastery`, `lib/self-mastery`, `app/api/self-mastery`), plus the database schema, package.json, and recent git history. Every item below cites the file(s) that back its verdict.*

**Product context (added after initial audit, confirmed against the codebase):** Life OS is not the single-user personal app its own older docs describe — it's a commercial, multi-tenant product formed by merging that original app with **CollegeOS** (a separate school/study-manager codebase) and **ULM** (Universal Learning Machine, the book-ingestion + spaced-repetition system). This audit's findings are unaffected by that correction: the merge happens inside this same single repo (there's no separate personal-only slice that was searched instead), and the codebase documents the merge as an explicit, phased, partially-completed project — see point 4 below.

**Currency check:** re-checked git history after the initial audit (latest commit as of this note: `54bc044`, 2026-09-10 16:17 CDT). No commits since the audit touch School, Self-Mastery, or the CollegeOS merge — the only activity since has been in the Business domain and an unrelated MCP test script. This checklist is current.

**Scoring rule:** this feature list describes a *school/course* manager. Several real, well-built features exist in Life OS's Self-Mastery system but only operate on personal book uploads, with no path into class/course material. Those are scored **Partial**, not Full — the mechanism works, but not for the thing this doc is asking about.

## Scorecard

| Status | Count |
|---|---|
| ✅ Fully Implemented | 6 |
| 🟡 Partially Implemented | 13 |
| ⚪ N/A / undocumented | 1 |
| ❌ Not Implemented | 41 |
| **Total features** | **61** |

## Three things worth knowing before the checklist

1. **School and Self-Mastery are two separate systems that don't talk to each other.** School (classes, assignments, grades) has zero content-generation, zero AI, zero study-session logic — it's a tracker. Self-Mastery (books, flashcards, spaced repetition) has real learning-science machinery, but it's scoped to `book_id` end-to-end (`cards.book_id` is `NOT NULL`) and has no wiring to classes or coursework. A `questions` table with a `class_id` column exists in the schema for exactly this purpose but is dead — zero rows, zero code anywhere creates, reads, or reviews it. Migration `086_ulm_sources_class_owner_fk.sql` calls connecting a class as ingestible material a **future** "CollegeOS follow-up."
2. **Even where Self-Mastery's pipeline works, it's currently switched off in production.** `lib/self-mastery/ingestion-availability.ts` disables the upload flow because no worker process consumes the ingestion queue: *"Nothing anywhere consumes that queue... a user who uploads a book gets a card that says 'processing' forever."* So several "Partial" verdicts below describe code that is real but not currently reachable by a user at all.
3. **Syllabus upload is file storage, not data extraction.** A syllabus PDF can be attached to a class and viewed, but nothing ever reads its contents. The real syllabus data behind Ayman's current classes was typed into a SQL script by hand, once, as a one-time seed — not produced by an app feature. The onboarding UI's own internal state is literally named `"empty_extraction"`, and a code comment says extraction is "Phase 2."
4. **The CollegeOS merge itself is real, tracked, and openly partial — this is why several items below are "Not Implemented" rather than "not found."** `supabase/migrations/` documents an explicit "CollegeOS School merge" plan in numbered phases: Phase 2 step 1 (the risk-engine inputs behind `lib/school/risk/`) and step 2 (the grade-engine inputs behind `lib/school/grades/`) were both drafted and **applied** — this is exactly the code this audit scored as Full/Partial for grades and risk-ranking. Phase 2 step 3 — the question bank (`095_school_questions.sql`) and attempt log (`096_school_attempts.sql`), which is where quiz/practice-test generation would live — was drafted and then formally **withdrawn** (`supabase/migrations/_withdrawn/README.md`) rather than shipped; its schema was later folded into a different migration (`111`) for future use, but no application code was ever built against it. In other words: the quiz/question-bank gap this audit found isn't a case of looking in the wrong place — CollegeOS's own merge plan confirms that piece hasn't been carried over into working functionality yet. Git history shows the same pattern for other pieces: `school/risk`, the grade engine, and a capture-utterance parser have each been explicitly "ported" from CollegeOS in their own commits, so anything not similarly ported (syllabus extraction, a tutor, lecture handling) most likely still lives — if it exists at all — only in CollegeOS's original, pre-merge source, which does not appear to be part of this repo (commit messages reference `packages/core/src/risk`, implying a monorepo this code was extracted from). Whether that original source is still available anywhere is an open question for the product owner, not something visible from inside `tracking-app`.

---

## 1. Courses and setup

- ✅ **Add a course by uploading the syllabus** — File upload/storage works end-to-end (`components/school/syllabus-panel.tsx`, `app/(app)/school/class-actions.ts:156` `uploadClassSyllabus`, private Supabase Storage bucket per `supabase/migrations/048_classes_entity_and_syllabus_storage.sql`), with a viewer dialog. Storage only — see the next item for what it doesn't do.
- ❌ **App reads the syllabus and pulls out every exam/quiz/assignment/paper/reading/due date/weight** — No extraction exists anywhere. `uploadClassSyllabus` only streams the file to storage; nothing parses it or populates `class_assessments`. `components/onboarding/school-step.tsx:17-18` states outright: "store the file only — extraction is Phase 2." The real per-class data on the live account was hand-typed into `scripts/seed-syllabus-tasks.sql` and run once via `psql`.
- ❌ **You review what it found and approve it before anything is saved** — Nothing is ever extracted, so there's nothing to review. No pending-extraction table or approval UI exists for school data (contrast with `lesson_promotions`/`lesson_verdicts`, which is an approval flow but for Self-Mastery lessons).
- ✅ **Add or fix anything manually** — Full manual CRUD: `addClassAssessment`, `updateClassAssessment`, `deleteClassAssessment` (`app/(app)/school/class-actions.ts`), `add-class-dialog.tsx`, `class-detail-dialog.tsx`.
- ❌ **Recurring items (weekly quiz, weekly problem set) set once and repeat, editable per instance** — `class_assessments` has a single `date` column and no recurrence field (`supabase/migrations/000_baseline.sql:673-683`). Recurrence exists only for *class meeting times* (`schedule_events.is_recurring`, with per-occurrence cancel/uncancel) — a different feature, already counted below.
- ✅ **Class schedule with meeting times and locations** — `schedule_events` CRUD (`app/(app)/school/actions.ts:102-233`) with day-of-week, time, location, instructor, rendered on the weekly School view.
- ❌ **Every deadline links back to the exact line in the syllabus it came from** — No source-excerpt/page/line field exists on `class_assessments`, and there's nothing to link back to since extraction doesn't happen.

## 2. Keeping up with changes

- ❌ **Paste or share a professor announcement and the app updates the plan** — Zero matches for "announcement" anywhere in the codebase. No feature exists.
- ❌ **You approve the change before it takes effect** — Depends on the above, which doesn't exist.
- ❌ **Canvas sync for assignments, due dates, and announcements** — Deliberately stubbed, not merely missing: onboarding offers a "Connect Canvas" toggle, but selecting it is a documented no-op (`components/onboarding/school-step.tsx:19-21,85`, comment: "Canvas is offered but deliberately not built"). No Canvas API client or OAuth flow exists.

## 3. Daily and weekly view

- ❌ **Today: what to do for school today, how to do it, and by when** — No school-specific "Today" view exists. The cross-domain Home "Now" panel (`lib/home/arbiter.ts`) surfaces one top task title + due date across *all* life domains, with no "how to do it" content at all.
- ✅ **Due today / overdue / this week** — Three KPI cards, each opening a dialog list (`app/(app)/school/page.tsx:253-301`, `components/school/kpi-task-dialog.tsx`).
- ✅ **Full task list filterable by course, type, and status** — Real class/type/due-date filters plus a clear-filters control (`components/school/task-list-module.tsx:351-426`).
- 🟡 **Calendar view of all deadlines and planned study sessions** — Deadlines and class blocks genuinely render on the week calendar (`app/(app)/calendar/actions.ts:130-220`). "Planned study sessions" don't exist as a concept anywhere in the app (no such table, action, or component).
- ❌ **Weekly preview: next week's load, overloaded days flagged, one milestone per course to confirm** — No matches anywhere for "weekly preview" or "overloaded." Doesn't exist. (`weekly_goals`/`WeeklyGoalsHeader` is an unrelated, manually-authored Deen/Business feature.)

## 4. Grades

- ❌ **Log scores as they come in** — No score-entry UI exists anywhere, even though `class_assessments.points_earned`/`points_possible` columns exist in the schema (migration `106_school_grade_inputs.sql`). The assessment edit form only exposes name/type/date/weight. `components/school/class-detail-dialog.tsx:388-390` states plainly: "there's no grade-entry UI yet."
- 🟡 **Live projected grade per course** — A real, correct grade-projection engine exists (`lib/school/grades/courseGrade.ts`, `grade-projection.ts`) and renders in `ClassGradeLedger`. It's fully built but permanently inert in practice, since there's no way to enter the scores it needs (see above).
- ✅\* **Target calculator ("you need X on the final for an A")** — `lib/school/grades/requiredScore.ts` genuinely implements this (final/impossible/secured/on-track verdicts), rendered in `class-grade-ledger.tsx`. Same caveat as above: works correctly, but has no real score data to run on today.
- ❌ **Warning when your practice-test scores and real scores don't match** — No "practice test" concept exists anywhere in the app. A risk engine exists (`lib/school/risk/assignment-risk.ts`) but scores *procrastination/lateness risk* (weight × difficulty × days-to-due) — an unrelated concept — and its course-level rollup is explicitly uncalled dead code.

## 5. Study plan

All eight items in this section: **❌ Not Implemented.** There is no backward-from-deadline scheduler, no exam-prep spacing, no practice-test scheduling, no topic-mixing for problem sets, no paper-milestone system (outline/draft/revise), no skip/escalating-warning mechanic, no sick-week session-shrinking, and no finals-week handling — because none of it exists, there's also nothing to make finals week "unspecial." A search for "finals" across the whole codebase returns nothing. The only forward-looking School logic at all is the per-assignment risk score mentioned above, which ranks existing tasks — it does not create or schedule study sessions.

## 6. How to study (the learning-science layer)

- ❌ **Every study session comes with instructions for exactly how to do it, based on the research** — No meta-instructional text exists anywhere explaining a study method to the user (the "why it works" text that does exist is about book subject matter, not study technique).
- 🟡 **Study methods the app assigns: active recall, spaced repetition, practice testing, interleaving, self-explanation, teaching it back** — Real, working implementations of active recall, spaced repetition (FSRS via `ts-fsrs`, `lib/self-mastery/fsrs-scheduler.ts`), practice testing, interleaving (`lib/self-mastery/session/plan.ts`), and self-explanation interstitials — but **for uploaded personal books only**, never for school coursework. "Teaching it back" as a distinct mode doesn't exist.
- ⚪ **Study methods the app will not assign (rereading, highlighting, summarizing, reviewing notes)** — None of these exist as user-facing tools anywhere in the app, consistent with avoidance — but no design doc or comment states this as a deliberate, research-based exclusion, so it reads as omission rather than documented policy.
- 🟡 **Readings turn into "close the book and write down what you remember" plus writing your own questions** — The `free_recall` card type genuinely does the first half for books. The second half — the user authoring their own questions — doesn't exist; all questions are system/LLM-generated.
- 🟡 **Confidence check on every question (sure / think so / guessing)** — Fully working for book flashcards (`retrieval-session-overlay.tsx`, persisted to `reviews.confidence`), but there's no equivalent review flow for school material at all.
- ❌ **Per-course view of those confidence gaps** — Doesn't exist for books (no confidence-vs-correctness breakdown view found) or for school.
- ❌ **Feynman mode: explain a concept, get told where the gaps are** — Self-explanation text is captured but explicitly never graded or analyzed — the UI literally says "No wrong answers here — this isn't graded." No gap-detection exists.
- ❌ **Built-in guide to the study strategies and the psychology behind them** — No help/guide/education content exists anywhere in the app.

## 7. Study material the app generates for you

- ❌ **Upload anything: PDFs, slides, docs, videos, audio, YouTube links, photos of notes** — Upload accepts PDF only (`accept="application/pdf,.pdf"` hard-coded). No video, audio, YouTube, or image/OCR handling exists anywhere, and no relevant library is in `package.json` beyond `unpdf` for PDF text extraction.
- 🟡 **Notes: clean, organized notes from any upload** — A real per-section summarization function exists (`lib/self-mastery/ingestion/summarize-sections.ts`) but its own header states it is "NEVER INVOKED AUTOMATICALLY... meant to be called by hand" — no route, cron, or UI triggers or displays it.
- ❌ **Study guide per exam, built from what's actually being tested** — No linkage between assessments and any generated content exists; School has no generation pipeline at all.
- 🟡 **Flashcards, in multiple formats, that you can edit before using** — Four genuine card formats are generated (cloze, free-recall, application, why), but no edit capability exists anywhere — cards are generation-only.
- ❌ **Quizzes from your material** — The `questions` table is dead schema: confirmed zero rows in production and zero code anywhere that creates, edits, or serves a question.
- ❌ **Exam-style questions matching the real format** — Same dead-schema finding as above.
- ❌ **Full-length practice tests** — No test-assembly logic exists; Self-Mastery's "sessions" are ordinary spaced-repetition review queues, not timed full-length tests.
- 🟡 **Every generated question tied back to the source material** — A genuinely solid provenance chain exists for book lesson cards (stored quote, grounding verification, a drill-down UI) — but scoped to books only, and moot for school since no school questions exist.
- 🟡 **Questions you get wrong come back more often; questions you know get spaced out** — The FSRS engine genuinely does this — for book flashcards only.
- 🟡 **Questions from different courses mixed in the same session** — Sessions genuinely interleave material across multiple *books*. Since no course-linked questions exist, there's nothing from an actual course to mix in.
- 🟡 **Explains why a wrong answer is wrong** — A real, working LLM-based feedback feature exists for book free-recall cards (`answer-feedback-actions.ts`), but requires the user's own API key and doesn't cover multiple-choice/quiz answers (which don't exist).
- ❌ **Essay and assignment grader against the rubric** — No rubric or essay-grading logic found anywhere in the codebase.

## 8. Lectures

All five items in this section: **❌ Not Implemented / Not Found.** No "lecture" concept, recording/import UI, live transcription, real-time Q&A, or per-course transcript storage exists anywhere. The only speech-related code in the app is a generic voice-to-text "quick capture" box unrelated to lectures or coursework.

## 9. AI tutor

All seven items in this section: **❌ Not Implemented / Not Found.** No tutor entity, chat interface, or voice-conversation code exists anywhere. The only LLM-backed feature in the app is the one-shot, post-reveal answer-feedback described above — and it's arguably the *opposite* of item 8 ("guides you to the answer instead of giving it"), since it only runs after the user has already seen the correct answer. No visual-explanation, audio-recap, or video-generation code or dependencies exist.

## 10. Progress

- 🟡 **Dashboard per course: what you have down, what needs work, sessions done vs. planned** — School's per-class view (task list, grade ledger, risk-ranked assessments) is real but tracks tasks/grades, not session counts. Self-Mastery has a genuine per-book mastery signal (FSRS-based memory-strength bar) but it's per-book, not per-course, and has no "sessions done vs. planned" metric either.
- 🟡 **Progress on each exam's prep as the date approaches** — A real per-assignment risk score (proximity, weight, knowledge gap) exists and is wired into the UI, but it's framed as lateness/risk ranking rather than an exam-readiness percentage, and the course-level aggregate version is explicitly dead code with no caller ("not yet wired to a caller in School").

---

*Legend: ✅ Fully Implemented · 🟡 Partially Implemented · ⚪ N/A/undocumented · ❌ Not Implemented. Items marked ✅\* are functionally complete but currently have no real data to operate on.*
