import { describe, it, expect, vi, beforeEach } from "vitest";

// Distinguishable marker so we can assert redirect() was called with a
// specific destination without relying on Next's real throw-to-abort
// machinery (which isn't wired up in a plain vitest/jsdom environment).
class RedirectSignal extends Error {
  constructor(public destination: string) {
    super(`REDIRECT:${destination}`);
  }
}
const redirectMock = vi.fn((destination: string) => {
  throw new RedirectSignal(destination);
});
vi.mock("next/navigation", () => ({ redirect: (d: string) => redirectMock(d) }));

let pathname = "/";
vi.mock("next/headers", () => ({
  headers: async () => ({ get: (key: string) => (key === "x-pathname" ? pathname : null) }),
}));

const getAuthedUserMock = vi.fn();
const getProfileMock = vi.fn();
vi.mock("@/lib/supabase/auth", () => ({
  getAuthedUser: () => getAuthedUserMock(),
  getProfile: () => getProfileMock(),
}));

vi.mock("@/lib/business/active-session", () => ({
  getActiveWorkSession: vi.fn(async () => null),
}));

vi.mock("@/components/shell/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/app/(app)/actions", () => ({ saveWeeklyGoal: vi.fn() }));
vi.mock("@/app/(app)/calendar/actions", () => ({ getWeekCalendar: vi.fn() }));

const AUTHED_USER = { id: "user-1", email: "ayman@example.com" };

async function renderShell() {
  const { AuthedShell } = await import("../layout");
  return AuthedShell({ children: "children-marker" as unknown as React.ReactNode });
}

describe("AuthedShell — onboarding gate (app/(app)/layout.tsx)", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    getAuthedUserMock.mockReset();
    getProfileMock.mockReset();
    pathname = "/";
  });

  // The specific regression the Lead found live 2026-09-01: visiting
  // /onboarding after already finishing it silently rewrote an existing
  // account's user_domains/user_subdomains. This is the invariant that
  // must never regress.
  it("redirects an already-onboarded account away from /onboarding, back to /", async () => {
    pathname = "/onboarding";
    getAuthedUserMock.mockResolvedValue(AUTHED_USER);
    getProfileMock.mockResolvedValue({ onboarding_completed: true });

    await expect(renderShell()).rejects.toThrow(RedirectSignal);
    expect(redirectMock).toHaveBeenCalledWith("/");
  });

  it("lets an onboarding-incomplete account render /onboarding without redirecting", async () => {
    pathname = "/onboarding";
    getAuthedUserMock.mockResolvedValue(AUTHED_USER);
    getProfileMock.mockResolvedValue({ onboarding_completed: false });

    const result = await renderShell();
    expect(redirectMock).not.toHaveBeenCalled();
    expect((result as React.ReactElement<{ children: unknown }>).props.children).toBe("children-marker");
  });

  it("lets a brand-new account (no profile row yet) render /onboarding without redirecting", async () => {
    pathname = "/onboarding";
    getAuthedUserMock.mockResolvedValue(AUTHED_USER);
    getProfileMock.mockResolvedValue(null);

    const result = await renderShell();
    expect(redirectMock).not.toHaveBeenCalled();
    expect((result as React.ReactElement<{ children: unknown }>).props.children).toBe("children-marker");
  });

  it("redirects an onboarding-incomplete account away from any other route, to /onboarding", async () => {
    pathname = "/business";
    getAuthedUserMock.mockResolvedValue(AUTHED_USER);
    getProfileMock.mockResolvedValue({ onboarding_completed: false });

    await expect(renderShell()).rejects.toThrow(RedirectSignal);
    expect(redirectMock).toHaveBeenCalledWith("/onboarding");
  });

  it("redirects an unauthenticated visitor to /login before any profile check", async () => {
    pathname = "/onboarding";
    getAuthedUserMock.mockResolvedValue(null);

    await expect(renderShell()).rejects.toThrow(RedirectSignal);
    expect(redirectMock).toHaveBeenCalledWith("/login");
    expect(getProfileMock).not.toHaveBeenCalled();
  });
});
