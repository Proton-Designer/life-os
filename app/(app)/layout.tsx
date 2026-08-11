import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { AppShell } from "@/components/shell/app-shell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getAuthedUser();

  if (!user) {
    redirect("/login");
  }

  const pathname = (await headers()).get("x-pathname") ?? "";
  if (!pathname.startsWith("/onboarding")) {
    const profile = await getProfile();

    // No profile row yet is equivalent to "onboarding not done" — a brand
    // new auth user has no profiles row until onboarding creates one.
    if (!profile || profile.onboarding_completed === false) {
      redirect("/onboarding");
    }
  }

  return <AppShell>{children}</AppShell>;
}
