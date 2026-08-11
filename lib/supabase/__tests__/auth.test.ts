import { describe, it, expect, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();
const maybeSingleMock = vi.fn();
const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));
const fromMock = vi.fn(() => ({ select: selectMock }));

vi.mock("../server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
    from: fromMock,
  })),
}));

describe("getProfile", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    fromMock.mockClear();
    selectMock.mockClear();
    eqMock.mockClear();
    maybeSingleMock.mockReset();
    vi.resetModules();
  });

  it("returns null when there's no authenticated user, without querying profiles", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const { getProfile } = await import("../auth");

    const result = await getProfile();

    expect(result).toBeNull();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("selects the full row scoped to the authenticated user", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    maybeSingleMock.mockResolvedValue({
      data: { user_id: "user-1", timezone: "America/Chicago", onboarding_completed: true },
      error: null,
    });
    const { getProfile } = await import("../auth");

    const result = await getProfile();

    expect(fromMock).toHaveBeenCalledWith("profiles");
    expect(selectMock).toHaveBeenCalledWith("*");
    expect(eqMock).toHaveBeenCalledWith("user_id", "user-1");
    expect(result).toEqual({
      user_id: "user-1",
      timezone: "America/Chicago",
      onboarding_completed: true,
    });
  });

  it("returns null when the user has no profile row yet", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    const { getProfile } = await import("../auth");

    const result = await getProfile();

    expect(result).toBeNull();
  });
});
