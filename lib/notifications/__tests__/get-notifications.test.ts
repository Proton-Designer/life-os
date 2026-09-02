import { describe, expect, it, vi, beforeEach } from "vitest";
import type { PriorityItem } from "@/lib/home/types";

function makeChain(resolved: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "not", "order", "limit"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => resolved);
  chain.then = (resolve: (v: typeof resolved) => void) => resolve(resolved);
  return chain;
}

const EMPTY = { data: null, error: null };

let tableResponses: Record<string, { data: unknown; error: unknown }>;
const fromMock = vi.fn((table: string) => makeChain(tableResponses[table] ?? EMPTY));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from: fromMock })),
}));

const getProfileMock = vi.fn();
vi.mock("@/lib/supabase/auth", () => ({
  getProfile: (...args: unknown[]) => getProfileMock(...args),
}));

const getPriorityItemsMock = vi.fn();
vi.mock("@/lib/home/get-priority-items", () => ({
  getPriorityItems: (...args: unknown[]) => getPriorityItemsMock(...args),
}));

function priorityItem(overrides: Partial<PriorityItem> = {}): PriorityItem {
  return {
    id: "prayer-fajr",
    domain: "deen",
    title: "Fajr",
    dueAt: null,
    windowEndAt: null,
    date: "2026-08-19",
    urgencyBucket: "right_now",
    completed: false,
    actionType: "toggle_prayer",
    actionRefId: "fajr",
    cost: null,
    ...overrides,
  };
}

describe("getNotifications — read-state overlay", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    tableResponses = {};
    getProfileMock.mockResolvedValue({ timezone: "America/Chicago" });
    getPriorityItemsMock.mockResolvedValue([]);
  });

  it("marks an item read when its id is in notification_reads for today's local date", async () => {
    tableResponses.notification_reads = { data: [{ notification_key: "prayer-fajr" }], error: null };
    getPriorityItemsMock.mockResolvedValue([priorityItem()]);
    const { getNotifications } = await import("../get-notifications");

    const result = await getNotifications("user-1", new Date("2026-08-19T18:00:00Z"));

    const fajr = result.find((i) => i.id === "prayer-fajr");
    expect(fajr).toBeDefined();
    expect(fajr!.read).toBe(true);
  });

  it("marks an item unread when its id is not in notification_reads", async () => {
    tableResponses.notification_reads = { data: [], error: null };
    getPriorityItemsMock.mockResolvedValue([priorityItem()]);
    const { getNotifications } = await import("../get-notifications");

    const result = await getNotifications("user-1", new Date("2026-08-19T18:00:00Z"));

    expect(result[0].read).toBe(false);
  });

  it("scopes the read-state query to the user's LOCAL date, not the UTC date", async () => {
    tableResponses.notification_reads = { data: [], error: null };
    // 2026-08-19T23:30:00Z is already 2026-08-20 UTC-wise in some zones, but
    // still 2026-08-19 local in America/Chicago (UTC-5 in August).
    getProfileMock.mockResolvedValue({ timezone: "America/Chicago" });
    const { getNotifications } = await import("../get-notifications");

    await getNotifications("user-1", new Date("2026-08-20T02:30:00Z")); // 21:30 CDT on the 19th

    const readsChain = fromMock.mock.results.find(
      (_, i) => fromMock.mock.calls[i][0] === "notification_reads"
    );
    expect(fromMock).toHaveBeenCalledWith("notification_reads");
    const chain = readsChain!.value as { eq: ReturnType<typeof vi.fn> };
    expect(chain.eq).toHaveBeenCalledWith("date", "2026-08-19");
  });

  it("a fitness notification item also carries the read flag correctly", async () => {
    tableResponses.notification_reads = { data: [{ notification_key: "fitness-waist-due" }], error: null };
    tableResponses.workout_schedule = { data: null, error: null };
    tableResponses.body_metrics = { data: null, error: null };
    const { getNotifications } = await import("../get-notifications");

    const result = await getNotifications("user-1", new Date("2026-08-19T18:00:00Z"));

    const waist = result.find((i) => i.id === "fitness-waist-due");
    expect(waist).toBeDefined();
    expect(waist!.read).toBe(true);
  });

  it("an item disappears entirely once its underlying cause resolves, regardless of read state — read never keeps a resolved item alive", async () => {
    tableResponses.notification_reads = { data: [{ notification_key: "prayer-fajr" }], error: null };
    getPriorityItemsMock.mockResolvedValue([]); // resolved — getPriorityItems no longer returns it
    const { getNotifications } = await import("../get-notifications");

    const result = await getNotifications("user-1", new Date("2026-08-19T18:00:00Z"));

    expect(result.find((i) => i.id === "prayer-fajr")).toBeUndefined();
  });
});
