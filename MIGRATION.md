# Agent-Brain Migration Record

Installed: 2026-09-13 · Commit before install: `1cce1ef2` (2026-09-10) · Approach:
9-phase Agent-Brain protocol, full install (`--profile standard`) — this repo had
75+ documentation files, no existing `.brain/`, 856 commits, 1 confirmed human
contributor. No application code was changed at any point — documentation and
organization only, per the operator's explicit instruction.

## Summary

76 documents considered (75 scanned + 1 `.docx` found by direct reading) · 26
canonical · 2 merged (root `CLAUDE.md`/`AGENTS.md`) · 0 duplicates · 48
historical/archived (43 kept in place per the repo's own `docs/REPO-MAP.md` §7,
2 archived into `.brain/archive/`, 2 already self-resolved in place, 1 `.docx`
moved to archive) · 0 deleted · 41 `.brain/` documents created, all with valid
frontmatter · root per-session token tax reduced ~5,771 → ~1,913 tokens (-66.9%,
heuristic ±15%, see `.brain/.scan/token-report.json` and `brain audit`).

Full classification reasoning: `.brain/.scan/classification.md`. All 4 proposed
non-`docs/superpowers/` actions were explicitly approved by the operator
(Garrison) before execution.

## Moves

| Old location | New location | Action | Reason |
|---|---|---|---|
| `context/Life OS — Complete Feature Guide.docx` | `.brain/archive/context/life-os-complete-feature-guide.docx` (renamed — spaces/em-dash broke this repo's own markdown-link tooling) | Archived | Stale, describes pre-2026-09-01 legacy shell only (per `docs/REPO-MAP.md`); not in the scanner's inventory (binary file), found by direct reading |
| `Claude outputs/school-manager-feature-audit.md` | `docs/audits/2026-09-10-school-manager-feature-audit.md` | Relocated | Matches the existing `docs/audits/` dating convention; content unchanged |
| `Claude outputs/three-app-feature-audit.md` | `docs/audits/2026-09-13-three-app-feature-audit.md` | Relocated | **Discovered mid-execution** (created by a concurrent process after Phase 01's scan ran — mtime postdates the scan) — not in the original classification plan. A safe, additive move only (same convention already approved for its sibling file above); content unchanged. Cross-referenced from `.brain/domains/school.md` and `.brain/domains/self-mastery.md`. |
| `CLAUDE.md` (181 lines, pre-Agent-Brain) | `.brain/archive/2026-09-13.root-claude-md-v1.md` | Archived (content merged first — see below) | Superseded by the trimmed routing-focused root `CLAUDE.md` |
| `AGENTS.md` (350 lines, pre-Agent-Brain) | `.brain/archive/2026-09-13.root-agents-md-v1.md` | Archived (content merged first — see below) | Superseded by the trimmed routing-focused root `AGENTS.md` |

## Merges

| Source | Destination | Content merged | Verified |
|---|---|---|---|
| `CLAUDE.md` (orig.) | New root `CLAUDE.md`, `.brain/architecture/system-overview.md`, `.brain/domains/settings-onboarding.md`, `.brain/governance/ownership.md` | Multi-tenancy evidence, legacy/domains nav split, domain-vocabulary migration state, major-subsystems table | Original content archived verbatim (byte-diffed identical to the live copy at merge time) in `.brain/archive/2026-09-13.root-claude-md-v1.md`; new `CLAUDE.md` re-read after writing |
| `AGENTS.md` (orig.) | New root `AGENTS.md`, `.brain/governance/tool-output-policy.md`, `.brain/governance/contribution-protocol.md`, `.brain/memory/known-issues.md` | 5 hard engineering constraints (RSC prop boundary, timezone/UTC rollover, shared-git-index mutex, Playwright serialization, "a check that examines nothing") | Original content archived verbatim (byte-diffed identical) in `.brain/archive/2026-09-13.root-agents-md-v1.md`; new `AGENTS.md` re-read after writing |

## Corrections

| Path | Change | Reason |
|---|---|---|
| `docs/REPO-MAP.md` line 28 | Corrected the `README.md` row from "Untouched create-next-app boilerplate. Ignore." to "Current" | The claim was verified false by reading the actual file — a real, accurate, current README. Operator-approved. |
| `COMPANY_CONTEXT.md` | Removed (was a placeholder-only template) | No real org/team-convention content exists beyond what `.brain/governance/ownership.md` already states; the template's own instructions say to omit rather than ship ceremony |

## Deletions

None. No document met the `Delete` bar. `COMPANY_CONTEXT.md`'s removal above is
recorded as a correction, not a `Delete`-class removal, since it was this
install's own placeholder scaffold, never real content — nothing existed there
to lose.

## Not migrated

| Path | Why it was left in place |
|---|---|
| All 43 files under `docs/superpowers/**` | Classified Historical, but this repo's own `docs/REPO-MAP.md` §7 and `context/PURPOSE-AND-DOMAINS.md` §7 already declare them "not archived, deliberately" — ~64 files (migration headers, code comments) cite them by exact path. Adopted that existing policy rather than overriding it. |
| `docs/audits/2026-08-15-frontend-structure-audit.md` | Same no-move logic as `docs/superpowers/` — REPO-MAP.md: "Historical." |
| `PROJECT_STATUS.md` (334KB) | REPO-MAP.md + `context/PURPOSE-AND-DOMAINS.md`: "frozen historical log" — too large and explicitly frozen to be worth migrating; already banner-corrected in place for its one known-stale claim. |
| `docs/ai-connector/WIDGETS-MIGRATION-NEEDED.md` | Already self-archived in place by this repo's own authors (a "STATUS: APPLIED... RESOLVED" banner) — exemplary pattern, left untouched. |
| `docs/ai-connector/SETUP-signing-key.md` | Same — already self-corrected in place ("RESOLVED, mechanism changed"). |
| All 26 documents classified Canonical | No action needed — see `.brain/.scan/classification.md`. |
| `Claude outputs/phase-1-build-plan.md`, `phase-2-build-plan.md`, `phase-3-build-plan.md`, `roadmap-master-summary.md` | **Not approved by operator** — these appeared in `Claude outputs/` *during* this install's execution (mtimes newer than every other action taken this session), indicating another concurrent process is actively writing there right now. Left completely untouched to avoid colliding with in-progress work outside this install's scope. Flagged to the operator directly rather than guessed at. |

## Verification

- `node agent-brain-tool/bin/brain index .` — 41 knowledge nodes, 0 unreachable within 3 hops, 3040 symbols indexed, 0 dependency cycles, 0 boundary violations.
- `node agent-brain-tool/bin/brain verify . --strict` — reduced from 28 failures/12 warnings (first run) to **6 remaining failures, all in the two frozen archive snapshots** (`.brain/archive/2026-09-13.root-claude-md-v1.md`, `2026-09-13.root-agents-md-v1.md`), all false-positive path-like prose (`node_modules/next/dist/docs/`, an IANA timezone name, a Playwright auth-state file path). Not fixed, deliberately: `.brain/archive/README.md`'s own rule is "Never edit an archived file. It is a snapshot." Every other failure and warning across 41 documents was fixed.
- `node agent-brain-tool/bin/brain audit .` — root per-session tax ~5,771 → ~1,913 tokens (-66.9%); modeled naive-discovery cost ~111,976 → ~1,913 tokens (-98.3%); 0 budget violations (was 1).
- `node agent-brain-tool/bin/brain graph .` — 93 nodes, 254 edges, written to `.brain/graph.html` (gitignored, regenerate on demand).
