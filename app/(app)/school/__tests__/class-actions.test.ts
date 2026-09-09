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
    await addClassAssessment("class-1", "Midterm 2", "midterm_final", "2026-10-15");

    expect(addClassAssessmentCoreMock).toHaveBeenCalledWith(expect.anything(), "user-1", "class-1", "Midterm 2", "midterm_final", "2026-10-15");
    expect(revalidatePathMock).toHaveBeenCalledWith("/school");
  });

  it("updateClassAssessment delegates to updateClassAssessmentCore", async () => {
    const { updateClassAssessment } = await import("../class-actions");
    await updateClassAssessment("assessment-1", { name: "Renamed", type: "exam", date: "2026-10-20" });

    expect(updateClassAssessmentCoreMock).toHaveBeenCalledWith(expect.anything(), "user-1", "assessment-1", { name: "Renamed", type: "exam", date: "2026-10-20" });
    expect(revalidatePathMock).toHaveBeenCalledWith("/school");
  });

  it("deleteClassAssessment still calls the delete_class_assessment RPC directly -- a real DELETE, deliberately NOT core-extracted (see lib/school/actions-core.ts's header comment)", async () => {
    const { deleteClassAssessment } = await import("../class-actions");
    await deleteClassAssessment("assessment-1");

    expect(rpcMock).toHaveBeenCalledWith("delete_class_assessment", { p_assessment_id: "assessment-1" });
    expect(revalidatePathMock).toHaveBeenCalledWith("/school");
  });
});
