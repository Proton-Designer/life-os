// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthedUserMock, getProfileMock, getNotificationsMock, getQueueMock, getTodayCountMock, getSessionCountMock, getWeekCalendarMock, deenMock } =
  vi.hoisted(() => ({
    getAuthedUserMock: vi.fn(),
    getProfileMock: vi.fn(),
    getNotificationsMock: vi.fn(),
    getQueueMock: vi.fn(),
    getTodayCountMock: vi.fn(),
    getSessionCountMock: vi.fn(),
    getWeekCalendarMock: vi.fn(),
    deenMock: vi.fn(),
  }));

vi.mock("@/lib/supabase/auth", () => ({ getAuthedUser: getAuthedUserMock, getProfile: getProfileMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ tag: "supabase" }) }));
vi.mock("@/lib/notifications/get-notifications", () => ({ getNotifications: getNotificationsMock }));
vi.mock("@/lib/checkins/get-allocation-queue", () => ({ getPendingAllocationQueue: getQueueMock }));
vi.mock("@/lib/distractions/queries", () => ({ getTodayDistractionCount: getTodayCountMock, getSessionDistractionCount: getSessionCountMock }));
vi.mock("@/lib/deen/deen-mode-guard", () => ({ isDeenModeOnForRequest: deenMock }));
vi.mock("@/app/(app)/calendar/actions", () => ({ getWeekCalendar: getWeekCalendarMock }));

import { shellRead } from "@/lib/api/shell-read";
import { GET as notificationsGET } from "../notifications/route";
import { GET as queueGET } from "../allocation-queue/route";
import { GET as countGET } from "../distraction-count/route";
import { GET as calendarGET } from "../week-calendar/route";
import { NextRequest } from "next/server";

const req = (path: string) => new NextRequest(`http://localhost${path}`);

beforeEach(() => {
  vi.clearAllMocks();
  getAuthedUserMock.mockResolvedValue({ id: "user-1", email: "a@b.c" });
  getProfileMock.mockResolvedValue({ timezone: "America/Chicago" });
  deenMock.mockResolvedValue(false);
});

describe("shellRead", () => {
  it("answers 401 and never runs the read for an unauthenticated caller", async () => {
    getAuthedUserMock.mockResolvedValue(null);
    const read = vi.fn();
    const res = await shellRead(read);
    expect(res.status).toBe(401);
    expect(read).not.toHaveBeenCalled();
  });

  it("returns the data with Cache-Control private, no-store (never cached across users)", async () => {
    const res = await shellRead(async (userId) => ({ userId }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ userId: "user-1" });
  });

  it("a failing read is a generic 500 that never echoes the error text", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await shellRead(async () => {
      throw new Error("relation tasks does not exist");
    });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("relation");
  });

  it("positive control: without the auth check an anonymous caller WOULD reach the read", async () => {
    getAuthedUserMock.mockResolvedValue(null);
    const read = vi.fn(async () => "secret");
    const naive = async () => Response.json(await read()); // what a handler with no getAuthedUser would do
    await naive();
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe("shell route handlers", () => {
  it("notifications: reads for the authed user at server time", async () => {
    getNotificationsMock.mockResolvedValue([{ key: "k" }]);
    const res = await notificationsGET();
    expect(await res.json()).toEqual([{ key: "k" }]);
    const [userId, now] = getNotificationsMock.mock.calls[0];
    expect(userId).toBe("user-1");
    expect(now).toBeInstanceOf(Date);
  });

  it("allocation-queue: delegates to getPendingAllocationQueue for the authed user", async () => {
    getQueueMock.mockResolvedValue({ items: [], unknownCount: 0, timezone: "UTC", deenMode: false });
    const res = await queueGET();
    expect((await res.json()).timezone).toBe("UTC");
    expect(getQueueMock.mock.calls[0][0]).toBe("user-1");
  });

  it("distraction-count: no sessionId = today's count in the user's timezone with the Deen gate", async () => {
    getTodayCountMock.mockResolvedValue(3);
    const res = await countGET(req("/api/shell/distraction-count"));
    expect(await res.json()).toBe(3);
    const [, userId, date, deen] = getTodayCountMock.mock.calls[0];
    expect(userId).toBe("user-1");
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(deen).toBe(false);
    expect(getSessionCountMock).not.toHaveBeenCalled();
  });

  it("distraction-count: ?sessionId= scopes the count to this user and that session", async () => {
    getSessionCountMock.mockResolvedValue(4);
    const res = await countGET(req("/api/shell/distraction-count?sessionId=s-9"));
    expect(await res.json()).toBe(4);
    expect(getSessionCountMock).toHaveBeenCalledWith(expect.anything(), "user-1", "s-9");
    expect(getTodayCountMock).not.toHaveBeenCalled();
  });

  it("week-calendar: returns the calendar data", async () => {
    getWeekCalendarMock.mockResolvedValue({ items: [] });
    const res = await calendarGET();
    expect(await res.json()).toEqual({ items: [] });
  });

  it("every handler refuses an unauthenticated caller", async () => {
    getAuthedUserMock.mockResolvedValue(null);
    for (const res of [await notificationsGET(), await queueGET(), await countGET(req("/api/shell/distraction-count")), await calendarGET()]) {
      expect(res.status).toBe(401);
    }
    expect(getNotificationsMock).not.toHaveBeenCalled();
    expect(getQueueMock).not.toHaveBeenCalled();
    expect(getWeekCalendarMock).not.toHaveBeenCalled();
  });
});
