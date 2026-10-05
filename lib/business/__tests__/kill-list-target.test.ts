import { describe, expect, it } from "vitest";
import { KILL_LIST_REQUIRED_SLOTS, killListTarget } from "../kill-list-target";

const slot = (text: string) => ({ text });

describe("killListTarget", () => {
  it("is 2 with the optional third empty, and 3 once it has text", () => {
    expect(KILL_LIST_REQUIRED_SLOTS).toBe(2);
    expect(killListTarget([slot("a"), slot("b"), slot("")])).toBe(2);
    expect(killListTarget([slot("a"), slot("b"), slot("   ")])).toBe(2); // whitespace is empty
    expect(killListTarget([slot("a"), slot("b"), slot("c")])).toBe(3);
  });
  it("is 2 even before anything is written (the day's commitment is two)", () => {
    expect(killListTarget([slot(""), slot(""), slot("")])).toBe(2);
    expect(killListTarget([])).toBe(2);
  });
});
