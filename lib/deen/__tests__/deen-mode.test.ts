import { describe, expect, it } from "vitest";
import { isDeenModeOn } from "../deen-mode";

describe("isDeenModeOn", () => {
  it("is ON only for the literal boolean true", () => {
    expect(isDeenModeOn({ deen_mode: true })).toBe(true);
  });

  it("is OFF for false", () => {
    expect(isDeenModeOn({ deen_mode: false })).toBe(false);
  });

  it("fails closed for null, undefined, a missing column and a missing profile", () => {
    expect(isDeenModeOn({ deen_mode: null })).toBe(false);
    expect(isDeenModeOn({ deen_mode: undefined })).toBe(false);
    expect(isDeenModeOn({})).toBe(false);
    expect(isDeenModeOn(null)).toBe(false);
    expect(isDeenModeOn(undefined)).toBe(false);
  });

  it("does not treat truthy non-booleans as ON", () => {
    expect(isDeenModeOn({ deen_mode: "true" } as unknown as { deen_mode: boolean })).toBe(false);
    expect(isDeenModeOn({ deen_mode: 1 } as unknown as { deen_mode: boolean })).toBe(false);
  });
});
