import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Standalone harness rather than an addition to class-actions.test.ts: that
 * file mocks a supabase client carrying only `rpc`, because every action it
 * covers is a thin wrapper over lib/school/actions-core.ts. deleteClass is
 * not a wrapper — it issues the deletes itself, in an order that is the
 * actual thing worth asserting — so it needs a client that records
 * `from(...).delete()` chains and the sequence they arrive in.
 */

const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePathMock(path) }));

/** Every from()/storage call, in the order it happened. */
let calls: string[] = [];
let syllabusPath: string | null = null;
let failOn: string | null = null;
// P3-14 hardening (2b4f472's lecture-cleanup `.list()` call, then its
// try/catch fix): kept OUT of the shared `calls` log on purpose -- `.list()`
// runs unconditionally on every deleteClass call, and several tests below
// assert `calls` as an EXACT array of the delete/select sequence; folding
// list into that log would break those for a reason unrelated to what they
// test. Default: no lecture files, so `.remove()` for the lectures bucket
// never fires and existing storage assertions are unaffected.
let lectureListThrows = false;

function makeFilterChain(label: string) {
  const result = failOn === label ? { error: new Error(`boom: ${label}`) } : { error: null };
  const chain: Record<string, unknown> = {
    eq: () => chain,
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
  return chain;
}

const storageRemoveMock = vi.fn(async (paths: string[]) => {
  calls.push(`storage.remove:${paths.join(",")}`);
  return { error: null };
});

const storageListMock = vi.fn(async (_path: string) => {
  if (lectureListThrows) throw new Error("boom: storage.list");
  return { data: [], error: null }; // no lecture files by default
});

const supabase = {
  from(table: string) {
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: async () => {
              calls.push(`select:${table}`);
              return failOn === "select"
                ? { data: null, error: new Error("boom: select") }
                : { data: { syllabus_path: syllabusPath }, error: null };
            },
          }),
        }),
      }),
      delete: () => {
        calls.push(`delete:${table}`);
        return makeFilterChain(`delete:${table}`);
      },
    };
  },
  storage: { from: () => ({ remove: storageRemoveMock, list: storageListMock }) },
};

vi.mock("@/lib/supabase/auth", () => ({
  requireUser: async () => ({ supabase, userId: "user-1" }),
}));

describe("deleteClass", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls = [];
    syllabusPath = null;
    failOn = null;
    lectureListThrows = false;
  });

  it("deletes the class's schedule events and tasks, then the class row itself", async () => {
    const { deleteClass } = await import("../class-actions");
    await deleteClass("class-1");

    expect(calls).toEqual([
      "select:classes",
      "delete:schedule_events",
      "delete:tasks",
      "delete:classes",
    ]);
    expect(revalidatePathMock).toHaveBeenCalledWith("/school");
  });

  it("deletes dependents BEFORE the class row — reversed, a mid-failure would strand them", async () => {
    const { deleteClass } = await import("../class-actions");
    await deleteClass("class-1");

    const events = calls.indexOf("delete:schedule_events");
    const tasks = calls.indexOf("delete:tasks");
    const cls = calls.indexOf("delete:classes");
    expect(events).toBeGreaterThanOrEqual(0);
    expect(tasks).toBeGreaterThanOrEqual(0);
    expect(cls).toBeGreaterThan(events);
    expect(cls).toBeGreaterThan(tasks);
  });

  it("leaves the class row intact when deleting its tasks fails, so the delete can be retried", async () => {
    failOn = "delete:tasks";
    const { deleteClass } = await import("../class-actions");

    await expect(deleteClass("class-1")).rejects.toThrow(/boom/);
    expect(calls).not.toContain("delete:classes");
  });

  it("removes the syllabus object, and only after the database work has settled", async () => {
    syllabusPath = "user-1/class-1/syllabus.pdf";
    const { deleteClass } = await import("../class-actions");
    await deleteClass("class-1");

    expect(storageRemoveMock).toHaveBeenCalledWith(["user-1/class-1/syllabus.pdf"]);
    expect(calls.indexOf("storage.remove:user-1/class-1/syllabus.pdf")).toBeGreaterThan(
      calls.indexOf("delete:classes")
    );
  });

  it("never touches storage when the class has no syllabus", async () => {
    const { deleteClass } = await import("../class-actions");
    await deleteClass("class-1");

    expect(storageRemoveMock).not.toHaveBeenCalled();
  });

  it("does not delete anything when the class cannot be read (wrong user, or already gone)", async () => {
    failOn = "select";
    const { deleteClass } = await import("../class-actions");

    await expect(deleteClass("class-1")).rejects.toThrow(/boom/);
    expect(calls).toEqual(["select:classes"]);
  });

  it("HEAD-red fix (2026-09-15): a throwing lecture-storage list() never fails the delete -- the class row is already gone by that point, so this must stay best-effort", async () => {
    lectureListThrows = true;
    const { deleteClass } = await import("../class-actions");

    await expect(deleteClass("class-1")).resolves.toBeUndefined();
    expect(calls).toContain("delete:classes");
    expect(revalidatePathMock).toHaveBeenCalledWith("/school");
  });
});
