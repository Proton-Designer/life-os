import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { recordVerdictCore } from "../actions-core";

/**
 * Direct coverage of the CORE, independent of `lib/promotions/actions.ts`'s
 * `recordVerdict` Server Action wrapper (covered separately in
 * `actions.test.ts`, which now proves the wrapper's own job: translating a
 * thrown error back into `{ok:false, message}`). This is the contract MCP's
 * write dispatch actually calls — it THROWS, it never returns `ActionResult`.
 */

function makeSupabase(script: Record<string, { data: unknown; error: unknown }>) {
  const calls: { table: string; payload?: unknown }[] = [];
  const from = (table: string) => {
    const result = script[table] ?? { data: null, error: null };
    const chain = {
      insert(payload: unknown) {
        calls.push({ table, payload });
        return chain;
      },
      select() {
        return chain;
      },
      eq() {
        return chain;
      },
      maybeSingle() {
        return Promise.resolve(result);
      },
      single() {
        return Promise.resolve(result);
      },
    };
    return chain;
  };
  return { client: { from } as unknown as SupabaseClient<Database>, calls };
}

describe("recordVerdictCore", () => {
  it("throws before touching the database when 'abandoned' has no reason", async () => {
    const { client, calls } = makeSupabase({});
    await expect(recordVerdictCore(client, "u1", { promotionId: "p1", verdict: "abandoned" })).rejects.toThrow(
      "Say what didn't work. A month from now that sentence is the whole value.",
    );
    expect(calls).toHaveLength(0);
  });

  it("throws when the promotion isn't visible to this caller (missing or someone else's, indistinguishable under RLS)", async () => {
    const { client } = makeSupabase({ lesson_promotions: { data: null, error: null } });
    await expect(recordVerdictCore(client, "u1", { promotionId: "p1", verdict: "adopted" })).rejects.toThrow(
      "That experiment is no longer there. Reload and see what's still open.",
    );
  });

  it("throws when the promotion is already retired -- the manners check, ahead of the DB trigger", async () => {
    const { client } = makeSupabase({ lesson_promotions: { data: { id: "p1", retired_at: "2026-09-01T00:00:00Z" }, error: null } });
    await expect(recordVerdictCore(client, "u1", { promotionId: "p1", verdict: "adopted" })).rejects.toThrow(
      "You've already given this one its verdict. Reload to see where it landed.",
    );
  });

  it("maps migration 128's 55000 to the already-judged message -- the trigger winning a race the read couldn't", async () => {
    const { client } = makeSupabase({
      lesson_promotions: { data: { id: "p1", retired_at: null }, error: null },
      lesson_verdicts: { data: null, error: { code: "55000" } },
    });
    await expect(recordVerdictCore(client, "u1", { promotionId: "p1", verdict: "adopted" })).rejects.toThrow(
      "You've already given this one its verdict. Reload to see where it landed.",
    );
  });

  it("records a still_testing verdict (no reason required) and returns the real id/verdictAt", async () => {
    const { client, calls } = makeSupabase({
      lesson_promotions: { data: { id: "p1", retired_at: null }, error: null },
      lesson_verdicts: { data: { id: "v1", verdict_at: "2026-09-08T12:00:00Z" }, error: null },
    });

    const result = await recordVerdictCore(client, "u1", { promotionId: "p1", verdict: "still_testing" });

    expect(result).toEqual({ id: "v1", promotionId: "p1", verdict: "still_testing", verdictAt: "2026-09-08T12:00:00Z" });
    expect(calls.find((c) => c.table === "lesson_verdicts")?.payload).toEqual({
      user_id: "u1",
      promotion_id: "p1",
      verdict: "still_testing",
      reason: null,
    });
  });

  it("records an abandoned verdict with its reason", async () => {
    const { client, calls } = makeSupabase({
      lesson_promotions: { data: { id: "p1", retired_at: null }, error: null },
      lesson_verdicts: { data: { id: "v1", verdict_at: "2026-09-08T12:00:00Z" }, error: null },
    });

    await recordVerdictCore(client, "u1", { promotionId: "p1", verdict: "abandoned", reason: "Never stuck to it" });

    expect(calls.find((c) => c.table === "lesson_verdicts")?.payload).toMatchObject({ reason: "Never stuck to it" });
  });

  it("surfaces an unrecognized DB error as the generic message, never a leaked internal one", async () => {
    const { client } = makeSupabase({
      lesson_promotions: { data: { id: "p1", retired_at: null }, error: null },
      lesson_verdicts: { data: null, error: { code: "99999", message: "some raw postgres detail" } },
    });
    await expect(recordVerdictCore(client, "u1", { promotionId: "p1", verdict: "adopted" })).rejects.toThrow(
      "Something went wrong. Nothing was saved — please try again.",
    );
  });
});
