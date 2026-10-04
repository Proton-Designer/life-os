import { describe, expect, it } from "vitest";
import { withoutDeenDomain } from "../deen-filter";

const items = [{ domain: "deen" as const, n: 1 }, { domain: "business" as const, n: 2 }];

describe("withoutDeenDomain", () => {
  it("OFF drops deen-domain items and keeps the rest", () => {
    expect(withoutDeenDomain(items, false)).toEqual([{ domain: "business", n: 2 }]);
  });
  it("ON keeps everything (positive control)", () => {
    expect(withoutDeenDomain(items, true)).toEqual(items);
  });
  it("does not mutate the input", () => {
    withoutDeenDomain(items, false);
    expect(items).toHaveLength(2);
  });
});
