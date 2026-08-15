import { redirect } from "next/navigation";
import { Settings as SettingsIcon } from "lucide-react";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { SettingsForm } from "@/components/settings/settings-form";
import { IconChip } from "@/components/ui/icon-chip";

export default async function SettingsPage() {
  const user = await getAuthedUser();
  if (!user) redirect("/login");

  // getProfile() selects the full row (see lib/supabase/auth.ts) — destructure
  // only the specific safe fields below into SettingsForm's props, same as
  // before. Never spread the raw profile object into a Client Component's
  // props: it also carries pin_hash, which must never reach the client.
  const profile = await getProfile();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-8 md:py-12">
      <h1 className="flex items-center gap-2.5 text-lg font-semibold">
        <IconChip icon={SettingsIcon} accent="info" size="sm" />
        Settings
      </h1>
      <SettingsForm
        initial={{
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
  );
}
