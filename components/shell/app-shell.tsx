import { createClient } from "@/lib/supabase/server";
import { hasOptInFeature } from "@/lib/opt-in-features";
import { loadHomeWindDown } from "@/lib/home/wind-down-home";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { formatTopbarDate, localDateString } from "@/lib/date-utils";
import { getActiveWorkSessionDetail } from "@/lib/business/active-session";
import { getKillListSlots } from "@/lib/business/kill-list-slots";
import { getUserDomains } from "@/lib/domains/get-user-domains";
import { computeNavDomainState, type NavDomainState } from "@/lib/shell/nav-domain-state";
import { resolveThemePreset } from "@/lib/theme-presets";
import { ThemeRootScript } from "@/components/shell/theme-root-script";
import { sanitizeHiddenFeatures } from "@/lib/features";
import { AppShellChrome } from "./app-shell-chrome";
import type { LockInSessionKind } from "@/components/business/lock-in-overlay-context";
import type { KillListSlotData } from "@/components/business/kill-list";
import { isDeenModeOn } from "@/lib/deen/deen-mode";
import { effectiveHiddenFeatures } from "@/lib/shell/effective-hidden-features";

const EMPTY_KILL_LIST_SLOTS: [KillListSlotData, KillListSlotData, KillListSlotData] = [
  { id: null, text: "", completed: false },
  { id: null, text: "", completed: false },
  { id: null, text: "", completed: false },
];

type SaveGoalAction = (headline: string, milestones: string[], quranPageTarget?: number) => Promise<void>;

export async function AppShell({
  children,
  onSaveDeen,
  onSaveBusiness,
}: {
  children: React.ReactNode;
  onSaveDeen: SaveGoalAction;
  onSaveBusiness: SaveGoalAction;
}) {
  const user = await getAuthedUser();
  // getProfile() alone: app/(app)/layout.tsx, AppShell's own caller, already
  // awaits it before AppShell ever runs, so this is a resolved cache() memo
  // by the time it's called here — free, unlike the kill-list query below.
  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";

  // L10: `theme_preset`/`hidden_features` are a NEW migration, not yet
  // applied/regenerated into database.types.ts at the time this is written
  // — same reasoning lib/mcp/tokens.ts documents for its own untyped
  // SupabaseClient param. getProfile()'s return type won't carry these
  // fields until that migration lands and types are regenerated, so this
  // reads them via a loose, defensive cast rather than asserting a shape
  // the generated Row type doesn't back up yet. resolveThemePreset/
  // sanitizeHiddenFeatures both already treat "missing/unrecognized" as
  // "use the safe default" — this is exactly that case until the column
  // exists in production.
  const profileThemeFields = profile as { theme_preset?: string; hidden_features?: string[] } | null;
  const themePreset = resolveThemePreset(profileThemeFields?.theme_preset);
  const deenMode = isDeenModeOn(profile);
  // Deen Mode OFF folds "deen" into the legacy-nav hidden set (sidebar,
  // mobile island). The stored hidden_features array is never rewritten.
  const hiddenFeatures = effectiveHiddenFeatures(sanitizeHiddenFeatures(profileThemeFields?.hidden_features), deenMode);
  const now = new Date();
  const dateStr = localDateString(now, timezone);

  // getActiveWorkSessionDetail is ALSO a warm memo (the layout's own
  // Promise.all already resolved it, 146) — awaiting it alone here is free.
  // getKillListSlots is not: it's a live query, gated behind it
  // deliberately (Opus Lead correction, 2026-08-28) so it only runs on the
  // one navigation shape that actually needs it — the Deep Work overlay
  // showing a running session. Everything else (every other route, an idle
  // Business page, a Deep Study session) pays zero extra round trips;
  // /business itself is unaffected since it reads getKillListSlots
  // directly, independent of this gate. The setup dialog's OWN kill-list
  // and classes fetches (before a session exists) are separately on-demand
  // — see getSessionKillListObjectives/getSessionClasses's own comments
  // (app/(app)/business/actions.ts) for why those aren't threaded down from
  // here either.
  const activeWorkSession = user ? await getActiveWorkSessionDetail(user.id) : null;
  const killListSlots =
    user && activeWorkSession?.kind === "deep_work"
      ? await getKillListSlots(user.id, dateStr)
      : EMPTY_KILL_LIST_SLOTS;

  // IA-P4b: the wind-down start follows the plan only while Sleep plan is ON (one query for those accounts, none otherwise).
  const homeWindDown = user ? await loadHomeWindDown(await createClient(), user.id, hasOptInFeature(profile?.enabled_features, "sleep_plan")) : null;
  const windDownStart = homeWindDown?.windDownStart;

  const account = {
    displayName: profile?.display_name || user?.email?.split("@")[0] || "Account",
    email: user?.email ?? "",
  };

  // M6 failsafe: mode:"legacy" gets the exact existing nav components
  // (AppShellChrome branches on navMode below) — this is what makes it a
  // real failsafe rather than a believed one, per the Lead's ruling: an
  // account that predates domain selection never enters the new nav's code
  // path at all, so a bug in the four-tab shell structurally cannot reach it.
  const userDomains = await getUserDomains();
  const navMode = userDomains.mode;
  const navDomainState: NavDomainState | null =
    userDomains.mode === "domains" ? computeNavDomainState(userDomains.domains, userDomains.subdomains, deenMode) : null;

  return (
    <>
    <ThemeRootScript preset={themePreset} />
    <AppShellChrome
      account={account}
      userId={user?.id ?? null}
      dateLabel={formatTopbarDate(now, timezone)}
      nowIso={now.toISOString()}
      timezone={timezone}
      themePreset={themePreset}
      hiddenFeatures={hiddenFeatures}
      deenMode={deenMode}
      windDownStart={windDownStart}
      activeWorkSession={
        activeWorkSession
          ? {
              id: activeWorkSession.id,
              startedAtIso: activeWorkSession.startedAt,
              // getActiveWorkSessionDetail() stays WorkSessionKind (wide) at
              // the type level by design — its own comment explains why: the
              // query is runtime-scoped to deep-work-class sessions only
              // (.eq("counts_toward_hours", true)), and 'learn' rows are
              // "deliberately concurrent-safe... do not participate in the
              // single-active-session model at all". The Lock-In overlay only
              // ever handles that deep-work-class subset (LockInSessionKind),
              // so this narrowing is safe — same shape as active-session.ts's
              // own `data.kind as WorkSessionKind` cast one layer down.
              kind: activeWorkSession.kind as LockInSessionKind,
              goalMinutes: activeWorkSession.goalMinutes,
              objectives: activeWorkSession.objectives,
            }
          : null
      }
      killListSlots={killListSlots}
      onSaveDeen={onSaveDeen}
      onSaveBusiness={onSaveBusiness}
      navMode={navMode}
      navDomainState={navDomainState}
    >
      {children}
    </AppShellChrome>
    </>
  );
}
