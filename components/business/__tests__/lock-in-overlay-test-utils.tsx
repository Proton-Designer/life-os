import { render } from "@testing-library/react";
import { LockInOverlayProvider, type ActiveWorkSession } from "../lock-in-overlay-context";

/** Every consumer of useLockInOverlay (LockInPanel, FocusModule,
 * LockInOverlay) needs a provider ancestor — the hook throws without one. */
export function renderWithLockIn(ui: React.ReactElement, initialSession: ActiveWorkSession | null = null) {
  return render(<LockInOverlayProvider initialSession={initialSession}>{ui}</LockInOverlayProvider>);
}
