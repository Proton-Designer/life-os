import type { LayoutItem } from "@/app/(app)/page-layout-actions";

/**
 * WIDGET-02 -- the per-page wiring half of the per-domain widget manager
 * (lib/page-layout/registry.ts + actions-core.ts, WIDGET-01, own the
 * registry/persistence; this is the render-side consumer). A plain,
 * server-compatible module -- no hooks, no "use client" -- since hiding/
 * reordering a widget needs no interactivity of its own; only the manager
 * DIALOG (widget-manager-dialog.tsx) does.
 *
 * ORDER VIA CSS `order`, NOT JSX REORDERING: every page that adopts this
 * wraps its widget stack in a `flex flex-col` (or a CSS grid, which honors
 * `order` identically) container and gives each `<LayoutSlot>` the
 * position `getPageLayout` already resolved (registry default when the
 * user never customized it). This keeps each page's own JSX in a stable,
 * readable source order while still letting layout differ per user --
 * the alternative (actually sorting an array of ReactNodes before
 * render) would force every page into a from-scratch dynamic-widget-map
 * rewrite instead of a wrap-in-place change.
 */
export type LayoutMap = ReadonlyMap<string, LayoutItem>;

export function buildLayoutMap(layout: readonly LayoutItem[]): LayoutMap {
  return new Map(layout.map((item) => [item.widgetKey, item]));
}

/** True only when this domain has at least one registered widget AND every one of them is hidden -- an unregistered/empty domain is not "all hidden," it simply has nothing to say either way. */
export function allWidgetsHidden(layout: readonly LayoutItem[]): boolean {
  return layout.length > 0 && layout.every((item) => item.hidden);
}

export function LayoutSlot({
  layout,
  widgetKey,
  children,
}: {
  layout: LayoutMap;
  widgetKey: string;
  children: React.ReactNode;
}) {
  const item = layout.get(widgetKey);
  // A widgetKey with no entry (a registry addition the user has never
  // saved a layout for) is not reachable in practice -- getPageLayout
  // always returns every registered widget with registry defaults filled
  // in -- but rendering it visible, unordered, rather than silently
  // dropping it is the honest failure mode if that ever changes.
  if (item?.hidden) return null;
  return <div style={{ order: item?.position ?? 0 }}>{children}</div>;
}
