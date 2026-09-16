"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CaptureForm } from "./capture-form";

/**
 * P3-17: the dedicated `/capture` route's own client shell — full-width,
 * no dialog chrome, no nav. Stays on the page after a successful capture
 * (remounts CaptureForm via an incrementing `key`, the same reset-via-
 * remount approach GlobalCaptureSheet now uses) rather than navigating
 * away, since a fast-capture entry point's whole use case is logging
 * several things in a row without re-opening the app each time.
 */
export function CapturePageClient({ timezone }: { timezone: string }) {
  const router = useRouter();
  const [instance, setInstance] = useState(0);
  const [justSaved, setJustSaved] = useState(false);

  function handleCaptured() {
    setJustSaved(true);
    setInstance((n) => n + 1);
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-8">
      <div>
        <h1 className="text-lg font-semibold">Capture</h1>
        <p className="text-sm text-muted-foreground">Fast entry — nothing else has to load first.</p>
      </div>
      {justSaved && (
        <p role="status" className="text-sm text-muted-foreground">
          Saved. Capture another, or close.
        </p>
      )}
      <CaptureForm
        key={instance}
        timezone={timezone}
        onCaptured={handleCaptured}
        onCancel={() => router.push("/")}
        cancelLabel="Close"
        confirmLabel="Save"
      />
    </div>
  );
}
