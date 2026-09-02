import { describe, it, expect, afterEach, vi } from "vitest";
import { getDevProviderBaseUrl, isDevProviderAvailable } from "../dev-provider";

/**
 * R22 guard #1: "the registry entry is absent in production, not merely
 * unreachable... A test asserting the entry is absent under
 * NODE_ENV=production — per tonight's rule, a distinction with no test is a
 * comment." This is that test. It asserts ABSENCE (null), never "present but
 * you'd better not call it" — the two are indistinguishable to a caller that
 * forgets to check, and only one of them is actually safe.
 */
describe("getDevProviderBaseUrl — structural absence in production", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns null under NODE_ENV=production, even with the opt-in env var set", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SELF_MASTERY_DEV_PROVIDER_URL", "http://localhost:4570");
    expect(getDevProviderBaseUrl()).toBeNull();
    expect(isDevProviderAvailable()).toBe(false);
  });

  it("returns null outside production when the opt-in env var is unset", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SELF_MASTERY_DEV_PROVIDER_URL", "");
    expect(getDevProviderBaseUrl()).toBeNull();
  });

  it("returns null outside production when the opt-in env var is entirely absent", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.unstubAllEnvs();
    vi.stubEnv("NODE_ENV", "development");
    // deliberately not stubbing SELF_MASTERY_DEV_PROVIDER_URL at all
    expect(getDevProviderBaseUrl()).toBeNull();
  });

  it("returns the URL only when BOTH conditions hold: not production, and the env var is set", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SELF_MASTERY_DEV_PROVIDER_URL", "http://localhost:4570");
    expect(getDevProviderBaseUrl()).toBe("http://localhost:4570");
    expect(isDevProviderAvailable()).toBe(true);
  });

  it("test environment (NODE_ENV=test) counts as 'not production' -- absence is specifically about production, not about every non-dev environment", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("SELF_MASTERY_DEV_PROVIDER_URL", "http://localhost:4570");
    expect(getDevProviderBaseUrl()).toBe("http://localhost:4570");
  });
});
