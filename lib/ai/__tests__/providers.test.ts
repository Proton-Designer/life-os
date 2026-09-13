import { describe, expect, it } from "vitest";
import { PROVIDERS, PROVIDER_IDS, isProviderId, validateKeyShape } from "../providers";

describe("provider registry", () => {
  it("every provider tells the user what it unlocks and where to get a key", () => {
    // A key field a user can't act on is a dead end. If either of these is ever
    // empty the Settings card renders an ask with no reason and no next step.
    for (const id of PROVIDER_IDS) {
      expect(PROVIDERS[id].unlocks.length, `${id} must say what it unlocks`).toBeGreaterThan(10);
      expect(PROVIDERS[id].consoleUrl).toMatch(/^https:\/\//);
    }
  });

  it("defaultModel is a REAL, current model id (not a retired alias), and it's flash, not pro (Boss ruling: nobody pays pro rates to learn their key works)", () => {
    // Regression for the 2026-09-13 finding: "deepseek-v4-flash" was never
    // one of the two models `GET /models` actually lists (`deepseek-flash`,
    // `deepseek-v4-pro`) -- it worked only because DeepSeek accepts it as a
    // legacy alias and bills it at the flash price. Pin the REAL name so a
    // future revert back to the alias fails loudly here instead of only
    // being discoverable by reading DeepSeek's own pricing page again.
    expect(PROVIDERS.deepseek.defaultModel).toBe("deepseek-flash");
    expect(PROVIDERS.deepseek.defaultModel).not.toBe("deepseek-v4-flash");
  });

  it("model tiering exposes exactly the two real models, cheap mapped to flash", () => {
    expect(PROVIDERS.deepseek.models.cheap).toBe("deepseek-flash");
    expect(PROVIDERS.deepseek.models.capable).toBe("deepseek-v4-pro");
  });

  it("is flagged as a reasoning model, so callers know thinking-mode overhead applies", () => {
    expect(PROVIDERS.deepseek.reasoningModel).toBe(true);
  });

  it("rejects unknown providers so a crafted form post can't reach storage", () => {
    expect(isProviderId("deepseek")).toBe(true);
    expect(isProviderId("anthropic")).toBe(false);
    expect(isProviderId("'; drop table user_api_keys; --")).toBe(false);
  });
});

describe("key shape validation", () => {
  it("accepts a well-formed key", () => {
    expect(validateKeyShape("deepseek", "sk-1234567890abcdefghij")).toBeNull();
  });

  it("catches the copy/paste slips people actually make", () => {
    expect(validateKeyShape("deepseek", "")).toMatch(/paste a key/i);
    expect(validateKeyShape("deepseek", "sk-short")).toMatch(/too short/i);
    expect(validateKeyShape("deepseek", "sk-1234567890 abcdefghij")).toMatch(/spaces/i);
    expect(validateKeyShape("deepseek", "1234567890abcdefghij")).toMatch(/start with/i);
  });

  it("trims surrounding whitespace rather than rejecting it", () => {
    // Copying from a provider console routinely picks up a trailing newline.
    // Rejecting a VALID key is the worse error: it leaves the user believing
    // the app is broken with no way forward.
    expect(validateKeyShape("deepseek", "  sk-1234567890abcdefghij\n")).toBeNull();
  });
});
