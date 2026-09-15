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

describe("signIn", () => {
  beforeEach(() => {
    signInWithPasswordMock.mockReset();
    redirectMock.mockClear();
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
});
