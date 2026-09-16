import { describe, expect, it } from "vitest";
import { icsFeedDisplaySource } from "../ics-feed-display";

describe("icsFeedDisplaySource (P3-13)", () => {
  it("strips a trailing .ics so last4 shows something distinguishing, not the literal extension", () => {
    expect(icsFeedDisplaySource("https://school.instructure.com/feeds/calendars/user_secret123.ics")).toBe("https://school.instructure.com/feeds/calendars/user_secret123");
  });

  it("is case-insensitive on the extension", () => {
    expect(icsFeedDisplaySource("https://school.instructure.com/feed.ICS")).toBe("https://school.instructure.com/feed");
  });

  it("leaves a URL with no .ics extension untouched", () => {
    expect(icsFeedDisplaySource("https://school.instructure.com/feed")).toBe("https://school.instructure.com/feed");
  });
});
