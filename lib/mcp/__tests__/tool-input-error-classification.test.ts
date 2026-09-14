import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getWriteAction } from "../write-registry";
import { ToolInputError } from "../tool-input-error";

/**
 * A regression net for the 2026-09-14 (#37 follow-up) conversion: every
 * plain "patch.X must be..." shape/type validation across
 * lib/mcp/write-registry.ts's require-and-optional-field helpers now throw
 * ToolInputError, not a bare Error, so tool-wrapper.ts hands its message
 * back to the calling AI client verbatim instead of genericizing it.
 *
 * Not exhaustive over all ~30 converted call sites (write-registry-*.test.ts
 * already exercises the individual actions' behavior); this file's job is
 * narrower — confirm the ERROR TYPE at a representative sample of each
 * converted helper, and separately confirm the ONE deliberately-NOT-
 * converted case (assertRowDomain, covered in write-registry-school.test.ts)
 * stays a plain Error.
 */

/** Minimal fake client — none of the assertions below exercise a real query;
 * every one of these actions throws before the first `.from()` call. */
function makeClient(): SupabaseClient {
  const from = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "insert", "update", "maybeSingle", "single"]) chain[m] = vi.fn(() => chain);
    chain.then = (resolve: (v: { data: null; error: null }) => void) => resolve({ data: null, error: null });
    return chain;
  });
  return { from } as unknown as SupabaseClient;
}

const now = new Date("2026-09-14T12:00:00.000Z");
const client = makeClient();
const ctx = { userClient: client, userId: "user-1", timezone: "UTC", now };

async function rejectionOf(fn: Promise<unknown>): Promise<unknown> {
  try {
    await fn;
    throw new Error("expected the handler to reject");
  } catch (e) {
    return e;
  }
}

describe("write-registry helper validation throws ToolInputError", () => {
  it("requireEnum (work.target.create's kind)", async () => {
    const action = getWriteAction("work", "target", "create")!;
    const e = await rejectionOf(action.handler(ctx, { kind: "not-a-real-kind", title: "x" }));
    expect(e).toBeInstanceOf(ToolInputError);
    expect((e as Error).message).toMatch(/patch\.kind must be one of/i);
  });

  it("requireString (work.target.create's title)", async () => {
    const action = getWriteAction("work", "target", "create")!;
    const e = await rejectionOf(action.handler(ctx, { kind: "target" }));
    expect(e).toBeInstanceOf(ToolInputError);
    expect((e as Error).message).toMatch(/patch\.title is required/i);
  });

  it("requireId (work.target.edit with no top-level id)", async () => {
    const action = getWriteAction("work", "target", "edit")!;
    const e = await rejectionOf(action.handler({ ...ctx }, { title: "x" }));
    expect(e).toBeInstanceOf(ToolInputError);
    expect((e as Error).message).toMatch(/requires the top-level `id`/i);
  });

  it("optionalNumber, given the wrong type (work.target.reorder's position)", async () => {
    const action = getWriteAction("work", "target", "reorder")!;
    const e = await rejectionOf(action.handler({ ...ctx, id: "t1" }, { position: "not-a-number" }));
    expect(e).toBeInstanceOf(ToolInputError);
    expect((e as Error).message).toMatch(/patch\.position must be a number/i);
  });

  it("requirePrayerName (deen.prayer.log)", async () => {
    const action = getWriteAction("deen", "prayer", "log")!;
    // date must be valid first -- requireString(patch, "date") runs before
    // requirePrayerName in this handler.
    const e = await rejectionOf(action.handler(ctx, { date: "2026-09-14", prayer_name: "brunch" }));
    expect(e).toBeInstanceOf(ToolInputError);
    expect((e as Error).message).toMatch(/patch\.prayer_name must be one of/i);
  });

  it("requireConfirmSets (fitness's confirm sets shape)", async () => {
    const action = getWriteAction("fitness", "workout_session", "confirm")!;
    // date/workout_id/workout_name must all be valid first -- requireConfirmSets
    // runs last in this handler.
    const e = await rejectionOf(
      action.handler(ctx, { date: "2026-09-14", workout_id: "w1", workout_name: "Push day", sets: [] })
    );
    expect(e).toBeInstanceOf(ToolInputError);
    expect((e as Error).message).toMatch(/patch\.sets must be a non-empty array/i);
  });

  it("the #37 deliverable check (work.work_session.start)", async () => {
    const action = getWriteAction("work", "work_session", "start")!;
    const e = await rejectionOf(action.handler(ctx, { kind: "deep_work" }));
    expect(e).toBeInstanceOf(ToolInputError);
    expect((e as Error).message).toMatch(/patch\.deliverable is required/i);
  });
});
