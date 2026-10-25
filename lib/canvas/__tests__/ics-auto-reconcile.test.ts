import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeFakeDb } from "@/lib/self-mastery/ingestion/__tests__/fake-db";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/canvas/ics-reconcile-core", () => ({ reconcileCanvasIcsCore: vi.fn() }));
vi.mock("@/lib/canvas/client", () => ({ fetchCanvasIcsFeed: vi.fn() }));
vi.mock("@/lib/ai/encryption", () => ({ decryptSecret: (s: string) => `https://school.example/${s}.ics` }));

const { reconcileDueIcsFeeds, ICS_AUTO_RECONCILE_INTERVAL_MS, MAX_ICS_FEEDS_PER_RUN, ICS_ERROR_PREFIX, recordIcsOutcome } = await import("../ics-auto-reconcile");

const NOW = new Date("2026-10-25T18:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const H = 3600 * 1000;

const conn = (user: string, over: Record<string, unknown> = {}) => ({
  user_id: user, encrypted_ics_feed_url: `enc-${user}`, last_ics_reconcile_at: null, last_sync_error: null, token_status: null, ...over,
});

function setup(connections: Record<string, unknown>[]) {
  const db = makeFakeDb({ canvas_connections: connections, profiles: connections.map((c) => ({ user_id: c.user_id, timezone: "America/Chicago" })) });
  const fetchFeed = vi.fn(async (_url: string) => ({ ok: true as const, data: "BEGIN:VCALENDAR" }));
  const reconcile = vi.fn(async (..._a: unknown[]) => ({ newlyStaged: 2, linkedToExisting: 0, parsedAssignmentEvents: 2, alreadyCovered: 0, unmapped: 0, courseImport: { created: 0, adopted: 1, alreadyLinked: 0, skippedDismissed: 0 } }));
  return { db, deps: { fetchFeed, reconcile: reconcile as never, decrypt: (s: string) => `https://school.example/${s}.ics` }, fetchFeed, reconcile };
}
const row = (db: ReturnType<typeof setup>["db"], user: string) => db.tables.canvas_connections!.find((r) => r.user_id === user)!;

beforeEach(() => vi.clearAllMocks());

describe("reconcileDueIcsFeeds — ICS-only users are refreshed automatically", () => {
  it("reconciles a feed that was never checked, with the person's timezone, and stamps 'last checked'", async () => {
    const { db, deps, reconcile } = setup([conn("u1")]);
    const r = await reconcileDueIcsFeeds(db.client, NOW, deps);
    expect(r).toMatchObject({ checked: 1, reconciled: 1, failed: 0, newlyStaged: 2 });
    expect(reconcile.mock.calls[0]![1]).toBe("u1");
    expect(reconcile.mock.calls[0]![2]).toBe("America/Chicago");
    expect(row(db, "u1").last_ics_reconcile_at).toBe(NOW.toISOString());
  });

  it("works for a user with NO token at all (token_status null, no instance): the ICS-only case this exists for", async () => {
    const { db, deps } = setup([conn("u1", { token_status: null, instance_url: null })]);
    expect((await reconcileDueIcsFeeds(db.client, NOW, deps)).reconciled).toBe(1);
  });

  it("checks a feed at most every 6 hours: one checked 5h ago is skipped, one checked 7h ago is not", async () => {
    const { db, deps, fetchFeed } = setup([conn("recent", { last_ics_reconcile_at: ago(5 * H) }), conn("due", { last_ics_reconcile_at: ago(7 * H) })]);
    expect(ICS_AUTO_RECONCILE_INTERVAL_MS).toBe(6 * H);
    await reconcileDueIcsFeeds(db.client, NOW, deps);
    expect(fetchFeed).toHaveBeenCalledTimes(1);
    expect(fetchFeed.mock.calls[0]![0]).toContain("enc-due");
  });

  it("skips connections with no feed saved", async () => {
    const { db, deps, fetchFeed } = setup([conn("tokenonly", { encrypted_ics_feed_url: null })]);
    await reconcileDueIcsFeeds(db.client, NOW, deps);
    expect(fetchFeed).not.toHaveBeenCalled();
  });

  it("has a per-run cap, so a large fleet cannot make one invocation unbounded", async () => {
    const many = Array.from({ length: MAX_ICS_FEEDS_PER_RUN + 5 }, (_, i) => conn(`u${i}`));
    const { db, deps, fetchFeed } = setup(many);
    await reconcileDueIcsFeeds(db.client, NOW, deps);
    expect(fetchFeed).toHaveBeenCalledTimes(MAX_ICS_FEEDS_PER_RUN);
  });
});

describe("reconcileDueIcsFeeds — failures are visible, never thrown", () => {
  it("a 404 / revoked feed sets a visible error, stamps the check (so it backs off for 6 h instead of hammering), and does not stop the other feeds", async () => {
    const { db, deps, fetchFeed } = setup([conn("bad"), conn("good")]);
    fetchFeed.mockImplementation(async (url: string) => (url.includes("enc-bad") ? ({ ok: false as const, message: "The calendar feed returned an error (HTTP 404)." } as never) : { ok: true as const, data: "x" }));
    const r = await reconcileDueIcsFeeds(db.client, NOW, deps);
    expect(r).toMatchObject({ checked: 2, reconciled: 1, failed: 1 });
    expect(String(row(db, "bad").last_sync_error)).toContain(ICS_ERROR_PREFIX);
    expect(String(row(db, "bad").last_sync_error)).toMatch(/404/);
    expect(String(row(db, "bad").last_sync_error)).toMatch(/new (link|feed)|paste/i);
    expect(row(db, "bad").last_ics_reconcile_at).toBe(NOW.toISOString());
    expect(row(db, "good").last_sync_error).toBeNull();
  });

  it("an unreadable saved URL and a thrown reconcile are both recorded, not raised", async () => {
    const a = setup([conn("u1")]);
    a.deps.decrypt = () => {
      throw new Error("bad key");
    };
    await expect(reconcileDueIcsFeeds(a.db.client, NOW, a.deps)).resolves.toMatchObject({ failed: 1 });
    expect(String(row(a.db, "u1").last_sync_error)).toContain(ICS_ERROR_PREFIX);

    const b = setup([conn("u2")]);
    b.reconcile.mockRejectedValue(new Error("boom"));
    await expect(reconcileDueIcsFeeds(b.db.client, NOW, b.deps)).resolves.toMatchObject({ failed: 1 });
    expect(String(row(b.db, "u2").last_sync_error)).toContain(ICS_ERROR_PREFIX);
    expect(String(row(b.db, "u2").last_sync_error)).not.toContain("boom"); // internals stay out of the visible message
  });

  it("a later success clears the calendar-feed error but leaves a token-sync error alone", async () => {
    const a = setup([conn("u1", { last_sync_error: `${ICS_ERROR_PREFIX}old failure` })]);
    await reconcileDueIcsFeeds(a.db.client, NOW, a.deps);
    expect(row(a.db, "u1").last_sync_error).toBeNull();
    const b = setup([conn("u2", { last_sync_error: "Your Canvas token expired." })]);
    await reconcileDueIcsFeeds(b.db.client, NOW, b.deps);
    expect(row(b.db, "u2").last_sync_error).toBe("Your Canvas token expired.");
  });
});

describe("recordIcsOutcome (also used by the manual button)", () => {
  it("records an error with the prefix and a success without", async () => {
    const { db } = setup([conn("u1")]);
    await recordIcsOutcome(db.client, "u1", { ok: false, message: "The calendar feed returned an error (HTTP 403)." }, NOW);
    expect(String(row(db, "u1").last_sync_error)).toMatch(/^Calendar feed: /);
    await recordIcsOutcome(db.client, "u1", { ok: true }, NOW);
    expect(row(db, "u1").last_sync_error).toBeNull();
  });
});
