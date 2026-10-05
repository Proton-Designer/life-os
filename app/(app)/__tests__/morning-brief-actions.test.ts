// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { setCore, revalidateMock } = vi.hoisted(() => ({ setCore: vi.fn(), revalidateMock: vi.fn() }));
vi.mock("@/lib/supabase/auth", () => ({ requireUser: async () => ({ supabase: { tag: "sb" }, userId: "user-1" }) }));
vi.mock("@/lib/morning-brief/collapsed-core", () => ({ setMorningBriefCollapsedCore: setCore }));
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));

import { setMorningBriefCollapsed } from "../morning-brief-actions";

beforeEach(() => vi.clearAllMocks());

describe("setMorningBriefCollapsed", () => {
  it("passes the signed-in user and the absolute value through, and does NOT revalidate (lean tap)", async () => {
    setCore.mockResolvedValue(undefined);
    expect(await setMorningBriefCollapsed("2026-10-04", true)).toEqual({ ok: true });
    expect(setCore).toHaveBeenCalledWith({ tag: "sb" }, "user-1", "2026-10-04", true);
    expect(revalidateMock).not.toHaveBeenCalled();
  });
  it("a refused write is { ok:false, message }, never a throw", async () => {
    setCore.mockRejectedValue(new Error("Invalid brief date."));
    expect(await setMorningBriefCollapsed("bad", false)).toEqual({ ok: false, message: "Invalid brief date." });
  });
});
