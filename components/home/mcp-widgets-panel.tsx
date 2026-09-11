import { Panel } from "@/components/ui/panel";
import { McpWidgetRemoveButton } from "./mcp-widget-remove-button";
import { removeWidget } from "@/app/(app)/widgets/actions";
import type { RenderedWidget, SparklinePoint } from "@/lib/widgets/render";

const SPARKLINE_VIEWBOX_WIDTH = 100;
const SPARKLINE_VIEWBOX_HEIGHT = 28;

/** A minimal hand-rolled polyline -- no charting dependency for a single trend line, consistent with "a fixed, human-built set of widget kinds... rendered by one audited renderer." Flat data (all-zero, or a single point) degrades to a flat/empty line, never a crash. */
function sparklinePoints(points: SparklinePoint[]): string {
  const values = points.map((p) => p.value);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const stepX = points.length > 1 ? SPARKLINE_VIEWBOX_WIDTH / (points.length - 1) : 0;
  return points.map((p, i) => `${(i * stepX).toFixed(2)},${(SPARKLINE_VIEWBOX_HEIGHT - ((p.value - min) / range) * SPARKLINE_VIEWBOX_HEIGHT).toFixed(2)}`).join(" ");
}

/**
 * L11/R7 Tier 1 — the one audited renderer for declarative widgets
 * (lib/widgets/render.ts produces `RenderedWidget[]`; this component only
 * ever displays what that function already computed, never a second
 * hand-rolled query). Placement: Home's own vertical `Panel` stack, the
 * one spot with an established, already-reviewed pattern and room to grow
 * — the topbar icon row and mobile-island primary-item row are BOTH
 * documented at capacity, calculated to a 320px floor, and have broken
 * live before when they grew (components/shell/topbar.tsx,
 * components/shell/mobile-island.tsx). A vertical block added after Home's
 * existing panels cannot overflow either of those horizontal rows — it
 * doesn't touch them at all.
 *
 * Renders nothing when there are no widgets, same posture as the rest of
 * Home's optional modules (no empty-state clutter for a feature the
 * account owner never asked their AI to use).
 */
export function McpWidgetsPanel({ widgets }: { widgets: RenderedWidget[] }) {
  if (widgets.length === 0) return null;

  return (
    <Panel title="Widgets">
      <div className="flex flex-col gap-2">
        {widgets.map((widget) => (
          <div key={widget.id} className="flex min-w-0 items-start justify-between gap-2 rounded-xl border border-border/40 p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-muted-foreground">{widget.title}</p>
              {"error" in widget ? (
                <p className="truncate text-sm text-destructive">{widget.error}</p>
              ) : widget.kind === "metric_card" ? (
                <p className="font-mono text-xl font-semibold tabular-nums">{widget.value}</p>
              ) : widget.kind === "progress_against_goal" ? (
                <div className="mt-1 flex flex-col gap-1">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${widget.percent}%` }} />
                  </div>
                  <p className="font-mono text-xs tabular-nums text-muted-foreground">
                    {widget.current}
                    {widget.hasMore && "+"} / {widget.goal} ({widget.percent}%{widget.hasMore && "+"})
                  </p>
                </div>
              ) : widget.kind === "sparkline" ? (
                <div className="mt-1 flex flex-col gap-1">
                  <svg viewBox={`0 0 ${SPARKLINE_VIEWBOX_WIDTH} ${SPARKLINE_VIEWBOX_HEIGHT}`} className="h-7 w-full text-primary" preserveAspectRatio="none" aria-hidden>
                    <polyline points={sparklinePoints(widget.points)} fill="none" stroke="currentColor" strokeWidth={1.5} />
                  </svg>
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {widget.points.at(-1)?.value ?? 0} today{widget.hasMore && " · earlier days may be a floor"}
                  </p>
                </div>
              ) : (
                <div className="mt-1 flex flex-col gap-1">
                  {widget.items.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nothing here yet.</p>
                  ) : (
                    widget.items.map((item, i) => (
                      <div key={i} className="min-w-0">
                        <p className="truncate text-sm">{item.title}</p>
                        {item.subtitle && <p className="truncate text-xs text-muted-foreground">{item.subtitle}</p>}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
            <McpWidgetRemoveButton onRemove={removeWidget.bind(null, widget.id)} />
          </div>
        ))}
      </div>
    </Panel>
  );
}
