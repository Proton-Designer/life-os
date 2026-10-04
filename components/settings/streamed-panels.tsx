import { Suspense } from "react";
import { InlineErrorBoundary } from "@/components/shell/inline-error-boundary";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { AiPreferenceSettings, type AiProviderCatalogInfo } from "@/components/settings/ai-preference-settings";
import { AiSpendCeilingSettings } from "@/components/settings/ai-spend-ceiling-settings";
import { ApiKeySettings } from "@/components/settings/api-key-settings";
import { CanvasSettings } from "@/components/settings/canvas-settings";
import { RescueTimeSettings } from "@/components/settings/rescuetime-settings";
import { WhoopSettings } from "@/components/settings/whoop-settings";
import { ConnectorSettings } from "@/components/settings/connector-settings";
import { WebhookSettings } from "@/components/settings/webhook-settings";
import { getApiKeyStatuses } from "@/app/(app)/settings/api-key-actions";
import { getMyAiPreference } from "@/app/(app)/settings/ai-preference-actions";
import { getMyMonthlySpendStatus } from "@/app/(app)/settings/ai-spend-actions";
import { getCanvasConnectionStatus, getCanvasCourseMappings, getLocalClassOptions } from "@/app/(app)/settings/canvas-actions";
import { getRescueTimeConnectionStatus } from "@/app/(app)/settings/rescuetime-actions";
import { getWhoopSettingsStatus } from "@/app/(app)/settings/whoop-actions";
import { getMcpTokenStatuses, getScheduledActions } from "@/app/(app)/settings/mcp-token-actions";
import { getWebhookStatuses } from "@/app/(app)/settings/webhook-actions";
import { MODEL_CATALOG } from "@/lib/ai/model-catalog";
import { PROVIDERS, PROVIDER_IDS } from "@/lib/ai/providers";
import { isKeyStorageConfigured } from "@/lib/ai/encryption";

// NAV-01b: the integration panels each read their own data (the page used to await ~12 reads one
// after another before painting anything). Each is an async Server Component inside its own
// <Suspense>; the fallback is a card-shaped skeleton, and all of them fetch concurrently. The section id
// lives on a WRAPPER div OUTSIDE the Suspense, so the #anchor exists from the first byte AND stays unique
// (streamed HTML briefly holds both the fallback and the hidden resolved content; an id on each would be
// duplicated -- the e2e `#ai` strict-mode failure).

function PanelFallback({ title, height = "h-28" }: { title: string; height?: string }) {
  return (
    <Panel title={title}>
      <Skeleton className={`w-full rounded-lg ${height}`} />
    </Panel>
  );
}

async function AiPanel() {
  const [keyStatuses, aiPreference, monthlySpendStatus] = await Promise.all([getApiKeyStatuses(), getMyAiPreference(), getMyMonthlySpendStatus()]);
  const storageConfigured = isKeyStorageConfigured();
  // Plain serializable values only across the RSC boundary (the provider registry is const-asserted).
  const providers = PROVIDER_IDS.map((id) => ({ id, label: PROVIDERS[id].label, consoleUrl: PROVIDERS[id].consoleUrl, unlocks: PROVIDERS[id].unlocks }));
  // `hasKey` only reflects a STORED key, never the operator-funded fallback (see the original note in page history).
  const hasStoredKey = new Set(keyStatuses.map((s) => s.provider));
  const catalog: AiProviderCatalogInfo[] = PROVIDER_IDS.map((id) => {
    const entry = MODEL_CATALOG[id];
    return {
      id,
      label: PROVIDERS[id].label,
      hasKey: hasStoredKey.has(id),
      cheap: { id: entry.budget.id, inputUsdPer1M: entry.budget.inputUsdPer1M, outputUsdPer1M: entry.budget.outputUsdPer1M },
      capable: { id: entry.flagship.id, inputUsdPer1M: entry.flagship.inputUsdPer1M, outputUsdPer1M: entry.flagship.outputUsdPer1M },
    };
  });
  return (
    <Panel title="AI features (optional)">
      <div className="flex flex-col gap-4">
        <AiPreferenceSettings catalog={catalog} initialProvider={aiPreference.provider} initialModelTier={aiPreference.modelTier} />
        <AiSpendCeilingSettings initialSpentUsd={monthlySpendStatus.spentUsd} initialCapUsd={monthlySpendStatus.capUsd} monthKey={monthlySpendStatus.monthKey} />
        <ApiKeySettings providers={providers} initialStatuses={keyStatuses} storageConfigured={storageConfigured} />
      </div>
    </Panel>
  );
}

async function CanvasPanel() {
  const [status, mappings, localClasses] = await Promise.all([getCanvasConnectionStatus(), getCanvasCourseMappings(), getLocalClassOptions()]);
  return (
    <Panel title="Canvas">
      <CanvasSettings initialStatus={status} initialMappings={mappings} localClasses={localClasses} storageConfigured={isKeyStorageConfigured()} />
    </Panel>
  );
}

async function RescueTimePanel() {
  const status = await getRescueTimeConnectionStatus();
  return (
    <Panel title="RescueTime">
      <RescueTimeSettings initialStatus={status} storageConfigured={isKeyStorageConfigured()} />
    </Panel>
  );
}

async function WhoopPanel() {
  const status = await getWhoopSettingsStatus();
  return (
    <Panel title="Whoop">
      <WhoopSettings initialStatus={status} />
    </Panel>
  );
}

async function ConnectorsPanel() {
  const [tokens, scheduledActions] = await Promise.all([getMcpTokenStatuses(), getScheduledActions()]);
  return (
    <Panel title="Connectors">
      <ConnectorSettings initialTokens={tokens} initialScheduledActions={scheduledActions} />
    </Panel>
  );
}

async function WebhooksPanel() {
  const webhooks = await getWebhookStatuses();
  return (
    <Panel title="Webhooks">
      <WebhookSettings initialWebhooks={webhooks} />
    </Panel>
  );
}

/** The seven integration panels, in the Settings section order (AI, Canvas, RescueTime, Whoop, Connectors, Webhooks). */
export function StreamedIntegrationPanels() {
  return (
    <>
      <div id="ai" className="scroll-mt-24">
        <InlineErrorBoundary label="AI features">
          <Suspense fallback={<PanelFallback title="AI features (optional)" height="h-48" />}>
            <AiPanel />
          </Suspense>
        </InlineErrorBoundary>
      </div>
      <div id="canvas" className="scroll-mt-24">
        <InlineErrorBoundary label="Canvas">
          <Suspense fallback={<PanelFallback title="Canvas" height="h-32" />}>
            <CanvasPanel />
          </Suspense>
        </InlineErrorBoundary>
      </div>
      <div id="rescuetime" className="scroll-mt-24">
        <InlineErrorBoundary label="RescueTime">
          <Suspense fallback={<PanelFallback title="RescueTime" />}>
            <RescueTimePanel />
          </Suspense>
        </InlineErrorBoundary>
      </div>
      <div id="whoop" className="scroll-mt-24">
        <InlineErrorBoundary label="Whoop">
          <Suspense fallback={<PanelFallback title="Whoop" />}>
            <WhoopPanel />
          </Suspense>
        </InlineErrorBoundary>
      </div>
      <div id="connectors" className="scroll-mt-24">
        <InlineErrorBoundary label="Connectors">
          <Suspense fallback={<PanelFallback title="Connectors" height="h-32" />}>
            <ConnectorsPanel />
          </Suspense>
        </InlineErrorBoundary>
      </div>
      <div id="webhooks" className="scroll-mt-24">
        <InlineErrorBoundary label="Webhooks">
          <Suspense fallback={<PanelFallback title="Webhooks" />}>
            <WebhooksPanel />
          </Suspense>
        </InlineErrorBoundary>
      </div>
    </>
  );
}
