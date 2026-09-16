import { describe, expect, it, vi, beforeEach } from "vitest";

class NotFoundSignal extends Error {}
const notFoundMock = vi.fn(() => {
  throw new NotFoundSignal("NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound: () => notFoundMock() }));

const HEADERS_INSTANCE = new Headers();
vi.mock("next/headers", () => ({ headers: async () => HEADERS_INSTANCE }));

const createServiceRoleClientMock = vi.fn(() => "fake-service-client");
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => createServiceRoleClientMock(),
}));

const checkPublicShareViewLimitMock = vi.fn();
vi.mock("@/lib/school/public-share-rate-limit", () => ({
  checkPublicShareViewLimit: (...args: unknown[]) => checkPublicShareViewLimitMock(...args),
}));

const getPublicQuestionBankCoreMock = vi.fn();
vi.mock("@/lib/school/public-question-bank-core", () => ({
  getPublicQuestionBankCore: (...args: unknown[]) => getPublicQuestionBankCoreMock(...args),
}));

const { default: PublicQuestionBankPage } = await import("../page");

beforeEach(() => {
  vi.clearAllMocks();
  checkPublicShareViewLimitMock.mockResolvedValue({ limited: false });
  getPublicQuestionBankCoreMock.mockResolvedValue({ className: "Orgo II", questions: [] });
});

function paramsFor(token: string) {
  return Promise.resolve({ token });
}

describe("PublicQuestionBankPage — P3-08", () => {
  it("checks the rate limit BEFORE the bank lookup, using the service-role client and the request headers", async () => {
    await PublicQuestionBankPage({ params: paramsFor("tok") });
    expect(checkPublicShareViewLimitMock).toHaveBeenCalledWith("fake-service-client", HEADERS_INSTANCE);
    expect(getPublicQuestionBankCoreMock).toHaveBeenCalledWith("fake-service-client", "tok");
  });

  it("calls notFound() when rate-limited -- the IDENTICAL response as an unknown/revoked/off token, per the no-enumeration design", async () => {
    checkPublicShareViewLimitMock.mockResolvedValue({ limited: true, retryAfterSeconds: 30 });

    await expect(PublicQuestionBankPage({ params: paramsFor("tok") })).rejects.toThrow(NotFoundSignal);
    expect(getPublicQuestionBankCoreMock).not.toHaveBeenCalled(); // never even reaches the bank lookup once throttled
  });

  it("calls notFound() when the bank is null (unknown token, revoked token, or sharing off -- all indistinguishable here)", async () => {
    getPublicQuestionBankCoreMock.mockResolvedValue(null);

    await expect(PublicQuestionBankPage({ params: paramsFor("tok") })).rejects.toThrow(NotFoundSignal);
  });

  it("renders the class name and drill UI on a real, found, non-throttled bank", async () => {
    getPublicQuestionBankCoreMock.mockResolvedValue({
      className: "Orgo II",
      questions: [{ prompt: "Q1", answer: "A1", topic: null }],
    });

    const element = await PublicQuestionBankPage({ params: paramsFor("tok") });

    expect(JSON.stringify(element)).toContain("Orgo II");
  });

  it("declares noindex robots metadata", async () => {
    const { metadata } = await import("../page");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("is force-dynamic -- never cached/ISR'd, so an edit or retirement shows on the very next request", async () => {
    const { dynamic } = await import("../page");
    expect(dynamic).toBe("force-dynamic");
  });
});
