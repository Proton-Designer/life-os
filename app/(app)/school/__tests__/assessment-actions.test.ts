// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { addCore, updateCore, rpcMock, revalidateMock, overviewMock, classLookup } = vi.hoisted(() => ({
  addCore: vi.fn(), updateCore: vi.fn(), rpcMock: vi.fn(), revalidateMock: vi.fn(), overviewMock: vi.fn(), classLookup: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));
vi.mock("@/lib/supabase/auth", () => ({
  requireUser: async () => ({
    userId: "user-1",
    supabase: {
      rpc: rpcMock,
      from: () => {
        const c: Record<string, unknown> = {};
        for (const m of ["select", "eq"]) c[m] = () => c;
        c.maybeSingle = async () => classLookup();
        return c;
      },
    },
  }),
  getProfile: async () => ({ timezone: "America/Chicago" }),
}));
vi.mock("@/lib/school/actions-core", () => ({ addClassAssessmentCore: addCore, updateClassAssessmentCore: updateCore }));
vi.mock("@/lib/school/assessments-overview", () => ({ getAssessmentsOverview: overviewMock }));

import { addAssessment, getMyAssessmentsOverview, removeAssessment, updateAssessment } from "../assessment-actions";

const ALL = ["/school", "/", "/calendar", "/close"];
beforeEach(() => {
  vi.clearAllMocks();
  classLookup.mockReturnValue({ data: { id: "c1" }, error: null });
});

describe("addAssessment", () => {
  it("adds through the shared core (normalised type, trimmed name) and revalidates every page that shows it", async () => {
    addCore.mockResolvedValue({ assessmentId: "a1", taskId: "t1" });
    const res = await addAssessment("c1", { name: "  Midterm 1 ", type: "final_midterm", date: "2026-10-20" });
    expect(res).toEqual({ ok: true, assessmentId: "a1", taskId: "t1" });
    expect(addCore).toHaveBeenCalledWith(expect.anything(), "user-1", "c1", "Midterm 1", "exam", "2026-10-20");
    expect(revalidateMock.mock.calls.map((c) => c[0])).toEqual(ALL);
  });
  it("refuses bad input before any write, and a class that is not the caller's", async () => {
    for (const bad of [{ name: " ", type: "exam", date: "2026-10-20" }, { name: "x", type: "reminder", date: "2026-10-20" }, { name: "x", type: "exam", date: "10/20/2026" }, { name: "x", type: "exam", date: "2026-02-31x" }]) {
      expect((await addAssessment("c1", bad as never)).ok).toBe(false);
    }
    classLookup.mockReturnValue({ data: null, error: null });
    expect(await addAssessment("other", { name: "x", type: "exam", date: "2026-10-20" })).toEqual({ ok: false, message: "That class wasn't found." });
    expect(addCore).not.toHaveBeenCalled();
    expect(revalidateMock).not.toHaveBeenCalled();
  });
  it("a failing core is { ok:false, message } and revalidates nothing", async () => {
    addCore.mockRejectedValue(new Error("boom"));
    expect(await addAssessment("c1", { name: "x", type: "exam", date: "2026-10-20" })).toEqual({ ok: false, message: "boom" });
    expect(revalidateMock).not.toHaveBeenCalled();
  });
});

describe("updateAssessment", () => {
  it("passes ONLY name/type/date (absolute), normalised, and revalidates all pages", async () => {
    updateCore.mockResolvedValue(undefined);
    expect(await updateAssessment("a1", { name: "Final exam", type: "final_midterm", date: "2026-12-10" })).toEqual({ ok: true });
    expect(updateCore).toHaveBeenCalledWith(expect.anything(), "user-1", "a1", { name: "Final exam", type: "exam", date: "2026-12-10" });
    expect(revalidateMock.mock.calls.map((c) => c[0])).toEqual(ALL);
  });
  it("invalid input is refused before the core", async () => {
    expect((await updateAssessment("a1", { name: "", type: "exam", date: "2026-12-10" })).ok).toBe(false);
    expect(updateCore).not.toHaveBeenCalled();
  });
});

describe("removeAssessment", () => {
  it("is the atomic pair delete (assessment + paired task) and revalidates all pages", async () => {
    rpcMock.mockResolvedValue({ error: null });
    expect(await removeAssessment("a1")).toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledWith("delete_class_assessment", { p_assessment_id: "a1" });
    expect(revalidateMock.mock.calls.map((c) => c[0])).toEqual(ALL);
  });
  it("someone else's / missing assessment reads as already removed and revalidates nothing", async () => {
    rpcMock.mockResolvedValue({ error: { message: "assessment not found or not owned by caller" } });
    expect(await removeAssessment("a1")).toEqual({ ok: false, message: "That assessment was already removed." });
    expect(revalidateMock).not.toHaveBeenCalled();
  });
});

describe("getMyAssessmentsOverview", () => {
  it("passes the user's LOCAL date (profile timezone), not a UTC date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T03:30:00Z")); // 22:30 on Oct 4 in Chicago
    overviewMock.mockResolvedValue({ soon: [], upcoming: [], future: [], noDate: [], total: 0 });
    await getMyAssessmentsOverview();
    expect(overviewMock).toHaveBeenCalledWith(expect.anything(), "user-1", "2026-10-04");
    vi.useRealTimers();
  });
});
