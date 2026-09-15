# Deferred platform & vision items — decision notes (P3-21)

Written 2026-09-15 during the overnight run by the Team B lead (tracking-app-a9). **Nothing
here was built.** Per the run's scope ruling, these items get a decision note instead of code.
Each note gives what exists today, a recommendation, what would change the call, and a rough
cost. Source list: `phase-3-build-plan.md` ("Platform & external integrations",
"Self-Mastery (ULM) — remaining vision items").

---

## A. Native mobile — one decision, five tickets

Covers: native iOS/Android app, app-store deployment pipeline, native mobile client (ULM),
on-device speech-to-text, native push notifications.

**What exists today**
- The web app is already an installable PWA: `public/manifest.json`, `public/sw.js`,
  `components/pwa/register-sw.tsx`, and `app/layout.tsx` wires the manifest.
- Web Push (VAPID) is live, with `push_subscriptions` and the `dispatch-notifications` edge
  function. On iOS it only works once the PWA is added to the Home Screen (iOS 16.4+).
- In-browser dictation exists (Phase 2 "dictated free recall" reuses it).
- P3-17 builds a dedicated mobile capture route tonight.
- Phase 4 tonight builds a token-authenticated agent API. Text-message assistants (e.g. Instinct)
  can then read and write the account from the phone the user already carries, which covers
  much of what a native "capture on the go" client was for.

**Recommendation: don't build native now. Re-decide after 30 days of mobile usage data.**
- Every native ticket depends on one strategic call: a second codebase (Expo/React Native)
  plus store review, signing and an OTA update pipeline. That roughly doubles the surface
  every future feature must ship to, including the MCP parity work, which already lags the UI
  (48/120 writes).
- The real mobile gaps are narrower and web-solvable:
  1. push reliability on iOS, which is a "Add to Home Screen" onboarding prompt;
  2. fast capture, which is P3-17 plus the agent path;
  3. offline review, where the service worker exists and a review-queue cache is a web task.

**Revisit if any of these hold**
- More than ~40% of sessions are on mobile *and* iOS push opt-in stays under ~20% after an
  install prompt ships.
- A feature needs a native-only API: background audio capture for lecture recording,
  HealthKit, Screen Time.
- Store presence becomes a growth requirement.

**Cost if built:** L–XL. Expo app shell + auth + 3 core loops ≈ several weeks. Store pipeline
(EAS Build/Submit, TestFlight, review) ≈ 1 week plus ongoing upkeep. On-device STT needs the
native app. Native push replaces VAPID for app users but keeps it for web.

---

## B. Self-Mastery "full vision" items explicitly out of scope in the original spec

The original ULM spec lists these as future direction, not commitments. None is required for
the working product's loops (ingest → cards/questions → FSRS review → lesson promotion →
verdict).

| Item | What it would be | Today / nearest existing piece | Recommendation | Revisit when |
|---|---|---|---|---|
| Multi-agent "council" review of learning | Several model personas critique a lesson or promotion | Lesson verdicts (append-only) + BYOK multi-provider AI gateway | **Defer.** Spend and latency per review with unproven value. The Phase 4 agent API already lets the user bring *their own* agent to critique lessons, at zero server spend | Users report that single-model teach-back feedback is too shallow |
| Accountability engine | Commitments with consequences, check-ins, escalation | Kill List cap, weekly goals, Phase 2 escalating habit-breaking flow, scheduled MCP notifies | **Defer; mostly covered.** Phase 2's escalation flow + scheduler notifies are the engine's core. Revisit as a unifying layer only after both ship | After P2 escalation flow has 4+ weeks of use |
| Behavioral data layer | A unified event store across domains for analysis | Per-domain tables + `mcp_audit_log` + Insights | **Defer.** A premature second source of truth. Insights already reads domain tables. Build only when an analysis needs cross-domain joins that are too slow | An Insights query becomes a bottleneck or a model needs a single event timeline |
| Health / wearable / calendar integration | Sleep, HRV and calendar feeding study/energy decisions | **Tonight:** Whoop (env-gated, P3-18), RescueTime (BYOK, P3-19), ICS reconciliation (P3-13) | **Partially built tonight.** Do not add HealthKit/Google Fit until native (section A) is decided | Whoop OAuth app registered and data shown useful |
| Attention-control features | Site/app blocking, focus modes | Distractions capture + 3-strike rewrite, Lock-In sessions, RescueTime signal | **Don't build.** Real blocking needs OS/browser-extension privileges. The product's stance is awareness plus rewrite, not enforcement | Only if a browser extension or native app exists |
| Judgment / decision-quality suite | Calibration and prediction tracking | Phase 2 overconfidence detector; P3 practice-vs-real grade benchmark; estimate-vs-actual (flagged off) | **Defer; seeds exist.** The overconfidence detector and benchmark are the calibration primitives. Revisit a suite after they have data | 8+ weeks of confidence-vs-outcome data |
| Real-world experiment tracker | Hypothesis → intervention → measured outcome | Lesson promotions + verdicts (a lesson "tried in real life" is already an experiment) | **Defer.** Promotion/verdict already models the loop. Expose it better (P4 makes it agent-readable) before adding a parallel structure | Users run promotions often enough to want A/B comparisons |
| Journal cross-referencing | Link reflection/journal entries to lessons and cards | Deen reflection entries; night-plan notes/worry dumps; book summaries (144) | **Defer.** Needs embeddings (Phase 2 semantic search, P2-13) first. Revisit once P2-13 ships | P2-13 embeddings live |
| Contradiction detector across notes | Flag notes/lessons that conflict | Same embeddings dependency + LLM judge | **Defer, and gate behind P2-13 plus a spend cap.** High false-positive risk; must never auto-edit user data | Embeddings live and a spend ceiling (P2-01) in place |

Exception built tonight: **per-user FSRS parameter tuning (P3-20)**, gated on ≥1000 logged
reviews, as the plan specifies.

---

## C. One product call that makes several of these cheaper

Phase 4 turns LifeOS into a well-described, token-scoped API for *any* agent: MCP for
Claude/ChatGPT, and REST plus `agent.md` for text-message assistants. Several vision items
(council review, accountability nudges, journal cross-referencing) are the kind of thing a
user's own general-purpose agent can do on top of that API, at no server-side model spend and
with no new UI. Recommendation: make "bring your own agent" the default answer to vision-item
requests, and build natively only what an external agent can't do safely: anything needing
server-side scheduling guarantees, cross-user data, or privileged device access.
