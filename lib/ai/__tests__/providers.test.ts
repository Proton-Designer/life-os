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
