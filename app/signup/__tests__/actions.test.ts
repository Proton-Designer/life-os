import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signUpMock = vi.fn();
const redirectMock = vi.fn(() => {
  throw new Error("NEXT_REDIRECT");
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { signUp: signUpMock },
  })),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

describe("signUp", () => {
  beforeEach(() => {
    signUpMock.mockReset();
    redirectMock.mockClear();
  });

  afterEach(() => {
    vi.resetModules();
  });

  function buildFormData(overrides: Partial<Record<"email" | "password" | "confirmPassword", string>> = {}) {
    const formData = new FormData();
    formData.set("email", overrides.email ?? "new-user@example.com");
    formData.set("password", overrides.password ?? "correct-password");
    formData.set("confirmPassword", overrides.confirmPassword ?? "correct-password");
    return formData;
  }

  it("returns an error without calling Supabase when passwords don't match", async () => {
    const { signUp } = await import("../actions");

    const result = await signUp(buildFormData({ confirmPassword: "different-password" }));

    expect(result).toEqual({ error: "Passwords do not match" });
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("returns an error message when Supabase rejects the sign-up", async () => {
    signUpMock.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "User already registered" },
    });
    const { signUp } = await import("../actions");

    const result = await signUp(buildFormData());

    expect(result).toEqual({ error: "User already registered" });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("redirects to / when sign-up returns an active session (email confirmation off)", async () => {
    signUpMock.mockResolvedValue({
      data: { user: { id: "new-user-id" }, session: { access_token: "token" } },
      error: null,
    });
    const { signUp } = await import("../actions");

    await expect(signUp(buildFormData())).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/");
  });

  it("returns a confirm-your-email message when sign-up succeeds without a session (email confirmation on)", async () => {
    signUpMock.mockResolvedValue({
      data: { user: { id: "new-user-id" }, session: null },
      error: null,
    });
    const { signUp } = await import("../actions");

    const result = await signUp(buildFormData());

    expect(result).toEqual({
      message: "Check your email to confirm your account, then sign in.",
    });
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
