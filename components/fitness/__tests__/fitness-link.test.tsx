import { describe, expect, it } from "vitest";
import { personalAwareHref } from "../fitness-link";

describe("personalAwareHref", () => {
  it("stays inside the Personal shell when the current page is under /personal", () => {
    expect(personalAwareHref("/personal/fitness", "/fitness/workouts")).toBe("/personal/fitness/workouts");
    expect(personalAwareHref("/personal/fitness/workouts", "/fitness")).toBe("/personal/fitness");
  });
  it("is unchanged for legacy /fitness pages and non-fitness targets", () => {
    expect(personalAwareHref("/fitness", "/fitness/workouts")).toBe("/fitness/workouts");
    expect(personalAwareHref(null, "/fitness")).toBe("/fitness");
    expect(personalAwareHref("/personal/fitness", "/deen")).toBe("/deen");
  });
});
