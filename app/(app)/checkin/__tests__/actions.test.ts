import { beforeEach, describe, expect, it, vi } from "vitest";

function makeChain(resolvedValue: { data: unknown; error: null } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "upsert", "update", "insert", "delete"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => resolvedValue);
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain as {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
  };
}

const getClaimsMock = vi.fn(async () => ({ data: { claims: { sub: "user-1" } }, error: null }));
let fromImpl: (table: string) => ReturnType<typeof makeChain>;
const fromMock = vi.fn((table: string) => fromImpl(table));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getClaims: getClaimsMock }, from: fromMock })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("Check-in actions", () => {
  beforeEach(() => {
    getClaimsMock.mockClear();
    fromMock.mockClear();
  });

  it("answerCheckin inserts a checkins row with answered=true and the exact tagLabel passed in", async () => {
    const chain = makeChain();
    fromImpl = () => chain;
    const { answerCheckin } = await import("../actions");

    await answerCheckin(
      "2026-08-10T18:00:00.000Z",
      "kill_list",
      "Ship the landing page",
      "kill-item-1"
    );

    expect(fromMock).toHaveBeenCalledWith("checkins");
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        checkin_time: "2026-08-10T18:00:00.000Z",
        tag_type: "kill_list",
        tag_label: "Ship the landing page",
        tag_ref_id: "kill-item-1",
        answered: true,
      })
    );
  });

  it("recordMissedCheckin inserts an unanswered, untagged checkins row", async () => {
    const chain = makeChain();
    fromImpl = () => chain;
    const { recordMissedCheckin } = await import("../actions");

    await recordMissedCheckin("2026-08-10T13:00:00.000Z");

    expect(fromMock).toHaveBeenCalledWith("checkins");
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        checkin_time: "2026-08-10T13:00:00.000Z",
        tag_type: null,
        answered: false,
      })
    );
  });

  it("answerCheckin sets work_session_id when passed, omits it when not", async () => {
    const chain = makeChain();
    fromImpl = () => chain;
    const { answerCheckin } = await import("../actions");

    await answerCheckin(
      "2026-08-10T18:00:00.000Z",
      "kill_list",
      "Ship the landing page",
      "kill-item-1",
      "session-1"
    );

    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ work_session_id: "session-1" })
    );

    chain.insert.mockClear();
    await answerCheckin("2026-08-10T18:00:00.000Z", "kill_list", "Ship the landing page", "kill-item-1");

    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ work_session_id: null })
    );
  });

  it("recordMissedCheckin sets work_session_id when passed, omits it when not", async () => {
    const chain = makeChain();
    fromImpl = () => chain;
    const { recordMissedCheckin } = await import("../actions");

    await recordMissedCheckin("2026-08-10T13:00:00.000Z", "session-1");

    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ work_session_id: "session-1" })
    );

    chain.insert.mockClear();
    await recordMissedCheckin("2026-08-10T13:00:00.000Z");

    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ work_session_id: null })
    );
  });

  it("skipCheckinsToday sets profiles.paused_date to today's local date", async () => {
    const chain = makeChain({ data: { timezone: "America/Chicago" }, error: null });
    fromImpl = () => chain;
    const { skipCheckinsToday } = await import("../actions");

    await skipCheckinsToday();

    expect(fromMock).toHaveBeenCalledWith("profiles");
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ paused_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })
    );
  });

  it("snoozeCheckin resolves without writing an answered checkins row", async () => {
    const chain = makeChain();
    fromImpl = () => chain;
    const { snoozeCheckin } = await import("../actions");

    await expect(snoozeCheckin("2026-08-10T18:00:00.000Z", 15)).resolves.not.toThrow();
    expect(chain.insert).not.toHaveBeenCalled();
  });
});
