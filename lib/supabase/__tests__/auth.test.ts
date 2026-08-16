import { describe, it, expect, vi, beforeEach } from "vitest";

const getClaimsMock = vi.fn();
const maybeSingleMock = vi.fn();
const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));
const fromMock = vi.fn(() => ({ select: selectMock }));

vi.mock("../server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getClaims: getClaimsMock },
    from: fromMock,
  })),
}));

describe("getProfile", () => {
  beforeEach(() => {
    getClaimsMock.mockReset();
    fromMock.mockClear();
    selectMock.mockClear();
    eqMock.mockClear();
    maybeSingleMock.mockReset();
    vi.resetModules();
  });

  it("returns null when there's no authenticated user, without querying profiles", async () => {
    getClaimsMock.mockResolvedValue({ data: null, error: null });
    const { getProfile } = await import("../auth");

    const result = await getProfile();

    expect(result).toBeNull();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("selects the full row scoped to the authenticated user", async () => {
    getClaimsMock.mockResolvedValue({ data: { claims: { sub: "user-1" } }, error: null });
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
    getClaimsMock.mockResolvedValue({ data: { claims: { sub: "user-1" } }, error: null });
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    const { getProfile } = await import("../auth");

    const result = await getProfile();

    expect(result).toBeNull();
  });
});

describe("getAuthedUser", () => {
  beforeEach(() => {
    getClaimsMock.mockReset();
    vi.resetModules();
  });

  it("returns null when getClaims errors (no/invalid session)", async () => {
    getClaimsMock.mockResolvedValue({ data: null, error: { message: "invalid JWT" } });
    const { getAuthedUser } = await import("../auth");

    expect(await getAuthedUser()).toBeNull();
  });

  it("maps verified claims to { id, email }", async () => {
    getClaimsMock.mockResolvedValue({
      data: { claims: { sub: "user-1", email: "ayman@example.com" } },
      error: null,
    });
    const { getAuthedUser } = await import("../auth");

    expect(await getAuthedUser()).toEqual({ id: "user-1", email: "ayman@example.com" });
  });
});
