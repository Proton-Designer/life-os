import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SettingsForm } from "@/components/settings/settings-form";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "prayer_calc_method, asr_madhab, location_label, checkin_window_start, checkin_window_end, checkin_interval_minutes, pin_lock_enabled"
    )
    .eq("user_id", user.id)
    .maybeSingle();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-8 md:py-12">
      <h1 className="text-lg font-semibold">Settings</h1>
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
