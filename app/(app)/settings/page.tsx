import { redirect } from "next/navigation";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { SettingsForm, type SettingsFormData } from "@/components/settings/settings-form";
import { NotificationSettings } from "@/components/settings/notification-settings";
import { SleepReminderSettings } from "@/components/settings/sleep-reminder-settings";
import { WeekdayBaselineSettings } from "@/components/settings/weekday-baseline-settings";
import { ApiKeySettings } from "@/components/settings/api-key-settings";
import { getApiKeyStatuses } from "@/app/(app)/settings/api-key-actions";
import { AiPreferenceSettings, type AiProviderCatalogInfo } from "@/components/settings/ai-preference-settings";
import { getMyAiPreference } from "@/app/(app)/settings/ai-preference-actions";
import { AiSpendCeilingSettings } from "@/components/settings/ai-spend-ceiling-settings";
import { getMyMonthlySpendStatus } from "@/app/(app)/settings/ai-spend-actions";
import { MODEL_CATALOG } from "@/lib/ai/model-catalog";
import { ConnectorSettings } from "@/components/settings/connector-settings";
import { getMcpTokenStatuses } from "@/app/(app)/settings/mcp-token-actions";
import { CanvasSettings } from "@/components/settings/canvas-settings";
import { getCanvasConnectionStatus, getCanvasCourseMappings, getLocalClassOptions } from "@/app/(app)/settings/canvas-actions";
import { ThemeSettings } from "@/components/settings/theme-settings";
import { FeatureVisibilitySettings } from "@/components/settings/feature-visibility-settings";
import { resolveThemePreset } from "@/lib/theme-presets";
import { sanitizeHiddenFeatures } from "@/lib/features";
import { PROVIDERS, PROVIDER_IDS } from "@/lib/ai/providers";
import { isKeyStorageConfigured } from "@/lib/ai/encryption";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { Panel } from "@/components/ui/panel";

const SECTIONS = [
  { id: "profile", label: "Profile" },
  { id: "appearance", label: "Appearance" },
  { id: "features", label: "Features" },
  { id: "prayer", label: "Prayer" },
  { id: "location", label: "Location" },
  { id: "checkins", label: "Check-ins" },
  { id: "notifications", label: "Notifications" },
  { id: "ai", label: "AI features" },
  { id: "canvas", label: "Canvas" },
  { id: "connectors", label: "Connectors" },
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
  const mcpTokens = await getMcpTokenStatuses();

  // Multi-provider preference picker. `hasKey` deliberately only reflects
  // a STORED key, never the operator-funded fallback (even for an
  // allowlisted deepseek account) -- this UI has no cheap, accurate way to
  // check per-user allowlist status from here, and an optimistic "has key"
  // that turns out wrong is worse than a conservative "no key" that turns
  // out to still work anyway.
  const hasStoredKey = new Set(keyStatuses.map((s) => s.provider));
  const aiPreferenceCatalog: AiProviderCatalogInfo[] = PROVIDER_IDS.map((id) => {
    const entry = MODEL_CATALOG[id];
    return {
      id,
      label: PROVIDERS[id].label,
      hasKey: hasStoredKey.has(id),
      cheap: { id: entry.budget.id, inputUsdPer1M: entry.budget.inputUsdPer1M, outputUsdPer1M: entry.budget.outputUsdPer1M },
      capable: { id: entry.flagship.id, inputUsdPer1M: entry.flagship.inputUsdPer1M, outputUsdPer1M: entry.flagship.outputUsdPer1M },
    };
  });
  const aiPreference = await getMyAiPreference();
  const monthlySpendStatus = await getMyMonthlySpendStatus();
  const canvasStatus = await getCanvasConnectionStatus();
  const canvasMappings = await getCanvasCourseMappings();
  const localClasses = await getLocalClassOptions();

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
              pinLockEnabled: profile?.pin_lock_enabled ?? false,
            }}
          />
          <Panel id="appearance" className="scroll-mt-24" title="Appearance">
            <ThemeSettings initial={themePreset} />
          </Panel>
          <Panel id="features" className="scroll-mt-24" title="Features">
            <FeatureVisibilitySettings initialHidden={hiddenFeatures} />
          </Panel>
          <Panel id="notifications" className="scroll-mt-24" title="Notifications">
            <div className="flex flex-col gap-4">
              <NotificationSettings />
              <SleepReminderSettings initialEnabled={sleepReminderEnabled} />
            </div>
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
            <div className="flex flex-col gap-4">
              <AiPreferenceSettings
                catalog={aiPreferenceCatalog}
                initialProvider={aiPreference.provider}
                initialModelTier={aiPreference.modelTier}
              />
              <AiSpendCeilingSettings
                initialSpentUsd={monthlySpendStatus.spentUsd}
                initialCapUsd={monthlySpendStatus.capUsd}
                monthKey={monthlySpendStatus.monthKey}
              />
              <ApiKeySettings
                providers={providers}
                initialStatuses={keyStatuses}
                storageConfigured={storageConfigured}
              />
            </div>
          </Panel>
          <Panel id="canvas" className="scroll-mt-24" title="Canvas">
            <CanvasSettings
              initialStatus={canvasStatus}
              initialMappings={canvasMappings}
              localClasses={localClasses}
              storageConfigured={storageConfigured}
            />
          </Panel>
          <Panel id="connectors" className="scroll-mt-24" title="Connectors">
            <ConnectorSettings initialTokens={mcpTokens} />
          </Panel>
        </div>
      </div>
    </PageContainer>
  );
}
