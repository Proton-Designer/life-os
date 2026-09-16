"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CaptureForm } from "./capture-form";

/**
 * Global capture (BOSS-VISION §5): one tap, from any screen — type or dictate, parse,
 * confirm-before-persist. The actual form (classify/parse/dictation/confirm) lives in
 * `CaptureForm` (P3-17 extraction, shared with the dedicated `/capture` route) — this
 * component owns only the floating trigger and the Dialog framing around it.
 *
 * `{open && <CaptureForm key="open" .../>}` (not an unconditional render) guarantees a
 * fresh CaptureForm instance — and therefore a reset draft — every time the sheet opens,
 * independent of whatever mount/unmount timing Radix's own Dialog.Content does or doesn't
 * guarantee. This is the same behavior the pre-extraction version got from an explicit
 * `reset()` call in `handleClose`; here it falls out of the mount boundary itself.
 */
export function GlobalCaptureSheet({ timezone }: { timezone: string }) {
  const [open, setOpen] = useState(false);

  function handleClose() {
    setOpen(false);
  }

  return (
    <>
      <Button
        type="button"
        size="icon"
        aria-label="Capture"
        onClick={() => setOpen(true)}
        className="fixed bottom-24 right-4 z-40 size-12 rounded-full shadow-lg lg:bottom-6"
      >
        <Plus className="size-5" aria-hidden />
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (next) setOpen(true);
          else handleClose();
        }}
      >
        <DialogContent className="flex w-full max-w-md flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Capture</DialogTitle>
            {/* P3-17: small and secondary on purpose (Opus Lead ruling — tonight's
                product complaint is clutter, so this must never read as a second
                primary action next to Confirm). */}
            <Link href="/capture" onClick={handleClose} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
              Open full page
            </Link>
          </DialogHeader>

          {open && <CaptureForm key="open" timezone={timezone} onCaptured={handleClose} onCancel={handleClose} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
