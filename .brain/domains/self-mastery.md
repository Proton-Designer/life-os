---
id: domain.self-mastery
title: Self-Mastery (ULM — Learning)
layer: L2
type: domain
status: canonical
owner: unassigned
updated: 2026-09-13
sources:
  - lib/self-mastery/**
  - lib/promotions/**
  - app/(app)/personal/**
  - app/api/self-mastery/**
  - components/self-mastery/**
related:
  - domain.home-arbiter
  - domain.mcp-connector
  - domain.school
  - arch.system-overview
answers:
  - "how does spaced repetition work"
  - "why is book upload disabled"
  - "what is a lesson promotion"
covers: "Book ingestion, FSRS spaced repetition over lessons/cards, the lesson-promotion/verdict loop"
excludes: "School's separate, unconnected tracker (see domain.school); MCP entity detail (see domain.mcp-connector)"
tokens_est: 1293
source_hash: 345ea3c3edf3576841f91fbbc8139bf3974ddb51f5883efda7c6c228d65d3f17
---

# Self-Mastery (ULM — Learning)

## Purpose

Spaced repetition over real material — books → sections → lessons → cards, scheduled by FSRS. The differentiator is a **promotion loop**: a lesson carries an action template, a "promotion" is a commitment to try it, and an append-only verdict log removes adopted lessons from the review deck. The goal is behavior change, not recitation.

## Key concepts

| Term | Means |
|---|---|
| Card types | `free_recall \| application \| cloze \| why` |
| FSRS state | `new → learning → review → relearning`, via `ts-fsrs`. Exactly one scheduler module in the codebase (`lib/self-mastery/fsrs-scheduler.ts`) — both read-side display and write-side grading import `Card` conversion from it. |
| Retrievability vs. desired retention | Retrievability (shown in UI) is not affected by `desired_retention`; that setting only affects *scheduling* (next due date). |
| Meditations deck | A seeded, 12-lesson deck shipped with every account — today the only deck any account actually has. |

## Where the code lives

| What | Path | Notes |
|---|---|---|
| Entrypoint | `app/(app)/personal/[subdomain]/page.tsx` → `SelfMasteryLibrary` | Nav only at `/personal/self_mastery`, no legacy standalone route |
| Ingestion pipeline | `lib/self-mastery/ingestion/*` | chunk, merge, pdf, promotion, summarize, LLM providers |
| Session engine | `lib/self-mastery/session/*` | build-session, offline-queue, plan, queue-limits, timer |
| Scheduler | `lib/self-mastery/fsrs-scheduler.ts` | The one scheduler |
| Ingestion step API | `app/api/self-mastery/ingestion/step/route.ts` | Service-role; one stage per call |
| Promotions | `lib/promotions/*` | `promoteLesson`, `recordVerdictCore`; registered under the MCP `self_mastery` domain |

## How it works

Library reads `books`/`cards`/`card_states`, joined in memory for per-book progress + average retrievability. Starting a session resolves `user_settings`, builds a queue, grades flow client-side through `fsrs-scheduler.ts` with server-side re-validation via the `submit_review` RPC. An offline queue lets a review grade immediately and replay later.

## Integration points

| Direction | With | Via |
|---|---|---|
| Depended on by | Home arbiter | `Area` type explicitly widens to include `"self_mastery"` as a sixth ranked area, same independence as Deen/Fitness |
| External | MCP connector | 12 entities; grading is the newest write path, explicitly **not schedulable** via `scheduler_manage` |
| Not connected to | School | Migration 086 calls connecting a class to ULM ingestion a future "CollegeOS follow-up" — not landed |

## Constraints & gotchas

- **Book upload is disabled in this deployment.** `ingestion-availability.ts` gates on `SELF_MASTERY_INGESTION_URL` being set (deliberately not on a BYO key) — confirmed absent locally; asserted absent in production by docs, not independently re-verified against Vercel env vars.
- Migration 115's `personal_growth` flatten **silently broke** Self-Mastery nav in production (200-with-redirect, nothing errored) until `lib/shell/nav-domain-state.ts` synthesized the three personal areas from flat keys — that fallback is live code, not dead code.
- `lib/self-mastery/untyped-from.ts`'s header comment is confirmed stale (books/lessons/cards ARE now in the generated DB type) — tracked in `docs/ai-connector/KNOWN-STALE-COMMENTS.md`, left as low-priority cleanup.

## Focus reader (2026-10-19)

Every library book is readable in a focus reader (RSVP / page / listen) **independent of LLM ingestion** — reader imports never go through `prepareBookUpload`'s driver-heartbeat + AI-key gate. Design: `.claude/overnight/run-20261019-2250/DESIGN.md`.

- **Data (migration 268):** `books.reader_*` columns (status none/preparing/ready/failed, word count, source, source url, error, doc version) and `ingestion_mode='reader'` (reader-only book: status `ready`, no lessons, no `ingestion_jobs`); `reader_positions` (one bookmark per user+book, written only through the `reader_save_position()` RPC — newest `client_updated_at` wins), `reader_highlights`, `reader_sessions`; `user_settings.reader_*` prefs. All composite-tenancy-FK'd to `books(user_id,id)`, RLS own-row.
- **Document:** one `ReaderDoc` JSON (`lib/reader/types.ts`) in the private `books` bucket at `<uid>/<bookId>/reader-v1.json`. Position = global word index from the ONE tokenizer `lib/reader/tokenize.ts`; changing it invalidates every stored position, so bump `READER_DOC_VERSION`. `source_chunks.text` is LLM-study text (overlapping chunks, headings stripped), so it is only the LAST-RESORT source for a book whose PDF is gone (`lib/reader/import/chunks.ts` de-overlaps it); prefer the original file.
- **Import pipeline (`lib/reader/import/`, pure, no DB):** `importFile` (pdf via `lib/self-mastery/ingestion/pdf.ts`/unpdf, epub via fflate + OPF/nav/NCX + linkedom, txt, md, html via Readability), `importPaste`, `importUrl`. `cleanup.ts` strips running headers/footers (a line repeated modulo digits at the top/bottom 2 lines of >=30% of pages) and bare page numbers, de-hyphenates, joins wrapped lines. Failures are always `ReaderImportError(code)` with a human message (`no_text` = scanned PDF, OCR unsupported).
- **URL import SSRF guard (`url.ts`):** the address check runs inside the socket's DNS `lookup` (the checked IP is the connected IP — no DNS-rebinding gap) and on literal IPs; redirects re-checked, max 3; 15 s; 5 MB. `isBlockedAddress` covers loopback/private/link-local/metadata/CGNAT/multicast/v4-mapped v6.
- **Gotchas:** Server Actions cap bodies at 1 MB (no `bodySizeLimit`) — raw source files go via signed upload to Storage, never through an action. `getDocumentProxy` transfers its buffer, so `importPdf` hands pdf.js a copy.

- **Server actions (`app/(app)/personal/reader-actions.ts` → testable cores in `lib/reader/server/core.ts`, `validate.ts`, `stats.ts`, `paths.ts`):** `createReaderImport` (inserts a `ready`, lesson-less `ingestion_mode='reader'` book with `reader_status='preparing'`, mints a signed upload for `<uid>/<bookId>/source.<ext>`; paste is uploaded as `source.txt`; url needs no upload; sweeps this user's >1 h unconfirmed imports) → `prepareReaderDoc` (builds + stores `reader-v1.json`, returns the `ReaderImportPreview`; failure sets `reader_status='failed'` + `reader_error`, returns the typed code) → `confirmReaderImport`/`cancelReaderImport`. `prepareReaderDoc` is also the lazy path for existing library books: original PDF if `file_path` is set, else rebuilt from `source_chunks`+`book_sections` — **the ingestion pipeline deletes the PDF once a book is ready (`book-pdf-gc.ts`)**, so `finalizingStage` calls `buildReaderDocBeforeGc` (best-effort, 25 s budget, never throws; test proves ingestion still finishes if it throws) just before the delete. `renameBook`, `deleteBook` (the `delete_book` RPC; reader objects removed on a hard delete only, kept on a soft delete so restore works), `getReaderBootstrap` (signed doc URL, bookmark, settings, highlights), `saveReaderPosition` and `POST /api/reader/position` (beacon route: same-origin only, ≤2 KB, text/plain JSON; both call `reader_save_position`), highlights (create de-dupes the same range; list one book or all), `recordReaderSession` (`local_date` = `localDateString(endedAt, profile tz)`), `getReadingStats` (today, goal, streak counted back from today — or yesterday while today is unmet —, weighted avg wpm, last 7 days), `updateReaderSettings`. Every query filters `user_id` explicitly (tests run a fake with NO RLS, so a missing filter fails). Inputs are hand-validated (`validate.ts`); expected failures return `{ok:false,message,code?}`.
- **Library data:** `LibraryBook`/`BookDetail` now carry `ingestionMode`, `readerStatus`, `readerWordCount`, `canRead` (`canOpenInReader`: doc ready, or buildable) and `readProgress` (bookmark + %). Reader imports still `preparing`/`failed` are hidden from the library. `getDueSummary.hasBooks` ignores reader-only books (no cards ⇒ no "Nothing due today" card). Reader-only books never appear in the ingestion banner (status is `ready` from creation).

- **Reader UI (`components/reader/`, route `app/(reader)/read/[bookId]`):** a chromeless route group (own auth guard like `(capture)`; no AppShell) at `/read/<bookId>`; `/read/sample` is the permanent built-in demo (`lib/reader/__fixtures__/sample-doc.ts`). The data source is one function, `loadReaderPageData` in the page; everything below it takes a plain `ReaderDoc` prop. Engine is pure: `lib/reader/rsvp.ts` (ORP letter, punctuation/long-word/paragraph timing, sentence/paragraph steps) over `lib/reader/doc-words.ts`; `use-rsvp-player.ts` re-arms one timeout per word and takes an injectable scheduler. The focal letter sits in the middle column of a `1fr/auto/1fr` grid, so it never jitters. Page view splits only the current paragraph into word spans (other paragraphs are one text node; tap finds the word via the caret API). Browser-local state in `lib/reader/reader-storage.ts`: position per book (throttled 500 ms + flushed on pause/hide/pagehide, newest `updatedAt` wins against the server copy), settings, view mode. Themes are scoped `--reader-*` CSS vars (`lib/reader/themes.ts`, contrast pinned by test), not the dark-only app theme. iPad scroll bleed: `lib/client/use-body-pin.ts` is the 5bdb53c body-pin as a counted shared hook; `LockInOverlay` still has its own copy (not migrated, to avoid regressing a device-verified fix). Keys: Space, arrows, shift = paragraph; up/down = speed in Fast view only. Slots left for R5 (imports/library entry), R6 (listen), R7 (highlights, goal ring) are marked in `reader-app.tsx`, `page-view.tsx`, `reader-settings-dialog.tsx`.
- **Narration (Listen).** `lib/reader/narration.ts` is the pure core (`chunkFrom` sentence-sized chunks of <=45 words, `wordAtChar`, time-estimate fallback when no boundary events arrive within 600 ms (iOS), `createNarrator` with a generation counter so late events from a cancelled utterance are ignored; pause = cancel + remember word, resume = speak from it). `web-speech-backend.ts` is the browser adapter (keeps the utterance referenced: Chrome GCs it otherwise; returns null when unsupported, which hides the Listen button). `ReaderApp` listen mode: the narrator drives the position via `onWord`; moving the scrubber/tapping re-speaks from there; `speechRate===1` means "match reading speed" (wpm/180, clamped). Key `l` toggles.
- **Opening + importing (R5).** `/read/[bookId]` loads `getReaderBootstrapCore` on the server and hands plain values to `ReaderLoader` (client): opens the stored doc cache-first (`lib/reader/doc-cache.ts`, IndexedDB keyed book+version), or shows "Preparing for reading…" and calls `prepareReaderDoc` for a never-opened book, then `router.refresh()`. Bookmark: local write every change, server write via `lib/reader/position-sync.ts` (4 s trailing, immediate on pause/hide/pagehide, `fetch keepalive` to `/api/reader/position`). Settings: server copy wins, changes debounced to `updateReaderSettings`. Import UI: `components/reader/import-reader-dialog.tsx` (file/paste/link -> create -> signed upload with the server's contentType -> prepare -> preview -> confirm/cancel), not gated on the AI key; "Import to read" in the library header + empty state, `ReadButton` on cards and book detail, "Continue reading" row (top 3 by bookmark time), `/read/import?title&text&url` landing prefills the dialog. The upload dialog now pushes `/self-mastery/<id>` (the `/personal/self_mastery/<id>` push 404ed legacy-mode accounts).
- **Share target + Settings > Reading (R8).** `public/manifest.json` `share_target` is a GET to `/read/import` with `title`/`text`/`url` (so an installed PWA appears in the OS share sheet; the landing prefills the import dialog, nothing is created until Import), plus an "Import to read" app shortcut. Settings has a `reading` section (between Notifications and AI features; `lib/settings/sections.ts` drives the tab list, `sections-order` + `settings-form` tests pin the order) with `components/settings/reader-settings.tsx`: default wpm (100-1000), daily word goal (blank = none), focal letter, and a plain "what is stored where" note. It writes the same `user_settings.reader_*` row as the reader through `updateReaderSettings`. Not verified live: that Android Chrome/iOS actually list the installed PWA as a share target (needs a device and a re-install of the PWA).
- **Pulled-forward extras (R9).** Drag-and-drop a file onto the import dialog's file area (same `pickFile` size check as the picker); `BookDetail.sourceUrl` (`safeOriginalUrl`: http/https only) drives an "Open original" link (new tab, `noopener noreferrer`) on link imports; `/read/speed-test` (chromeless `(reader)` group) is a reading-speed test over an original ~280-word passage (`lib/reader/speed-test-passage.ts`) with 3 questions; `scoreSpeedTest` (pure) gives wpm (clamped to the reader range, invalid under 5 s), comprehension % and a recommended speed (25% slower when under 2/3 correct), and "Use N wpm" saves through `updateReaderSettings`. Linked from Settings > Reading and the library header. Not done: dropping onto the whole library page (only the dialog's file area).
- **Highlights + stats UI (R7).** Header highlighter button / `h` saves the *current sentence* (`lib/reader/highlights.ts` `sentenceRange`, capped at 300 words); in Page view a text selection (tracked via `selectionchange`, snapped to whole words) shows a floating "Highlight" pill. Saved ranges are drawn as `<mark>`/spans (`rangesByBlock` keeps non-highlighted blocks memo-stable); "Highlights (N)" in the slim bar under the header opens `HighlightsDialog` (jump = Page view at that word, delete). Library header has `GlobalHighlightsDialog` (`listHighlights(null)`, each row links `/read/<id>?at=<word>`; `at` opens the Page view there and beats the saved bookmark). Reading time: `lib/reader/session-tracker.ts` turns position changes into stretches (forward steps <=120 words; scrubber/chapter jumps and backwards moves count nothing; mode change or 2 min idle closes a stretch; flushed on pause/hide/close and every minute) -> `recordReaderSession`; `getReadingStats` feeds the bar ("320 / 1,000 words today · 3-day streak", ring + 7-day chart dialog) and `ReadingStatsChip` on the library page. Daily goal select lives in the reader settings dialog. Sample book keeps highlights in memory only. Unverified in a real browser: selection snapping on iOS Safari, `selectionchange` on touch handles.
- **Share by POST + Home entry (R10).** `share_target` is now a multipart POST to `/api/reader/share` (long text stays out of the URL; accepts a pdf/epub/txt/md file; body capped at 4 MB, under Vercel's 4.5 MB function limit). `lib/reader/server/share.ts` classifies (file > link > text; a URL in `text` is a link), creates + prepares the import via the R3 cores, and 303s to `/read/import?pending=<bookId>` where `ImportReaderDialog` opens straight on the preview (Start confirms, closing cancels); failures 303 to `/read/import?error=...`. Old installs that cached the GET manifest still work (the landing keeps reading `title/text/url`). Signed-out: the route redirects to `/login?next=/read/import`; the shared body cannot survive that redirect, so the person has to share again (known limit). Home: `ContinueReadingSection` (Suspense, after the Self-Mastery session card) shows last-read book, % read, today's words vs goal, streak -> `/read/<id>`; shown for domains accounts with the learning area and for legacy-mode accounts; hides with the session-entry widget toggle. Unverified live: the OS share sheet / multipart from a real installed PWA.

## Not covered here

- School's tracker (unconnected) → `domain.school`
- MCP entity/column detail → `domain.mcp-connector`
- Detailed feature-by-feature implementation status vs. the original ULM spec → `docs/audits/2026-09-13-three-app-feature-audit.md` (§"APP 3 — ULM")

## Unverified

- Whether the upload gate's short-circuit is actually applied at the call site rendering the upload dialog trigger (not traced to source this pass).
