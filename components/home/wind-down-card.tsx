import { Panel } from "@/components/ui/panel";
import { WindDownPlanSettings } from "@/components/settings/wind-down-plan-settings";
import type { WindDownSettings } from "@/lib/rhythm/wind-down-core";

/**
 * Home's one-time wind-down set-up (IA-P4b, opt-in "Sleep plan"): shown ONLY while no plan is set --
 * wake time + how much sleep you need -> bedtime and wind-down start, derived and never typed
 * nightly. Once set it disappears; "Lights out by HH:MM" lives on the wind-down and done cards, and
 * the plan stays editable in Settings. The form is the same component Settings renders.
 */
export function WindDownCard({ settings }: { settings: WindDownSettings }) {
  if (settings.plan) return null;
  return (
    <Panel title="Set your wind-down" data-testid="wind-down-setup">
      <WindDownPlanSettings
        initialWakeTime={settings.wakeTime}
        initialSleepNeedMinutes={settings.sleepNeedMinutes}
        initialWindDownMinutes={settings.windDownMinutes}
      />
    </Panel>
  );
}
