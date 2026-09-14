import { describe, expect, it, vi, beforeEach } from "vitest";

const requireUserMock = vi.fn();
vi.mock("@/lib/supabase/auth", () => ({
  requireUser: (...args: unknown[]) => requireUserMock(...args),
}));

const deleteUserMock = vi.fn();
const createServiceRoleClientMock = vi.fn((..._args: unknown[]) => ({ auth: { admin: { deleteUser: deleteUserMock } } }));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

const signOutMock = vi.fn(async () => {});
const createClientMock = vi.fn(async (..._args: unknown[]) => ({ auth: { signOut: signOutMock } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

import { deleteMyAccount } from "../account-actions";

describe("deleteMyAccount", () => {
  beforeEach(() => {
    requireUserMock.mockReset().mockResolvedValue({ supabase: {}, userId: "user-1" });
    deleteUserMock.mockReset().mockResolvedValue({ error: null });
    signOutMock.mockReset().mockResolvedValue(undefined);
    createServiceRoleClientMock.mockClear();
    createClientMock.mockClear();
  });

  // #32: this is the entire confirmation flow's server-side teeth — a
  // mismatched (or empty) confirmation string must never reach the admin
  // delete call. Checked BEFORE requireUser/the service-role client are
  // even touched, so a wrong confirmation can't accidentally still resolve
  // the caller's identity or spin up an admin-privileged client.
  it("refuses to delete when the confirmation text doesn't match, without ever calling the admin API", async () => {
    const result = await deleteMyAccount("delete");
    expect(result).toEqual({ ok: false, error: expect.stringContaining("DELETE") });
    expect(requireUserMock).not.toHaveBeenCalled();
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it("refuses an empty confirmation", async () => {
    const result = await deleteMyAccount("");
    expect(result.ok).toBe(false);
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it("deletes the auth.users row for the CALLER's own id via the admin client, and signs out the cookie session", async () => {
    const result = await deleteMyAccount("DELETE");
    expect(result).toEqual({ ok: true });
    expect(deleteUserMock).toHaveBeenCalledWith("user-1");
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces the admin API's own error rather than reporting success, and never calls signOut in that case", async () => {
    deleteUserMock.mockResolvedValue({ error: { message: "user not found" } });
    const result = await deleteMyAccount("DELETE");
    expect(result).toEqual({ ok: false, error: "user not found" });
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it("still reports success if the best-effort cookie signOut itself throws — the account is already gone", async () => {
    signOutMock.mockRejectedValue(new Error("cookie store unavailable"));
    const result = await deleteMyAccount("DELETE");
    expect(result).toEqual({ ok: true });
  });
});
