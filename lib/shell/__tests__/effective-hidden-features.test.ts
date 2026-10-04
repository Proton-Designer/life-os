import { describe, expect, it } from "vitest";
import { effectiveHiddenFeatures } from "../effective-hidden-features";

describe("effectiveHiddenFeatures", () => {
  it("OFF hides deen in addition to the stored hides", () => {
    expect(effectiveHiddenFeatures(["insights"], false)).toEqual(["insights", "deen"]);
  });
  it("OFF does not duplicate a stored deen", () => {
    expect(effectiveHiddenFeatures(["deen", "insights"], false)).toEqual(["insights", "deen"]);
  });
  it("ON ignores a stored deen (F1: it must not be an unremovable hide)", () => {
    expect(effectiveHiddenFeatures(["deen", "insights"], true)).toEqual(["insights"]);
  });
  it("ON with nothing stored hides nothing", () => {
    expect(effectiveHiddenFeatures([], true)).toEqual([]);
  });
});
