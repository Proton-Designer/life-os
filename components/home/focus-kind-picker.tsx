"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { KIND_LABEL } from "@/lib/business/work-session-kind";
import { useLockInOverlay } from "@/components/business/lock-in-overlay-context";

/**
 * "Start focusing -- choose what kind of session." Deep Work or Deep Study, then the usual setup dialog opens
 * (the overlay context's startSession). One popup shared by the Day bar's Focus button and the Focus panel's
 * Lock In button, so the two can never drift apart.
 */
export function FocusKindPicker({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { startSession } = useLockInOverlay();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" data-testid="day-bar-focus-picker">
        <DialogHeader>
          <DialogTitle>Start focusing</DialogTitle>
          <DialogDescription>Choose what kind of session.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {(["deep_work", "deep_study"] as const).map((kind) => (
            <Button
              key={kind}
              type="button"
              variant="outline"
              className="h-14"
              onClick={() => {
                onOpenChange(false);
                startSession(kind);
              }}
            >
              {KIND_LABEL[kind]}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
