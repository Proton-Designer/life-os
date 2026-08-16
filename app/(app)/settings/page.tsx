import { redirect } from "next/navigation";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { SettingsForm } from "@/components/settings/settings-form";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";

const SECTIONS = [
  { id: "profile", label: "Profile" },
  { id: "prayer", label: "Prayer" },
  { id: "checkins", label: "Check-ins" },
  { id: "security", label: "Security" },
  { id: "data", label: "Data" },
];

export default async function SettingsPage() {
  const user = await getAuthedUser();
  if (!user) redirect("/login");

  // getProfile() selects the full row (see lib/supabase/auth.ts) — destructure
  // only the specific safe fields below into SettingsForm's props, same as
  // before. Never spread the raw profile object into a Client Component's
  // props: it also carries pin_hash, which must never reach the client.
  const profile = await getProfile();

  return (
    <PageContainer>
      <PageHeader title="Settings" />
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[180px_1fr]">
        {/* Sticky section nav — xl only. Below that, a side rail doesn't
            have room to live next to content, so it's dropped entirely
            rather than squeezed; the sections are still reachable by
            scrolling in document order. */}
        <nav className="hidden xl:block">
          <ul className="sticky top-24 flex flex-col gap-1 text-sm">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="block rounded-md px-3 py-2 text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <SettingsForm
          email={user.email ?? ""}
          initial={{
            displayName: profile?.display_name ?? "",
            prayerCalcMethod: profile?.prayer_calc_method ?? "MWL",
            asrMadhab: (profile?.asr_madhab as "standard" | "hanafi") ?? "standard",
            locationLabel: profile?.location_label ?? "",
            checkinWindowStart: profile?.checkin_window_start?.slice(0, 5) ?? "08:00",
            checkinWindowEnd: profile?.checkin_window_end?.slice(0, 5) ?? "22:00",
            checkinIntervalMinutes: profile?.checkin_interval_minutes ?? 120,
            pinLockEnabled: profile?.pin_lock_enabled ?? false,
          }}
        />
      </div>
    </PageContainer>
  );
}
