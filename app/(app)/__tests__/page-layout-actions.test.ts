import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const requireUserMock = vi.fn(async () => ({ supabase: {} as unknown as SupabaseClient, userId: "user-1" }));
vi.mock("@/lib/supabase/auth", () => ({
  requireUser: () => requireUserMock(),
}));

let enabledFeatures: string[] = [];
vi.mock("@/lib/opt-in-guard", () => ({
  isOptInFeatureOnForRequest: async (id: string) => enabledFeatures.includes(id),
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
  enabledFeatures = [];
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

// RS-01 review F1: Home's customiser must not offer modules whose opt-in feature is OFF.
describe("getPageLayout — opt-in Home widgets", () => {
  const w = (widgetKey: string) => ({ widgetKey, label: widgetKey, description: "d", position: 0, hidden: false });
  const HOME = [w("morning_brief"), w("morning_routine"), w("sleep_intent"), w("now")];

  it("OFF: morning_routine and sleep_intent are not offered; everything else is", async () => {
    getLayoutCoreMock.mockResolvedValue(HOME);
    const keys = (await getPageLayout("home")).map((i) => i.widgetKey);
    expect(keys).toEqual(["morning_brief", "now"]);
  });

  it("each widget follows ONLY its own feature (morning_routine on, sleep_plan off)", async () => {
    enabledFeatures = ["morning_routine"];
    getLayoutCoreMock.mockResolvedValue(HOME);
    const keys = (await getPageLayout("home")).map((i) => i.widgetKey);
    expect(keys).toEqual(["morning_brief", "morning_routine", "now"]);
  });

  it("ON: both are offered", async () => {
    enabledFeatures = ["morning_routine", "sleep_plan"];
    getLayoutCoreMock.mockResolvedValue(HOME);
    expect((await getPageLayout("home")).map((i) => i.widgetKey)).toEqual(["morning_brief", "morning_routine", "sleep_intent", "now"]);
  });

  it("other domains are never filtered", async () => {
    getLayoutCoreMock.mockResolvedValue([w("morning_routine")]);
    expect(await getPageLayout("school")).toHaveLength(1);
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
