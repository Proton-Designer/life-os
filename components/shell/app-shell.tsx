import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { getActiveWorkSession } from "@/lib/business/active-session";
import { formatTopbarDate } from "@/lib/date-utils";
import { AppShellChrome } from "./app-shell-chrome";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const user = await getAuthedUser();

  // getProfile() and the Lock-In lookup both only depend on `user`, not on
  // each other — run them concurrently instead of one after the other.
  // getActiveWorkSession is cache()-wrapped (lib/business/active-session.ts)
  // so Home's Focus module hitting the same query this request costs zero
  // extra round trips.
  const [profile, activeSession] = await Promise.all([
    getProfile(),
    user ? getActiveWorkSession(user.id) : Promise.resolve(null),
  ]);
  const hasActiveLockIn = Boolean(activeSession);
  const timezone = profile?.timezone ?? "UTC";

  const account = {
    displayName: profile?.display_name || user?.email?.split("@")[0] || "Account",
    email: user?.email ?? "",
  };

  return (
    <AppShellChrome
      account={account}
      dateLabel={formatTopbarDate(new Date(), timezone)}
      hasActiveLockIn={hasActiveLockIn}
    >
      {children}
    </AppShellChrome>
  );
}
