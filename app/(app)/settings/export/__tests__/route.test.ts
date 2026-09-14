import { describe, expect, it, vi, beforeEach } from "vitest";

const getAuthedUserMock = vi.fn();
vi.mock("@/lib/supabase/auth", () => ({
  getAuthedUser: (...args: unknown[]) => getAuthedUserMock(...args),
}));

// Records every table name queried, so the assertions below can check
// membership without importing the route's own (unexported) table list —
// that would just be re-typing the list back at itself and could pass
// against a broken version by accident.
const queriedTables: string[] = [];
function chain() {
  const c: Record<string, unknown> = {};
  c.select = vi.fn(() => c);
  c.eq = vi.fn(async () => ({ data: [], error: null }));
  return c;
}
const fromMock = vi.fn((table: string) => {
  queriedTables.push(table);
  return chain();
});
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from: fromMock })),
}));

import { GET } from "../route";

describe("GET /settings/export", () => {
  beforeEach(() => {
    queriedTables.length = 0;
    fromMock.mockClear();
    getAuthedUserMock.mockReset();
  });

  it("401s without ever querying a table when unauthenticated", async () => {
    getAuthedUserMock.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
    expect(fromMock).not.toHaveBeenCalled();
  });

  // #32: work_sessions (the single biggest gap — 489+ live rows of the
  // user's entire time-tracking history), deen_habits, distraction_triggers,
  // distraction_events, coop_targets, and mcp_widgets were all silently
  // absent from a user's own data export. This is the regression test: it
  // fails the moment any of the six the Boss named by hand drops back out
  // of the export list.
  it("queries every one of the six tables previously missing from the export — regression test for #32", async () => {
    getAuthedUserMock.mockResolvedValue({ id: "user-1" });
    await GET();
    for (const table of ["work_sessions", "deen_habits", "distraction_triggers", "distraction_events", "coop_targets", "mcp_widgets"]) {
      expect(queriedTables).toContain(table);
    }
  });

  it("still exports custom_habits — a live insert path (fitness addHabit), not dead code, despite being 0 rows on some accounts", async () => {
    getAuthedUserMock.mockResolvedValue({ id: "user-1" });
    await GET();
    expect(queriedTables).toContain("custom_habits");
  });

  // Never widen the export to hand out secret-adjacent material. This is a
  // security regression test, not a completeness one — a future pass adding
  // "every user_id table" back in bulk must not silently reintroduce these.
  it("never queries a table holding token hashes or an encrypted API key", async () => {
    getAuthedUserMock.mockResolvedValue({ id: "user-1" });
    await GET();
    for (const table of ["mcp_access_tokens", "mcp_oauth_codes", "mcp_oauth_refresh_tokens", "user_api_keys"]) {
      expect(queriedTables).not.toContain(table);
    }
  });

  it("scopes every query to the authenticated user via eq(user_id, ...)", async () => {
    getAuthedUserMock.mockResolvedValue({ id: "user-42" });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(fromMock.mock.calls.length).toBeGreaterThan(40);
  });
});
