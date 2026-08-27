const KEY_PREFIX = "lockin-minimized:";

/**
 * Whether the full-screen Lock-In overlay was minimized for this session,
 * per (browser, session id). `null` means "nothing stored yet" — distinct
 * from `false` — so a fresh page load with an active session and no stored
 * value can default to minimized rather than ambushing the user with a
 * full-screen takeover on every navigation.
 */
export function readLockInMinimized(sessionId: string): boolean | null {
  try {
    const raw = localStorage.getItem(`${KEY_PREFIX}${sessionId}`);
    if (raw === null) return null;
    return raw === "1";
  } catch {
    return null;
  }
}

export function writeLockInMinimized(sessionId: string, minimized: boolean): void {
  try {
    localStorage.setItem(`${KEY_PREFIX}${sessionId}`, minimized ? "1" : "0");
  } catch {
    // Private window / storage disabled — the overlay just won't persist
    // its minimized state across navigations.
  }
}
