import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const requireUserMock = vi.fn(async () => ({ supabase: {} as unknown as SupabaseClient, userId: "user-1" }));
vi.mock("@/lib/supabase/auth", () => ({
  requireUser: () => requireUserMock(),
}));

const getLayoutCoreMock = vi.fn();
const saveLayoutCoreMock = vi.fn();
vi.mock("@/lib/page-layout/actions-core", () => ({
  getLayoutCore: (...args: unknown[]) => getLayoutCoreMock(...args),
  saveLayoutCore: (...args: unknown[]) => saveLayoutCoreMock(...args),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { getPageLayout, savePageLayout } = await import("../page-layout-actions");

beforeEach(() => {
  requireUserMock.mockClear();
  getLayoutCoreMock.mockReset();
  saveLayoutCoreMock.mockReset();
});

describe("getPageLayout", () => {
  it("resolves the caller via requireUser and passes their own userId + the requested domainKey through", async () => {
    getLayoutCoreMock.mockResolvedValue([]);
    await getPageLayout("school");
    expect(getLayoutCoreMock).toHaveBeenCalledWith(expect.anything(), "user-1", "school");
  });

  it("returns whatever getLayoutCore returns, unmodified", async () => {
    const layout = [{ widgetKey: "task_list", label: "Task list", description: "d", position: 0, hidden: false }];
    getLayoutCoreMock.mockResolvedValue(layout);
    expect(await getPageLayout("school")).toEqual(layout);
  });
});

describe("savePageLayout", () => {
  it("passes the caller's own userId + domainKey + items through to saveLayoutCore", async () => {
    saveLayoutCoreMock.mockResolvedValue(undefined);
    const items = [{ widgetKey: "task_list", position: 0, hidden: true }];
    await savePageLayout("school", items);
    expect(saveLayoutCoreMock).toHaveBeenCalledWith(expect.anything(), "user-1", "school", items);
  });

  it("returns ok:true on success", async () => {
    saveLayoutCoreMock.mockResolvedValue(undefined);
    expect(await savePageLayout("school", [])).toEqual({ ok: true });
  });

  it("returns ok:false with a message rather than throwing, when saveLayoutCore rejects", async () => {
    saveLayoutCoreMock.mockRejectedValue(new Error("Unknown widget."));
    const result = await savePageLayout("school", [{ widgetKey: "bogus", position: 0, hidden: false }]);
    expect(result).toEqual({ ok: false, message: "Unknown widget." });
  });
});
