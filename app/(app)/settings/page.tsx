import { redirect } from "next/navigation";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { SettingsForm, type SettingsFormData } from "@/components/settings/settings-form";
import { NotificationSettings } from "@/components/settings/notification-settings";
import { WeekdayBaselineSettings } from "@/components/settings/weekday-baseline-settings";
import { ApiKeySettings } from "@/components/settings/api-key-settings";
import { getApiKeyStatuses } from "@/app/(app)/settings/api-key-actions";
import { PROVIDERS, PROVIDER_IDS } from "@/lib/ai/providers";
import { isKeyStorageConfigured } from "@/lib/ai/encryption";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { Panel } from "@/components/ui/panel";

const SECTIONS = [
  { id: "profile", label: "Profile" },
  { id: "prayer", label: "Prayer" },
  { id: "location", label: "Location" },
  { id: "checkins", label: "Check-ins" },
  { id: "notifications", label: "Notifications" },
  { id: "ai", label: "AI features" },
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

  // Read the weekly shape here rather than inside the editor: the editor is a
  // Client Component, and NULL vs an array is exactly the distinction it must
  // preserve — better it receives the real value than fetches and defaults.
  const supabase = await createClient();
  const { data: settingsRow } = await supabase
    .from("user_settings")
    .select("weekday_baselines")
    .eq("user_id", user.id)
    .maybeSingle();
  const weekdayBaselines = (settingsRow?.weekday_baselines ?? null) as number[] | null;

  // Plain serializable values only across the RSC boundary — the provider
  // registry is const-asserted, so it is spread into a plain array here rather
  // than handed over as-is. See AGENTS.md on Server -> Client props.
  const providers = PROVIDER_IDS.map((id) => ({
    id,
    label: PROVIDERS[id].label,
    consoleUrl: PROVIDERS[id].consoleUrl,
    unlocks: PROVIDERS[id].unlocks,
  }));
  const keyStatuses = await getApiKeyStatuses();
  const storageConfigured = isKeyStorageConfigured();

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
        <div className="flex flex-col gap-8">
          <SettingsForm
            email={user.email ?? ""}
            initial={{
              displayName: profile?.display_name ?? "",
              prayerCalcMethod: (profile?.prayer_calc_method as SettingsFormData["prayerCalcMethod"]) ?? "MWL",
              asrMadhab: (profile?.asr_madhab as "standard" | "hanafi") ?? "standard",
              location: {
                lat: profile?.location_lat ?? null,
                lng: profile?.location_lng ?? null,
                label: profile?.location_label ?? null,
                timezone: profile?.timezone ?? null,
              },
              checkinWindowStart: profile?.checkin_window_start?.slice(0, 5) ?? "08:00",
              checkinWindowEnd: profile?.checkin_window_end?.slice(0, 5) ?? "22:00",
              checkinIntervalMinutes: profile?.checkin_interval_minutes ?? 120,
              pinLockEnabled: profile?.pin_lock_enabled ?? false,
            }}
          />
          <Panel id="notifications" className="scroll-mt-24" title="Notifications">
            <NotificationSettings />
          </Panel>

          <Panel title="Weekly shape">
            <p className="text-xs text-muted-foreground">
              What a normal day looks like, so the evening close can tell you whether today matched it.
            </p>
            <div className="mt-3">
              <WeekdayBaselineSettings initial={weekdayBaselines} />
            </div>
          </Panel>
          <Panel id="ai" className="scroll-mt-24" title="AI features (optional)">
            <ApiKeySettings
              providers={providers}
              initialStatuses={keyStatuses}
              storageConfigured={storageConfigured}
            />
          </Panel>
        </div>
      </div>
    </PageContainer>
  );
}
