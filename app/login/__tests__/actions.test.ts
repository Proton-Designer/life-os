import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signInWithPasswordMock = vi.fn();
const redirectMock = vi.fn(() => {
  throw new Error("NEXT_REDIRECT");
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { signInWithPassword: signInWithPasswordMock },
  })),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

describe("signIn", () => {
  beforeEach(() => {
    signInWithPasswordMock.mockReset();
    redirectMock.mockClear();
    revalidatePathMock.mockClear();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("returns an error message on failed sign-in", async () => {
    signInWithPasswordMock.mockResolvedValue({
      error: { message: "Invalid login credentials" },
    });
    const { signIn } = await import("../actions");

    const formData = new FormData();
    formData.set("email", "test@example.com");
    formData.set("password", "wrong-password");

    const result = await signIn(formData);

    expect(result).toEqual({ error: "Invalid login credentials" });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("redirects to / on successful sign-in", async () => {
    signInWithPasswordMock.mockResolvedValue({ error: null });
    const { signIn } = await import("../actions");

    const formData = new FormData();
    formData.set("email", "test@example.com");
    formData.set("password", "correct-password");

    await expect(signIn(formData)).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/");
  });

  it("P4-13: redirects to a same-origin `next` (e.g. back to the OAuth authorize screen) after sign-in", async () => {
    signInWithPasswordMock.mockResolvedValue({ error: null });
    const { signIn } = await import("../actions");
    const formData = new FormData();
    formData.set("email", "test@example.com");
    formData.set("password", "correct-password");
    formData.set("next", "/api/mcp/oauth/authorize?client_id=abc&state=xyz");
    await expect(signIn(formData)).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/api/mcp/oauth/authorize?client_id=abc&state=xyz");
  });

  it("P4-13: ignores an off-site `next` (open-redirect guard) and goes to /", async () => {
    signInWithPasswordMock.mockResolvedValue({ error: null });
    const { signIn } = await import("../actions");
    const formData = new FormData();
    formData.set("email", "test@example.com");
    formData.set("password", "correct-password");
    formData.set("next", "//evil.example.com/steal");
    await expect(signIn(formData)).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/");
  });

  // Privacy fix (Opus Lead ruling, 2026-09-18), not just staleness: on a
  // shared device, or a logout-then-login-as-a-different-user, the client
  // Router Cache can still hold the PREVIOUS session's rendered "/" --
  // serving user A's Home to user B is a privacy issue, not a "the button
  // didn't work" trust issue. This is the test that encodes that risk
  // directly: a stale entry from a previous session must be discarded on
  // this one's login, not merely "eventually refreshed."
  it("discards any previously cached page content before redirecting -- a stale entry from a PREVIOUS session must never be served to this one", async () => {
    signInWithPasswordMock.mockResolvedValue({ error: null });
    const { signIn } = await import("../actions");
    const formData = new FormData();
    formData.set("email", "test@example.com");
    formData.set("password", "correct-password");

    await expect(signIn(formData)).rejects.toThrow("NEXT_REDIRECT");

    expect(revalidatePathMock).toHaveBeenCalledWith("/", "layout");
  });

  it("does not revalidate anything on a failed sign-in -- no session was established, nothing to discard", async () => {
    signInWithPasswordMock.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    const { signIn } = await import("../actions");
    const formData = new FormData();
    formData.set("email", "test@example.com");
    formData.set("password", "wrong-password");

    await signIn(formData);

    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
