import { Fragment } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

class RedirectSignal extends Error {
  constructor(public destination: string) {
    super(`REDIRECT:${destination}`);
  }
}
const redirectMock = vi.fn((destination: string) => {
  throw new RedirectSignal(destination);
});
vi.mock("next/navigation", () => ({ redirect: (d: string) => redirectMock(d) }));

const getAuthedUserMock = vi.fn();
const getProfileMock = vi.fn();
vi.mock("@/lib/supabase/auth", () => ({
  getAuthedUser: () => getAuthedUserMock(),
  getProfile: () => getProfileMock(),
}));

const AUTHED_USER = { id: "user-1", email: "ayman@example.com" };

async function renderLayout() {
  const { default: CaptureLayout } = await import("../layout");
  return CaptureLayout({ children: "children-marker" as unknown as React.ReactNode });
}

// P3-17: this layout exists specifically because a shared-layout
// pathname branch under app/(app)/layout.tsx did NOT reliably skip
// AppShell across a client-side <Link> navigation (confirmed live) — see
// this file's own header. These tests cover the three real outcomes:
// unauthenticated, onboarding-incomplete, and the happy path.
describe("CaptureLayout (app/(capture)/layout.tsx)", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    getAuthedUserMock.mockReset();
    getProfileMock.mockReset();
  });

  it("redirects an unauthenticated visitor to /login with next=/capture preserved", async () => {
    getAuthedUserMock.mockResolvedValue(null);

    await expect(renderLayout()).rejects.toThrow(RedirectSignal);
    expect(redirectMock).toHaveBeenCalledWith("/login?next=%2Fcapture");
    expect(getProfileMock).not.toHaveBeenCalled();
  });

  it("redirects an onboarding-incomplete account to /onboarding", async () => {
    getAuthedUserMock.mockResolvedValue(AUTHED_USER);
    getProfileMock.mockResolvedValue({ onboarding_completed: false });

    await expect(renderLayout()).rejects.toThrow(RedirectSignal);
    expect(redirectMock).toHaveBeenCalledWith("/onboarding");
  });

  it("redirects a brand-new account with no profile row yet to /onboarding", async () => {
    getAuthedUserMock.mockResolvedValue(AUTHED_USER);
    getProfileMock.mockResolvedValue(null);

    await expect(renderLayout()).rejects.toThrow(RedirectSignal);
    expect(redirectMock).toHaveBeenCalledWith("/onboarding");
  });

  it("an authenticated, onboarded visit renders children directly -- no AppShell wrapper", async () => {
    getAuthedUserMock.mockResolvedValue(AUTHED_USER);
    getProfileMock.mockResolvedValue({ onboarding_completed: true });

    const result = await renderLayout();
    expect(redirectMock).not.toHaveBeenCalled();
    const element = result as React.ReactElement<{ children: unknown }>;
    expect(element.type).toBe(Fragment);
    expect(element.props.children).toBe("children-marker");
  });
});
