# Life OS — AI Integration Program: Handoff Context

**Written:** 2026-09-09, by an agent session at Garrison's request, from a working conversation
with him — not yet reviewed or ruled on by Ayman (the app's actual owner).
**Audience:** whichever dev-agent team picks this up to build it.
**Status:** design is settled enough to build against; a few things below are explicitly flagged
as open and need an answer before or during the build, not assumptions to fill in silently.

This is the single document to start from. It carries the full context of how this program came
to be shaped this way, what's already decided, what's still open, and where the deeper technical
detail lives. A companion spec with exact SQL and a fuller tool catalog for System A already
exists at `docs/superpowers/specs/2026-09-09-mcp-ai-connector.md` — this document supersedes it
for anything the two disagree on (this one is newer and has System B in it too), but that file is
still the right place to look for the literal migration text.

---

## 1. What Life OS is, for anyone new to this codebase

Life OS is a single-user personal operating system built for one person, Ayman — not a
commercial product, no signup funnel, no billing. It runs as a Next.js 16 / React 19 / Supabase
PWA, mobile-first and specifically designed around a 390px phone screen. Five life domains (Deen,
Work, Business, School, Fitness) plus cross-cutting systems (Home, nightly Review, Distractions
capture, Check-ins, Notifications, Calendar/Insights). Full detail lives in
`context/PURPOSE-AND-DOMAINS.md` and `context/ARCHITECTURE.md` — read those before touching
domain logic, because the design has real, deliberate opinions (no gamification, no streaks as
the universal metric, Home shows exactly one next action) that are easy to accidentally violate.

Two things about "single-user" worth knowing going in, because they shape this program directly:

- **It's not as single-user as the founding spec claims.** There's a documented account-
  separation model already in production: a legacy account (`ayman.0704m@gmail.com`) alongside a
  newer "convergence build" account, plus roughly 68 leftover test accounts. RLS is enforced
  everywhere as defense in depth, not as an afterthought — everything in this program should sit
  behind the same RLS posture, never a service-role client making unscoped queries.
- **There's already a narrow, opt-in AI feature in the app — don't confuse it with this program.**
  `lib/ai/*` and the `user_api_keys` table are a bring-your-own-DeepSeek-key feature used for
  exactly two things: written feedback during a spaced-repetition study session, and (once a
  worker exists) turning an uploaded book into flashcards. It is not a general assistant and has
  nothing to do with the two systems below. Don't extend it; build alongside it.

Also load-bearing for whoever implements this: `AGENTS.md` at the repo root carries hard
operational rules paid for by real production incidents — timezone handling (never derive a
calendar date from a raw `Date`), the RSC function-prop-serialization trap, and, if more than one
agent is touching this repo at once, mandatory use of `scripts/agent-commit.sh` for every commit
(the shared working tree has burned people twice on plain `git commit`). Read it before writing
code, not after something breaks.

---

## 2. The goal, in one sentence

Let Ayman ask Claude, ChatGPT, or Gemini — whichever he's already paying for as a subscriber, not
a separate metered API key — real questions about live Life OS data and have it act back on the
app (log things, edit things, schedule things), and make reaching that AI from inside Life OS
itself as low-friction as reasonably possible on a phone.

That one sentence splits into two genuinely separate systems, because "use my subscription" and
"embed the chat inside my app" turned out to be in tension with each other (see §4). Build them
as two independent efforts; neither blocks the other.

---

## 3. System A — Remote MCP connector (the substantial piece)

**What it is.** A new MCP (Model Context Protocol) server bolted onto the existing Next.js app.
Point Claude's/ChatGPT's/Gemini's own "custom connector" feature at it, and from inside those
apps — using the subscription Ayman already pays for — he can ask real questions about Life OS
and have the model call back into the app to read data or write changes.

**Why this is possible at all, and the one wrinkle that shapes the auth design.** As of Sep 2026,
Claude, ChatGPT, and Gemini (via a feature called "Gemini Spark" in the consumer app) all support
pointing at a standards-compliant remote MCP server over Streamable HTTP — one server serves all
three, this isn't three separate integrations. The wrinkle: ChatGPT and Gemini both accept a
plain pasted bearer token for auth, but Claude's custom-connector UI does not — it only offers
OAuth (client ID/secret) or no auth at all (confirmed via open issues on Anthropic's own MCP
repo, e.g. `anthropics/claude-ai-mcp` #112 and #411). So the design keeps a personal-access-token
model everywhere it works and wraps the same tokens in the smallest possible OAuth 2.1 shim just
to satisfy Claude — piggybacking on Life OS's existing login rather than building real
multi-tenant OAuth, since there's realistically one person authorizing this ever.

**Architecture, at a glance.**

- One new route (`app/api/mcp/route.ts`, using the `mcp-handler` package) implementing MCP tools.
- Every tool is a thin wrapper around the **same server actions the UI already calls**
  (`lib/deen/actions.ts`, `lib/work/actions.ts`, etc.) — no reimplemented business logic, no
  second source of truth for what a valid write looks like.
- A bearer token maps to a Supabase user via a new `mcp_access_tokens` table; each request mints
  a short-lived Supabase user JWT so **RLS applies to every query the same way it does for the
  UI** — never a raw service-role bypass.
- Every domain gets read tools and write tools (Home, Deen — including the private reflection
  log, Work, Business, School, Fitness, Distractions, Calendar/Insights).
- "Make scheduled tasks" reuses infrastructure that already exists and is already proven in
  production — `pg_cron` + `pg_net` already drives `dispatch-notifications` every 15 minutes. A
  new `mcp_scheduled_actions` table gets polled the same way and executes the same tool code a
  live call would.
- A `mcp_audit_log` table records every call — tool name, args, outcome — **before** the tool
  returns, not after, so a crash mid-write still leaves a record.

Exact table definitions and the fuller per-domain tool list are in
`docs/superpowers/specs/2026-09-09-mcp-ai-connector.md` — that's the file to open when it's time
to write the migration, not this one.

**Decisions Garrison already made, that the build should not relitigate:**

- **Auth: personal access token** (with the thin Claude-only OAuth shim described above).
- **Scope: read AND write from day one**, across every domain, no read-only phase.
- **No per-call confirmation gate on writes.** A tool call that writes, writes — it doesn't
  return a preview first.
- **The private Deen reflection log is included**, same as every other domain — no carve-out,
  even though the app's own design intent (`PURPOSE-AND-DOMAINS.md`) treats that log as
  deliberately private from the rest of the UI.

**Because "write, no confirmation" was the choice, these guardrails are load-bearing, not
polish**, and should not be descoped to save time:

- Full audit logging on every call, success or failure.
- Instant, visible token revocation (a Settings page listing tokens with last-used time).
- A per-token rate ceiling, to catch a runaway loop on the model's side.
- **No write tool ever hard-deletes a row.** Every write is an insert, an update, or a status
  change — undo-by-editing-back stays possible; undo-by-restoring-a-deleted-row doesn't.

**Open, unresolved — flag these rather than guessing:**

1. This touches Ayman's production schema and database. Whoever builds this should get his
   explicit sign-off before a migration lands, per how `AGENTS.md` says changes get ruled on here
   — this was designed from Garrison's side of a conversation, not Ayman's.
2. `mcp-handler` (Vercel's package) is the assumed dependency; nobody has yet spiked it against
   this app's actual Next 16 / App Router setup. Do that spike before committing to it inside a
   migration-adjacent PR.
3. Given the account-separation reality in §1, confirm which account(s) this should even be
   enabled for before shipping it broadly.

---

## 4. System B — Quick, low-friction AI access from inside the app

**What it is.** Not an embed, not an iframe — those were investigated and ruled out (see below).
This is a link (or small platform picker) somewhere in the app shell — e.g. next to the existing
notification bell — that opens Ayman's chosen AI platform with as little friction as a plain link
can offer, and behaves differently, correctly, depending on device and whether he has that
platform's native app installed.

**Why an iframe doesn't work, so nobody re-investigates it.** All three platforms set explicit
anti-clickjacking headers on their own servers — verified directly by checking the response
headers, not by inference: `chatgpt.com` and `claude.ai` send `X-Frame-Options: SAMEORIGIN`,
`gemini.google.com` sends `X-Frame-Options: DENY`. No amount of code on Life OS's side changes
that; it isn't a config option, and their login cookies are `SameSite`-restricted in a way that
would break auth inside a frame regardless.

**How it actually works, per platform and per device class:**

- **Mobile (the primary case, given this app is 390px-first):** use a plain `https://` link to
  the platform's normal address (`claude.ai`, `chatgpt.com`, `gemini.google.com`), nothing
  special. iOS and Android both have a built-in mechanism — Universal Links (iOS) / App Links
  (Android) — where the OS itself checks if the matching native app is installed and registered
  for that domain: if yes, tapping the link opens the native app directly; if no, it just loads
  in the browser. **Don't build custom "check if app is installed, else fall back" detection
  logic** — that's a fragile, timing-based hack that exists in the wild specifically because this
  OS-level mechanism is what it was built to avoid needing.
  - **Claude** explicitly documents this exact "smart" behavior for `https://claude.ai/...`
    links — confirmed from Anthropic's own help center.
  - **ChatGPT** has no official documentation of this at all, and there's a community thread of
    people building iOS Shortcuts workarounds just to jump into a chat directly — treat its
    universal-link behavior as unconfirmed/inconsistent, and don't promise app hand-off for it in
    any UI copy. It'll still work, just probably always via the browser path below.
  - **Gemini** is unverified either way, though Google is generally thorough with Android App
    Links across its own products, so it's a reasonable bet — test on a real device, don't
    assume.
  - **When there's no native app (or on ChatGPT specifically), the link falls back to a browser.**
    On an installed, standalone-mode iOS PWA, external links like this open automatically in an
    in-app browser overlay (the same visual pattern as tapping a link inside Instagram) —
    confirmed default iOS behavior for standalone PWAs, not something Life OS builds or can
    force. It's a genuine separate browsing context, so the X-Frame-Options issue above doesn't
    apply to it. Android's equivalent isn't as reliably documented — test on the actual device
    rather than assuming parity with iOS.
- **Desktop/web:** there's no equivalent automatic OS-level routing. Default every platform's
  link to its plain `https://` address, which always works, opens in a normal tab. Claude is the
  one exception with an officially documented desktop-app scheme
  (`claude://claude.ai/new?q=...`, desktop-app-only, no auto-fallback) — worth offering as a
  secondary, explicit "open in Claude Desktop app" option for people who have it, but don't build
  the equivalent for ChatGPT/Gemini without confirming they actually support a comparable scheme
  first.

**What to actually build:** a small link or platform-picker component in `components/shell/`,
using plain https URLs per the routing rules above, no custom protocol-detection JavaScript. This
is genuinely low-risk, additive UI — no schema change, no migration, no security surface beyond
"it's a link." It doesn't need to wait on System A and can ship first.

**Before calling this done:** the mobile behavior described above is largely governed by each AI
vendor's own app configuration, which nobody on this side controls or can fully verify from
documentation alone. Test the actual links on a real iOS device (and Android, if relevant) before
considering this shipped — don't trust the design doc's confidence level over what the phone
actually does.

---

## 5. Suggested order of work

High-level only — this is a sequencing suggestion, not a task breakdown:

1. **System B first.** It's small, additive, has no schema impact, and de-risks nothing about
   System A, so there's no reason to gate it behind the bigger effort.
2. **System A, read-only tools + auth**, once the `mcp-handler` spike (§3, open item 2) confirms
   the approach is clean against this app's Next 16 setup. Get the OAuth shim and PAT flow
   working and verified against at least Claude before adding write tools.
3. **System A, write tools + the guardrails** (audit log, revocation UI, rate limiting) — these
   ship together, not write-tools-now-guardrails-later, per the reasoning in §3.
4. **System A, scheduling** (`mcp_scheduled_actions` + the pg_cron poll) last — it depends on the
   write-tool code path already existing and being trustworthy, since a scheduled action runs
   through that same path unattended.

---

## 6. Sources worth re-checking, not just trusting

Platform integration behavior (connector auth requirements, deep-link support, PWA browser
behavior) is the kind of fact that changes without much notice. What's stated above was verified
directly during the design conversation, in September 2026 — a dev agent picking this up even a
few weeks later should spot-check anything platform-behavior-specific rather than assume it's
still accurate:

- Claude custom connectors: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
- Claude's bearer-token gap: https://github.com/anthropics/claude-ai-mcp/issues/112 , https://github.com/anthropics/claude-ai-mcp/issues/411
- ChatGPT MCP connectors: https://vercel.com/kb/guide/mcp-server-chatgpt-connector
- Gemini Spark custom apps: https://support.google.com/gemini/answer/17209137
- mcp-handler (Vercel): https://github.com/vercel/mcp-handler
- Claude mobile deep links (Universal Links behavior): https://support.claude.com/en/articles/14898120-open-the-claude-mobile-app-with-a-link
- Claude desktop deep links: https://support.claude.com/en/articles/14729294-open-claude-desktop-with-a-link
- ChatGPT iOS app FAQ (no documented deep linking): https://help.openai.com/en/articles/7885016-chatgpt-ios-app-faq
