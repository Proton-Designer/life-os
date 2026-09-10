"use client";

import { SessionSetupDialog } from "./session-setup-dialog";
import { useLockInOverlay } from "./lock-in-overlay-context";

/**
 * Connects the presentational, fully-controlled `SessionSetupDialog`
 * (components/business/session-setup-dialog.tsx — deliberately kept
 * context-free for its own unit tests) to `LockInOverlayProvider`'s state.
 * A separate file rather than folding this into either side: AppShellChrome
 * (which mounts this, next to LockInOverlay) has no "use client" of its own
 * — it composes Server-safe JSX and lets its children opt into client
 * behavior individually, same reason LockInOverlay is its own file rather
 * than inlined there.
 *
 * `kind={pendingKind ?? "deep_work"}` when nothing is pending is never
 * actually seen — `open` is false in that state, matching TaskWizardDialog's
 * own "Dialog always mounted, `open` toggled" convention rather than
 * conditionally mounting/unmounting the dialog around `pendingKind`.
 */
export function SessionSetupDialogHost() {
  const { setupOpen, pendingKind, setSetupOpen, confirmSessionStart } = useLockInOverlay();
  return (
    <SessionSetupDialog open={setupOpen} onOpenChange={setSetupOpen} kind={pendingKind ?? "deep_work"} onStart={confirmSessionStart} />
  );
}
