import { beforeEach, describe, expect, it, vi } from "vitest";

const createClassCoreMock = vi.fn(async (..._args: unknown[]) => "class-new");
const updateClassCoreMock = vi.fn(async (..._args: unknown[]) => {});
const addClassAssessmentCoreMock = vi.fn(async (..._args: unknown[]) => ({ assessmentId: "assessment-new", taskId: "task-new" }));
const updateClassAssessmentCoreMock = vi.fn(async (..._args: unknown[]) => {});
const revalidatePathMock = vi.fn();

vi.mock("@/lib/school/actions-core", () => ({
  createClassCore: (...args: unknown[]) => createClassCoreMock(...args),
  updateClassCore: (...args: unknown[]) => updateClassCoreMock(...args),
  addClassAssessmentCore: (...args: unknown[]) => addClassAssessmentCoreMock(...args),
  updateClassAssessmentCore: (...args: unknown[]) => updateClassAssessmentCoreMock(...args),
}));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePathMock(path) }));

const rpcMock = vi.fn(async (..._args: unknown[]) => ({ error: null }));
const requireUserMock = vi.fn(async () => ({ supabase: { rpc: rpcMock }, userId: "user-1" }));
vi.mock("@/lib/supabase/auth", () => ({
  requireUser: () => requireUserMock(),
}));

describe("class-actions — thin wrappers over lib/school/actions-core.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("createClass delegates to createClassCore with this user's supabase/userId, and returns the real id", async () => {
    const { createClass } = await import("../class-actions");
    const result = await createClass({ shortName: "DSA", code: "CS-3345-HON" });

    expect(createClassCoreMock).toHaveBeenCalledWith(expect.anything(), "user-1", { shortName: "DSA", code: "CS-3345-HON" });
    expect(result).toEqual({ id: "class-new" });
    expect(revalidatePathMock).toHaveBeenCalledWith("/school");
  });

  it("updateClass delegates to updateClassCore", async () => {
    const { updateClass } = await import("../class-actions");
    await updateClass("class-1", { room: "ENG 201" });

    expect(updateClassCoreMock).toHaveBeenCalledWith(expect.anything(), "user-1", "class-1", { room: "ENG 201" });
    expect(revalidatePathMock).toHaveBeenCalledWith("/school");
  });

  it("addClassAssessment delegates to addClassAssessmentCore", async () => {
    const { addClassAssessment } = await import("../class-actions");
    await addClassAssessment("class-1", "Midterm 2", "final_midterm", "2026-10-15");

    expect(addClassAssessmentCoreMock).toHaveBeenCalledWith(expect.anything(), "user-1", "class-1", "Midterm 2", "final_midterm", "2026-10-15");
    expect(revalidatePathMock).toHaveBeenCalledWith("/school");
  });

  it("updateClassAssessment delegates to updateClassAssessmentCore", async () => {
    const { updateClassAssessment } = await import("../class-actions");
    await updateClassAssessment("assessment-1", { name: "Renamed", type: "exam", date: "2026-10-20" });

    expect(updateClassAssessmentCoreMock).toHaveBeenCalledWith(expect.anything(), "user-1", "assessment-1", { name: "Renamed", type: "exam", date: "2026-10-20" });
    expect(revalidatePathMock).toHaveBeenCalledWith("/school");
  });

  // GAP-01
  it("updateClassAssessment passes pointsEarned/pointsPossible through unmodified when provided", async () => {
    const { updateClassAssessment } = await import("../class-actions");
    await updateClassAssessment("assessment-1", { name: "Renamed", type: "exam", date: "2026-10-20", pointsEarned: 87, pointsPossible: 100 });

    expect(updateClassAssessmentCoreMock).toHaveBeenCalledWith(expect.anything(), "user-1", "assessment-1", {
      name: "Renamed",
      type: "exam",
      date: "2026-10-20",
      pointsEarned: 87,
      pointsPossible: 100,
    });
  });

  it("deleteClassAssessment still calls the delete_class_assessment RPC directly -- a real DELETE, deliberately NOT core-extracted (see lib/school/actions-core.ts's header comment)", async () => {
    const { deleteClassAssessment } = await import("../class-actions");
    await deleteClassAssessment("assessment-1");

    expect(rpcMock).toHaveBeenCalledWith("delete_class_assessment", { p_assessment_id: "assessment-1" });
    expect(revalidatePathMock).toHaveBeenCalledWith("/school");
  });

  describe("deleteClass", () => {
    /**
     * P3-14 FINDING (HANDOFF-team-b.md §5 item 1): deleteClass removed only
     * the syllabus storage object -- lecture_recordings rows cascade with
     * the class delete (FK), but the lecture AUDIO BYTES in the `lectures`
     * bucket were never removed, orphaned forever. Fix: list and remove
     * everything under `<userId>/<classId>/` in that bucket too, best-effort
     * (never blocks the delete), same posture the syllabus cleanup already
     * has.
     */
    function makeDeleteClassSupabase(opts: { syllabusPath?: string | null; lectureFiles?: { name: string }[] } = {}) {
      const removeCalls: { bucket: string; paths: string[] }[] = [];
      const listCalls: { bucket: string; path: string }[] = [];
      const from = vi.fn((_table: string) => {
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn(() => chain);
        chain.eq = vi.fn(() => chain);
        chain.delete = vi.fn(() => chain);
        chain.single = vi.fn(async () => ({ data: { syllabus_path: opts.syllabusPath ?? null }, error: null }));
        chain.then = (resolve: (v: { error: null }) => void) => resolve({ error: null });
        return chain;
      });
      const storage = {
        from: (bucket: string) => ({
          remove: vi.fn(async (paths: string[]) => {
            removeCalls.push({ bucket, paths });
            return { data: null, error: null };
          }),
          list: vi.fn(async (path: string) => {
            listCalls.push({ bucket, path });
            return { data: opts.lectureFiles ?? [], error: null };
          }),
        }),
      };
      return { supabase: { from, storage, rpc: rpcMock }, removeCalls, listCalls };
    }

    it("removes this class's lecture recordings from storage -- previously only the syllabus was cleaned up, lecture bytes were orphaned", async () => {
      const { supabase, removeCalls, listCalls } = makeDeleteClassSupabase({ lectureFiles: [{ name: "1700000000-lecture.mp3" }, { name: "1700000100-lecture2.m4a" }] });
      requireUserMock.mockResolvedValue({ supabase, userId: "user-1" });
      const { deleteClass } = await import("../class-actions");

      await deleteClass("class-1");

      expect(listCalls).toContainEqual({ bucket: "lectures", path: "user-1/class-1" });
      expect(removeCalls).toContainEqual({
        bucket: "lectures",
        paths: ["user-1/class-1/1700000000-lecture.mp3", "user-1/class-1/1700000100-lecture2.m4a"],
      });
    });

    it("a class with no lecture recordings removes nothing from the lectures bucket (an empty list is not an error)", async () => {
      const { supabase, removeCalls } = makeDeleteClassSupabase({ lectureFiles: [] });
      requireUserMock.mockResolvedValue({ supabase, userId: "user-1" });
      const { deleteClass } = await import("../class-actions");

      await deleteClass("class-1");

      expect(removeCalls.filter((c) => c.bucket === "lectures")).toHaveLength(0);
    });

    it("still removes the syllabus object too, unaffected by the lecture cleanup", async () => {
      const { supabase, removeCalls } = makeDeleteClassSupabase({ syllabusPath: "user-1/class-1/syllabus.pdf", lectureFiles: [] });
      requireUserMock.mockResolvedValue({ supabase, userId: "user-1" });
      const { deleteClass } = await import("../class-actions");

      await deleteClass("class-1");

      expect(removeCalls).toContainEqual({ bucket: "syllabi", paths: ["user-1/class-1/syllabus.pdf"] });
    });
  });
});
