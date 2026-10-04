import { describe, expect, it } from "vitest";
import { planningDateForCore } from "../plan-actions-core";

const TZ = "America/Chicago";
const at = (local: string) => new Date(`${local}-05:00`);

describe("planningDateForCore -- the night owl (4 AM rollover)", () => {
  it("tonight at 23:59 on Oct 4 plans Oct 5", () => {
    expect(planningDateForCore("tonight", at("2026-10-04T23:59:00"), TZ)).toBe("2026-10-05");
  });
  it("tonight at 00:30 on Oct 5 is still closing Oct 4, so it plans Oct 5 (NOT Oct 6) -- positive control for the old +1-of-local-today rule", () => {
    expect(planningDateForCore("tonight", at("2026-10-05T00:30:00"), TZ)).toBe("2026-10-05");
  });
  it("03:59 still plans Oct 5; 04:00 is a new day, so tonight plans Oct 6", () => {
    expect(planningDateForCore("tonight", at("2026-10-05T03:59:00"), TZ)).toBe("2026-10-05");
    expect(planningDateForCore("tonight", at("2026-10-05T04:00:00"), TZ)).toBe("2026-10-06");
  });
  it("'today' (replan) is plain local today at every hour", () => {
    expect(planningDateForCore("today", at("2026-10-05T00:30:00"), TZ)).toBe("2026-10-05");
    expect(planningDateForCore("today", at("2026-10-04T23:59:00"), TZ)).toBe("2026-10-04");
  });
});
