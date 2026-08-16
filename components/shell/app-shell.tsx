import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { formatTopbarDate } from "@/lib/date-utils";
import { AppShellChrome } from "./app-shell-chrome";

async function getHasActiveLockIn(userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("work_sessions")
    .select("id")
    .eq("user_id", userId)
    .is("ended_at", null)
    .maybeSingle();
  return Boolean(data);
}

export async function AppShell({ children }: { children: React.ReactNode }) {
  const user = await getAuthedUser();

  // getProfile() and the Lock-In lookup both only depend on `user`, not on
  // each other — run them concurrently instead of one after the other.
  // (Topbar's Lock-In status affordance is the same "active session" shape
  // Business's own LockInPanel queries, kept as its own minimal lookup here
  // rather than threading a shared helper through, since this is the only
  // other place that needs just the boolean, not the full session/checkins.)
  const [profile, hasActiveLockIn] = await Promise.all([
    getProfile(),
    user ? getHasActiveLockIn(user.id) : Promise.resolve(false),
  ]);
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
