"use client";

import { cloneElement, useEffect, useState, type ReactElement, type MouseEventHandler } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** True below the sm breakpoint (639 px and narrower). False until mounted so server and first paint agree. */
export function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return; // old/test environments: stay on the popover
    const mq = window.matchMedia("(max-width: 639px)");
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return narrow;
}

/**
 * One detail surface for every Day bar indicator (HOME-02 / DAYBAR-02): a popover anchored to the
 * indicator on wider screens, a bottom sheet on a phone (a popover under a thumb is cramped and
 * clipped at 390 px). `trigger` is the indicator's own button; `title`/`subtitle` head the surface and
 * `children` is the body (time, place, notes, link, prayer status...).
 */
export function IndicatorPopover({
  trigger,
  title,
  subtitle,
  children,
}: {
  trigger: ReactElement<{ onClick?: MouseEventHandler }>;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const narrow = useIsNarrow();
  const [sheetOpen, setSheetOpen] = useState(false);

  if (narrow) {
    return (
      <>
        {cloneElement(trigger, { onClick: () => setSheetOpen(true) })}
        <Dialog open={sheetOpen} onOpenChange={setSheetOpen}>
          <DialogContent
            data-testid="indicator-sheet"
            className="top-auto bottom-0 left-0 max-w-none translate-x-0 translate-y-0 rounded-b-none rounded-t-2xl pb-8 sm:max-w-none"
          >
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{subtitle ?? "Details"}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2 text-sm">{children}</div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="center" className="w-72" data-testid="indicator-popover">
        <p className="text-sm font-medium">{title}</p>
        {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
        <div className="flex flex-col gap-1.5 text-sm">{children}</div>
      </PopoverContent>
    </Popover>
  );
}
