import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { formatTopbarDate } from "@/lib/date-utils";
import { AppShellChrome } from "./app-shell-chrome";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const user = await getAuthedUser();
  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";

  const account = {
    displayName: profile?.display_name || user?.email?.split("@")[0] || "Account",
    email: user?.email ?? "",
  };

  const now = new Date();

  return (
    <AppShellChrome
      account={account}
      dateLabel={formatTopbarDate(now, timezone)}
      nowIso={now.toISOString()}
      timezone={timezone}
    >
      {children}
    </AppShellChrome>
  );
}
