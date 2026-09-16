import { describe, expect, it, vi, beforeEach } from "vitest";

const requireUserMock = vi.fn();
vi.mock("@/lib/supabase/auth", () => ({
  requireUser: (...args: unknown[]) => requireUserMock(...args),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const createClassShareCoreMock = vi.fn();
const revokeClassShareCoreMock = vi.fn();
const getClassShareStatusCoreMock = vi.fn();
const getSharePreviewCoreMock = vi.fn();
vi.mock("@/lib/school/class-share-core", () => ({
  createClassShareCore: (...args: unknown[]) => createClassShareCoreMock(...args),
  revokeClassShareCore: (...args: unknown[]) => revokeClassShareCoreMock(...args),
  getClassShareStatusCore: (...args: unknown[]) => getClassShareStatusCoreMock(...args),
  getSharePreviewCore: (...args: unknown[]) => getSharePreviewCoreMock(...args),
}));

const { createClassShare, revokeClassShare, getClassShareStatus, getSharePreview } = await import("../class-share-actions");

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue({ supabase: "fake-client", userId: "user-1" });
});

describe("createClassShare Server Action", () => {
  it("resolves the caller via requireUser and passes that userId through, never a client-supplied one", async () => {
    createClassShareCoreMock.mockResolvedValue({ rawToken: "raw-token-123" });

    const result = await createClassShare("class-1");

    expect(createClassShareCoreMock).toHaveBeenCalledWith("fake-client", "user-1", "class-1");
    expect(result).toEqual({ rawToken: "raw-token-123" });
  });

  it("surfaces the core's refusal message as {error}, never a thrown exception the caller has to catch", async () => {
    createClassShareCoreMock.mockRejectedValue(new Error("This class is already shared. Revoke the existing link before creating a new one."));

    const result = await createClassShare("class-1");

    expect(result).toEqual({ error: "This class is already shared. Revoke the existing link before creating a new one." });
  });
});

describe("revokeClassShare / getClassShareStatus / getSharePreview", () => {
  it("revokeClassShare passes the authenticated userId through", async () => {
    await revokeClassShare("class-1");
    expect(revokeClassShareCoreMock).toHaveBeenCalledWith("fake-client", "user-1", "class-1");
  });

  it("getClassShareStatus returns the core's status shape, never a token field", async () => {
    getClassShareStatusCoreMock.mockResolvedValue({ active: true, createdAt: "2026-09-15T00:00:00Z" });
    const status = await getClassShareStatus("class-1");
    expect(status).toEqual({ active: true, createdAt: "2026-09-15T00:00:00Z" });
  });

  it("getSharePreview passes the authenticated userId through and returns the core's payload unmodified", async () => {
    getSharePreviewCoreMock.mockResolvedValue({ className: "Orgo II", questions: [] });
    const preview = await getSharePreview("class-1");
    expect(getSharePreviewCoreMock).toHaveBeenCalledWith("fake-client", "user-1", "class-1");
    expect(preview).toEqual({ className: "Orgo II", questions: [] });
  });
});
