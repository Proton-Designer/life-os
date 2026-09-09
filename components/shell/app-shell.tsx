import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { formatTopbarDate, localDateString } from "@/lib/date-utils";
import { getActiveWorkSession } from "@/lib/business/active-session";
import { getKillListSlots } from "@/lib/business/kill-list-slots";
import { getUserDomains } from "@/lib/domains/get-user-domains";
import { computeNavDomainState, type NavDomainState } from "@/lib/shell/nav-domain-state";
import { resolveThemePreset } from "@/lib/theme-presets";
import { sanitizeHiddenFeatures } from "@/lib/features";
import { AppShellChrome } from "./app-shell-chrome";
import type { LockInSessionKind } from "@/components/business/lock-in-overlay-context";
import type { WeekCalendarData } from "@/components/calendar/week-calendar-view";
import type { KillListSlotData } from "@/components/business/kill-list";

const EMPTY_KILL_LIST_SLOTS: [KillListSlotData, KillListSlotData, KillListSlotData] = [
  { id: null, text: "", completed: false },
  { id: null, text: "", completed: false },
  { id: null, text: "", completed: false },
];

type SaveGoalAction = (headline: string, milestones: string[], quranPageTarget?: number) => Promise<void>;

export async function AppShell({
  children,
  getWeekCalendar,
  onSaveDeen,
  onSaveBusiness,
}: {
  children: React.ReactNode;
  getWeekCalendar: () => Promise<WeekCalendarData>;
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
  const hiddenFeatures = sanitizeHiddenFeatures(profileThemeFields?.hidden_features);
  const now = new Date();
  const dateStr = localDateString(now, timezone);

  // getActiveWorkSession is ALSO a warm memo (the layout's own Promise.all
  // already resolved it) — awaiting it alone here is free. getKillListSlots
  // is not: it's a live query, gated behind it deliberately (Opus Lead
  // correction, 2026-08-28) so it only runs on the one navigation shape
  // that actually needs it — the Deep Work overlay showing a running
  // session. Everything else (every other route, an idle Business page, a
  // Deep Study session) pays zero extra round trips; /business itself is
  // unaffected since it reads getKillListSlots directly, independent of
  // this gate.
  const activeWorkSession = user ? await getActiveWorkSession(user.id) : null;
  const killListSlots =
    user && activeWorkSession?.kind === "deep_work"
      ? await getKillListSlots(user.id, dateStr)
      : EMPTY_KILL_LIST_SLOTS;

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
    userDomains.mode === "domains" ? computeNavDomainState(userDomains.domains, userDomains.subdomains) : null;

  return (
    <AppShellChrome
      account={account}
      userId={user?.id ?? null}
      dateLabel={formatTopbarDate(now, timezone)}
      nowIso={now.toISOString()}
      timezone={timezone}
      themePreset={themePreset}
      hiddenFeatures={hiddenFeatures}
      activeWorkSession={
        activeWorkSession
          ? {
              id: activeWorkSession.id,
              startedAtIso: activeWorkSession.startedAt,
              // getActiveWorkSession() stays WorkSessionKind (wide) at the type
              // level by design — its own comment explains why: the query is
              // runtime-scoped to deep-work-class sessions only
              // (.eq("counts_toward_hours", true)), and 'learn' rows are
              // "deliberately concurrent-safe... do not participate in the
              // single-active-session model at all". The Lock-In overlay only
              // ever handles that deep-work-class subset (LockInSessionKind),
              // so this narrowing is safe — same shape as active-session.ts's
              // own `data.kind as WorkSessionKind` cast one layer down.
              kind: activeWorkSession.kind as LockInSessionKind,
            }
          : null
      }
      killListSlots={killListSlots}
      getWeekCalendar={getWeekCalendar}
      onSaveDeen={onSaveDeen}
      onSaveBusiness={onSaveBusiness}
      navMode={navMode}
      navDomainState={navDomainState}
    >
      {children}
    </AppShellChrome>
  );
}
