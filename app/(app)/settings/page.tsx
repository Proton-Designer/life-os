import { redirect } from "next/navigation";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { SettingsForm, type SettingsFormData } from "@/components/settings/settings-form";
import { NotificationSettings } from "@/components/settings/notification-settings";
import { WindDownPlanSettings } from "@/components/settings/wind-down-plan-settings";
import { SleepReminderSettings } from "@/components/settings/sleep-reminder-settings";
import { WeekdayBaselineSettings } from "@/components/settings/weekday-baseline-settings";
import { FocusTargetSettings } from "@/components/settings/focus-target-settings";
import { StreamedIntegrationPanels } from "@/components/settings/streamed-panels";
import { ThemeSettings } from "@/components/settings/theme-settings";
import { FeatureVisibilitySettings } from "@/components/settings/feature-visibility-settings";
import { OptInFeaturesSettings } from "@/components/settings/opt-in-features-settings";
import { DeenModeSettings } from "@/components/settings/deen-mode-settings";
import { QuranReminderSettings } from "@/components/settings/quran-reminder-settings";
import { isDeenModeOn } from "@/lib/deen/deen-mode";
import { resolveThemePreset } from "@/lib/theme-presets";
import { sanitizeHiddenFeatures } from "@/lib/features";
import { sanitizeEnabledFeatures } from "@/lib/opt-in-features";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { Panel } from "@/components/ui/panel";
import { SETTINGS_SECTIONS as SECTIONS } from "@/lib/settings/sections";

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
    .select("weekday_baselines, wake_time, sleep_need_minutes, wind_down_minutes, daily_focus_target_minutes, weekend_focus_target_minutes, quran_reminder_start, quran_reminder_end")
    .eq("user_id", user.id)
    .maybeSingle();
  const weekdayBaselines = (settingsRow?.weekday_baselines ?? null) as number[] | null;
  // HOME-01a (migration 256): NULL = unset; the editor shows the 4:00 default.
  const focusTargets = {
    dailyMinutes: settingsRow?.daily_focus_target_minutes ?? null,
    weekendMinutes: settingsRow?.weekend_focus_target_minutes ?? null,
  };

  // L10: same defensive-cast reasoning as components/shell/app-shell.tsx —
  // theme_preset/hidden_features are a NEW migration, not yet reflected in
  // getProfile()'s generated return type at the time this is written.
  const profileThemeFields = profile as { theme_preset?: string; hidden_features?: string[] } | null;
  const themePreset = resolveThemePreset(profileThemeFields?.theme_preset);
  const hiddenFeatures = sanitizeHiddenFeatures(profileThemeFields?.hidden_features);
  // Migration 183 (P2-05) -- same defensive cast as theme_preset/
  // hidden_features above (not yet in generated database.types.ts at the
  // time this is written).
  const sleepReminderEnabled = (profile as { sleep_reminder_enabled?: boolean } | null)?.sleep_reminder_enabled ?? false;
  // Migration 250 (P3-05/P3-11) -- applied and in the generated types, no
  // defensive cast needed like the fields above.
  const enabledFeatures = sanitizeEnabledFeatures(profile?.enabled_features);
  // Migration 251 (DEEN-02) -- fails closed (OFF) on a missing row/value.
  const deenMode = isDeenModeOn(profile);

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
            {SECTIONS.filter((s) => (s.id === "prayer" || s.id === "location" ? deenMode : s.id === "timezone" ? !deenMode : true)).map((s) => (
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
            deenMode={deenMode}
            slots={{
              afterProfile: (
                <>
                  <Panel id="appearance" className="scroll-mt-24" title="Appearance">
                    <ThemeSettings initial={themePreset} />
                  </Panel>
                  <Panel id="features" className="scroll-mt-24" title="Features">
                    <div className="mb-4 border-b border-border/40 pb-4">
                      <DeenModeSettings initialOn={deenMode} />
                    </div>
                    {deenMode && (
                      <div className="mb-4 border-b border-border/40 pb-4">
                        <QuranReminderSettings initialStart={settingsRow?.quran_reminder_start ?? null} initialEnd={settingsRow?.quran_reminder_end ?? null} />
                      </div>
                    )}
                    <FeatureVisibilitySettings initialHidden={hiddenFeatures} />
                  </Panel>
                  <Panel id="optional-features" className="scroll-mt-24" title="Optional features">
                    <OptInFeaturesSettings initialEnabled={enabledFeatures} />
                  </Panel>
                </>
              ),
              afterCheckins: (
                <>
          <Panel title="Daily focus target">
                    <FocusTargetSettings initial={focusTargets} />
                  </Panel>
          <Panel title="Weekly shape">
                    <p className="text-xs text-muted-foreground">
                      What a normal day looks like, so the evening close can tell you whether today matched it.
                    </p>
                    <div className="mt-3">
                      <WeekdayBaselineSettings initial={weekdayBaselines} />
                    </div>
                  </Panel>
                  <Panel id="notifications" className="scroll-mt-24" title="Notifications">
                    <div className="flex flex-col gap-4">
                      <NotificationSettings />
                      {enabledFeatures.includes("sleep_plan") && (
                        <WindDownPlanSettings
                          initialWakeTime={(settingsRow?.wake_time ?? null) as string | null}
                          initialSleepNeedMinutes={(settingsRow?.sleep_need_minutes ?? null) as number | null}
                          initialWindDownMinutes={(settingsRow?.wind_down_minutes ?? null) as number | null}
                        />
                      )}
                      {enabledFeatures.includes("sleep_plan") && <SleepReminderSettings initialEnabled={sleepReminderEnabled} />}
                    </div>
                  </Panel>

                  {/* NAV-01b: these panels read their own data and stream in, concurrently. */}
                  <StreamedIntegrationPanels />
                </>
              ),
            }}
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
              allocationCheckinsEnabled: profile?.allocation_checkins_enabled ?? false,
              pinLockEnabled: profile?.pin_lock_enabled ?? false,
            }}
          />
        </div>
      </div>
    </PageContainer>
  );
}
