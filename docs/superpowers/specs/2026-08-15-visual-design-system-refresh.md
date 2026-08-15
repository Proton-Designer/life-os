# Visual Design System Refresh — Design Spec

**Status:** Approved by architect (Opus Lead), direct user request with reference images. Ayman is present/reachable this session (not overnight autonomous) — flag genuine ambiguities as they come up rather than guessing silently, but proceed without waiting on approval for individual component decisions.

## Brief (from Ayman)

Current UI (screenshotted: Home v2) looks barebones/flat/icon-less. Two reference dashboards ("finance overview" and "InsightX") show the target polish level: colored icon chips, richer stat cards, donut/line charts with accent highlights, sectioned sidebar nav, generous spacing, layered depth. Requirements:
- Keep the base color scheme (black background + dark red/maroon glow) — this is not a re-theme, it's a polish pass.
- Add a **light blue accent** (per the InsightX reference's blue tones) — "light" meaning used sparingly as an accent, not a blue re-theme.
- Add "more diversity so it doesn't look robotic" — i.e. not everything should look identical/flat.
- Cover **every screen**, desktop and mobile: Home, Deen, Business, Fitness, School, Co-op, Settings, Insights, Weekly Planning, Login/Signup, Onboarding.
- Sonnet Engineer does all implementation/research/audits. Opus Lead designs, reviews, verifies (same split as every prior phase this week).

## Design plan

**Color** (extends `app/globals.css`'s existing tokens, does not replace them):
- Unchanged: `--background #0a0a0c`, `--card #131316`, `--foreground #f2efec`, `--glow-oxblood #2b0e13` (the maroon body-background glow), all 5 domain accents (`--accent-deen` amber, `--accent-business` green, `--accent-school` blue, `--accent-fitness` amber, `--accent-noise`/`--destructive` red).
- **New**: `--accent-info: #5b8fd9` ("signal blue") — a distinct, slightly deeper blue than `--accent-school`'s `#6aa9ff` so the two don't get visually confused when both appear on screen (e.g. a School peek card next to a generic "info" badge). This is the app's new general-purpose chrome accent: nav active states, focus rings, links, informational badges, chart highlight lines — anything that isn't tied to a specific domain. Ties back to the brief's "light blueish accent" ask while staying consistent with the fact the palette already has a blue family (School) — extending an existing hue rather than introducing a clashing new one.
- Semantic status mapping (mostly already true, make it explicit/consistent): positive/good = `--accent-business` green, negative/missed = `--destructive` red, warning/pending = `--accent-deen` amber, informational/neutral = new `--accent-info` blue.

**Type**: keep Geist Sans as the UI face (already established across 5 days of work — a full typeface swap this late is unjustified risk for what's fundamentally a polish pass, not a rebrand). Do introduce **Geist Mono** (`--font-geist-mono`, already loaded but currently unused anywhere in the UI) for stat/numeric values specifically — `font-mono tabular-nums`, used on every "big number" (Home's stat strip, StatCard values, elapsed timers, counts). Establish an explicit scale: page title `text-2xl font-semibold` → section label `text-xs uppercase tracking-wide text-muted-foreground` → card title `text-sm font-medium` → stat value `text-3xl font-mono font-semibold tabular-nums` → body `text-sm`.

**Layout / new shared components** (`components/ui/` or a new `components/design-system/`):
- **`IconChip`** — small rounded-xl chip (size-9/10), tinted background at ~12% opacity of a given accent color, Lucide icon in that accent color at full opacity. The connective visual element used everywhere a card/row needs a leading glyph — nav items, card headers, stat tiles, list rows.
- **`StatCard`** — IconChip + label + `font-mono` tabular-nums value + optional trend/status pill, `rounded-2xl border border-border/40`, and for *featured* cards only, a subtle radial-gradient wash in the card's accent color at low opacity (generalizing the pattern `NextUpHero` already uses into a reusable prop, e.g. `<StatCard accent="deen" featured>`). Not every card gets the wash — see Restraint below.
- **`Badge`** — small `rounded-full px-2.5 py-0.5 text-xs` pill, semantic color variants (`positive`/`negative`/`warning`/`info`/`neutral`) driving background/text color from the mapping above. Replaces ad-hoc one-off status styling scattered across prayer rows, kill-list items, task/checkin states, reflection tiers, habit stages.
- **Domain icon mapping** (Lucide, already an installed dependency, no new asset needed): Deen = `Moon`, Business = `Target`, Fitness = `Dumbbell`, School = `GraduationCap`, Co-op = `Users`. Used consistently in `IconChip`s across nav, peek cards, and section headers — this is the one thing that should look identical everywhere a domain is referenced, so it reads as a real system, not a one-off decoration.
- **Nav polish**: `TopNav` gets an icon+label per item instead of text-only; the active item gets a soft pill background (domain-tinted when on that domain's page, `--accent-info`-tinted for Home/Settings) instead of just an underline. `MobileIsland` gets the same domain icons (it may already partially — verify and align, don't duplicate a second icon set).

**Restraint (per the brief's "diversity, not robotic" ask, and per design-craft practice — not everything should look the same, but not everything should be maximalist either)**: only *featured/primary* cards per screen get the gradient-wash treatment (Home's `NextUpHero`, one hero stat per domain page, Lock-In's active session card). Everything else stays a quiet flat card with an IconChip for visual anchoring. This is the actual mechanism for "diversity without robotic uniformity" — spend the boldness in a few deliberate places per screen, not scattered evenly across every element (which would look busier, not more premium).

**Signature element**: the domain `IconChip` + selective gradient-wash `StatCard` pattern, applied consistently as connective tissue across all 5 life domains and shared chrome, unified by the new signal-blue accent for anything cross-domain. This directly encodes the app's real structure (5 distinct life domains) rather than being a generic dashboard clone — the reference images inspired the *treatment* (icon chips, stat cards, layered depth), not a literal layout copy.

## Self-critique against generic-AI-dashboard defaults

Not cluster 1 (cream/terracotta — this app is dark, unaffected). Not cluster 3 (broadsheet/serif — this app uses Geist Sans/rounded cards, unaffected). Closest risk is cluster 2 (near-black + single bright accent) — mitigated by keeping the existing 5-color domain-accent system as the primary differentiator and treating the new blue strictly as a *secondary* chrome accent, not a wholesale re-theme around one bright color. The maroon body-glow (unique to this app, present since the original build) stays as the ambient signature, unchanged.

## Build order (phased, each screenshot-verified by the lead before the next starts)

1. **Phase A — Design system foundation.** New `--accent-info` token, `IconChip`/`StatCard`/`Badge` components (with tests), applied to `TopNav`/`MobileIsland` (shared chrome, seen on every screen) + a light pass over `components/ui/card.tsx`/`button.tsx` if needed for the new border/depth treatment. This is the foundation every later phase builds on — get it right before applying broadly.
2. **Phase B — Home v2.** Apply StatCard to the "This Week" summary strip, IconChip to all 5 domain peek cards and NextUpHero, Badge to prayer status dots. Already the most complex layout — good proving ground.
3. **Phase C — Deen + Business.** The two heaviest domain pages (Salah rows, Reflection tracker, Habit Builder; Lock-In session, kill list, S:N card).
4. **Phase D — Fitness + School + Co-op.** Lighter, structurally similar pages.
5. **Phase E — Settings, Insights, Weekly Planning, Login/Signup/Onboarding.** Remaining screens, full mobile-specific visual pass across every screen already touched.
6. **Phase F — Full regression + visual QA + deploy.** Unit/tsc/lint/build/E2E, screenshot every screen at desktop+mobile widths, deploy, live verification.
