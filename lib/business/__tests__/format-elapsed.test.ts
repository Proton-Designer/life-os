import { describe, expect, it } from "vitest";
import { formatElapsedDuration } from "../format-elapsed";

describe("formatElapsedDuration", () => {
  it("shows 0m for less than a minute elapsed", () => {
    expect(formatElapsedDuration(30_000)).toBe("0m");
  });

  it("shows minutes only when under an hour", () => {
    expect(formatElapsedDuration(23 * 60_000)).toBe("23m");
  });

  it("shows hours and minutes once past an hour", () => {
    expect(formatElapsedDuration(85 * 60_000)).toBe("1h 25m");
  });

  it("shows whole hours with 0m when exactly on an hour boundary", () => {
    expect(formatElapsedDuration(2 * 60 * 60_000)).toBe("2h 0m");
  });

  it("floors partial minutes rather than rounding", () => {
    expect(formatElapsedDuration(59_999)).toBe("0m");
    expect(formatElapsedDuration(119_999)).toBe("1m");
  });
});
