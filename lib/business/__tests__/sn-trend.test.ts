import { describe, expect, it } from "vitest";
import { bucketSignalNoiseByWeek } from "../sn-trend";

describe("bucketSignalNoiseByWeek", () => {
  it("buckets answered kill_list/noise checkins into signal/noise per week", () => {
    const weeks = bucketSignalNoiseByWeek(
      [
        { checkin_time: "2026-08-03T10:00:00Z", tag_type: "kill_list", answered: true },
        { checkin_time: "2026-08-03T11:00:00Z", tag_type: "noise", answered: true },
        { checkin_time: "2026-08-10T10:00:00Z", tag_type: "kill_list", answered: true },
        { checkin_time: "2026-08-10T12:00:00Z", tag_type: "kill_list", answered: true },
      ],
      [
        { weekStartIso: "2026-08-02T00:00:00Z", weekEndIso: "2026-08-09T00:00:00Z", label: "Aug 2" },
        { weekStartIso: "2026-08-09T00:00:00Z", weekEndIso: "2026-08-16T00:00:00Z", label: "Aug 9" },
      ]
    );
    expect(weeks[0]).toEqual({ label: "Aug 2", signal: 1, noise: 1, display: "1.0 : 1" });
    expect(weeks[1]).toEqual({ label: "Aug 9", signal: 2, noise: 0, display: "All Signal" });
  });

  it("excludes unanswered checkins from both signal and noise", () => {
    const weeks = bucketSignalNoiseByWeek(
      [{ checkin_time: "2026-08-03T10:00:00Z", tag_type: "kill_list", answered: false }],
      [{ weekStartIso: "2026-08-02T00:00:00Z", weekEndIso: "2026-08-09T00:00:00Z", label: "Aug 2" }]
    );
    expect(weeks[0]).toEqual({ label: "Aug 2", signal: 0, noise: 0, display: "No data" });
  });

  it("returns 'No data' for a week with zero answered checkins at all, not a misleading 0:1", () => {
    const weeks = bucketSignalNoiseByWeek(
      [],
      [{ weekStartIso: "2026-08-02T00:00:00Z", weekEndIso: "2026-08-09T00:00:00Z", label: "Aug 2" }]
    );
    expect(weeks[0].display).toBe("No data");
  });
});
