import { describe, expect, it, vi, beforeEach } from "vitest";

const getFaithPractices = vi.fn(async () => [{ id: "p1" }]);
let deenOn = true;

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({})) }));
vi.mock("@/lib/supabase/auth", () => ({
  getAuthedUser: vi.fn(async () => ({ id: "u1" })),
  getProfile: vi.fn(async () => ({ timezone: "UTC", deen_mode: deenOn })),
}));
vi.mock("@/lib/deen/deen-mode", () => ({ isDeenModeOn: () => deenOn }));
vi.mock("@/lib/deen/practices", () => ({ getFaithPractices: (...a: unknown[]) => (getFaithPractices as (...x: unknown[]) => unknown)(...a) }));
vi.mock("@/lib/habits/queries", () => ({ getActiveHabitsWithStatus: vi.fn(async () => []), getPausedHabits: vi.fn(async () => []) }));
vi.mock("@/app/(app)/page-layout-actions", () => ({ getPageLayout: vi.fn(async () => []) }));
vi.mock("@/components/habits/habit-list", () => ({ HabitList: () => null }));
vi.mock("@/components/page-layout/widget-manager-button", () => ({ WidgetManagerButton: () => null }));
vi.mock("@/components/page-layout/layout-slot", () => ({
  LayoutSlot: ({ children }: { children: unknown }) => children,
  buildLayoutMap: () => ({}),
  allWidgetsHidden: () => false,
}));

function findHabitList(node: unknown): { props: Record<string, unknown> } | null {
  if (!node || typeof node !== "object") return null;
  const n = node as { type?: unknown; props?: { children?: unknown } };
  if (typeof n.type === "function" && (n.type as { name?: string }).name === "HabitList") return n as { props: Record<string, unknown> };
  const kids = n.props?.children;
  for (const c of Array.isArray(kids) ? kids : [kids]) {
    const f = findHabitList(c);
    if (f) return f;
  }
  return null;
}

describe("HabitsSection Faith practices (HABITS-01)", () => {
  beforeEach(() => getFaithPractices.mockClear());

  it("Faith ON reads the practices and passes them to the list (positive control)", async () => {
    deenOn = true;
    const { HabitsSection } = await import("../habits-section");
    const tree = await HabitsSection();
    expect(getFaithPractices).toHaveBeenCalledTimes(1);
    expect(findHabitList(tree)?.props.faithPractices).toEqual([{ id: "p1" }]);
  });

  it("Faith OFF never calls the reader and passes none", async () => {
    deenOn = false;
    const { HabitsSection } = await import("../habits-section");
    const tree = await HabitsSection();
    expect(getFaithPractices).not.toHaveBeenCalled();
    expect(findHabitList(tree)?.props.faithPractices).toEqual([]);
  });
});
