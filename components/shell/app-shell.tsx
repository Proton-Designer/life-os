import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { formatTopbarDate } from "@/lib/date-utils";
import { AppShellChrome } from "./app-shell-chrome";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const user = await getAuthedUser();
  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";

  // Topbar's Lock-In status affordance — same "active session" shape
  // Business's own LockInPanel queries, kept as its own minimal lookup here
  // rather than threading a shared helper through, since this is the only
  // other place that needs just the boolean (not the full session/checkins).
  let hasActiveLockIn = false;
  if (user) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("work_sessions")
      .select("id")
      .eq("user_id", user.id)
      .is("ended_at", null)
      .maybeSingle();
    hasActiveLockIn = Boolean(data);
  }

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
