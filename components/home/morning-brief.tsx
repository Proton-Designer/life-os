"use client";

import { createContext, useContext, useState } from "react";
import { Minus, Sunrise } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { useOptimisticItem } from "@/lib/client/use-optimistic-item";
import { setMorningBriefCollapsed } from "@/app/(app)/morning-brief-actions";
import { briefNeedsClamp, briefParagraphs } from "@/lib/morning-brief/brief-source";

type BriefState = { hasBrief: boolean; collapsed: boolean; error: string | null; setCollapsed: (next: boolean) => void };
const BriefContext = createContext<BriefState>({ hasBrief: false, collapsed: false, error: null, setCollapsed: () => {} });

/**
 * Shares the morning brief's collapsed state between the brief panel (its minimize button) and the Home
 * header (the small button that brings it back), which sit in different parts of the page (HOME-01b).
 * Optimistic and ABSOLUTE: the panel folds / unfolds at once, the write is `setMorningBriefCollapsed(briefDate,
 * collapsed)` on one queue per brief date, a failure reverts and shows the reason. `initialCollapsed` is
 * true only when the user minimized THIS brief date, so a new day's brief opens expanded.
 */
export function MorningBriefProvider({
  briefDate,
  hasBrief,
  initialCollapsed,
  children,
}: {
  briefDate: string;
  hasBrief: boolean;
  initialCollapsed: boolean;
  children: React.ReactNode;
}) {
  const item = useOptimisticItem<boolean>({
    serverValue: initialCollapsed,
    queueKey: `morning-brief:${briefDate}`,
    write: async (next) => {
      const res = await setMorningBriefCollapsed(briefDate, next);
      if (!res.ok) throw new Error(res.message);
    },
  });
  return (
    <BriefContext.Provider value={{ hasBrief, collapsed: item.value, error: item.error, setCollapsed: (next) => void item.set(next) }}>
      {children}
    </BriefContext.Provider>
  );
}

/** The brief panel: shown while expanded, with a minimize button top-right; renders nothing while folded. */
export function MorningBriefPanel({ text, sourceLabel }: { text: string; sourceLabel?: string | null }) {
  const { collapsed, error, setCollapsed } = useContext(BriefContext);
  const [expanded, setExpanded] = useState(false);
  if (collapsed) return null;
  const clampable = briefNeedsClamp(text);
  const clamped = clampable && !expanded;
  return (
    <Panel
      title="Your morning brief"
      data-testid="morning-brief"
      controls={
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Minimize morning brief" data-testid="brief-minimize" onClick={() => setCollapsed(true)}>
          <Minus className="size-4" aria-hidden />
        </Button>
      }
    >
      {/* Plain text only: React escapes it, and nothing here uses dangerouslySetInnerHTML (an agent wrote this text). */}
      <div data-testid="brief-body" data-clamped={clamped ? "true" : "false"} className={clamped ? "max-h-40 space-y-2 overflow-hidden text-sm text-muted-foreground" : "space-y-2 text-sm text-muted-foreground"}>
        {briefParagraphs(text).map((paragraph, i) => (
          <p key={i} data-brief-paragraph className="whitespace-pre-line">
            {paragraph}
          </p>
        ))}
      </div>
      {clampable ? (
        <Button type="button" variant="ghost" size="sm" className="mt-1 -ml-2 h-7 px-2 text-xs" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Show less" : "Show more"}
        </Button>
      ) : null}
      {sourceLabel ? (
        <p data-testid="brief-source" className="mt-2 text-xs text-muted-foreground/80">
          {sourceLabel}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </Panel>
  );
}

/** The header button (immediately left of the widget/edit button): only while today's brief exists AND is folded. */
export function MorningBriefToggle() {
  const { hasBrief, collapsed, error, setCollapsed } = useContext(BriefContext);
  if (!hasBrief || !collapsed) return null;
  return (
    <>
      <Button type="button" variant="ghost" size="icon" aria-label="Show morning brief" data-testid="brief-expand" onClick={() => setCollapsed(false)}>
        <Sunrise className="size-4" aria-hidden />
      </Button>
      {error ? (
        <span role="alert" title={error} className="max-w-40 truncate text-xs text-destructive" data-testid="brief-expand-error">
          Couldn&apos;t show the brief
        </span>
      ) : null}
    </>
  );
}
