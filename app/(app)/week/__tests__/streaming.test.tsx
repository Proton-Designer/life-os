// @vitest-environment node
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/supabase/auth", () => ({ getAuthedUser: async () => ({ id: "u1" }) }));
vi.mock("@/components/shell/page-container", () => ({ PageContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/shell/page-header", () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
const { fast, slow } = vi.hoisted(() => ({
  fast: (id: string) => () => <div data-testid={id}>{id}</div>,
  slow: (id: string) => async () => {
    await new Promise((r) => setTimeout(r, 40));
    return <div data-testid={id}>{id}</div>;
  },
}));
vi.mock("@/components/weekly-review/weekly-review-body", () => ({ WeeklyReviewBody: fast("s-review") }));
vi.mock("@/components/goals/goals-section", () => ({ GoalsSection: slow("s-goals") }));
vi.mock("@/components/habits/habits-section", () => ({ HabitsSection: fast("s-habits") }));
vi.mock("@/components/worries/worries-section", () => ({ WorriesSection: fast("s-worries") }));
vi.mock("@/components/week/weekly-goal-step", () => ({ WeeklyGoalStep: fast("s-goal") }));

import WeekPage from "../page";

async function html(node: React.ReactElement): Promise<string> {
  const reader = (await renderToReadableStream(node)).getReader();
  const dec = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out;
    out += dec.decode(value);
  }
}

// NAV-01b: each /week step streams in its own Suspense, so the title, the step chips and the fast steps
// paint at once while a slow step shows a card skeleton and fills in afterwards.
describe("/week stream wiring", () => {
  it("a slow step does not hold the others: its skeleton is in place, its content arrives AFTER the later steps", async () => {
    const out = await html(await WeekPage());
    expect(out).toContain("Weekly reset");
    const skeleton = out.indexOf('data-slot="skeleton"');
    const lastFast = out.indexOf('data-testid="s-goal"');
    const slowContent = out.indexOf('data-testid="s-goals"');
    expect(skeleton).toBeGreaterThan(-1);
    expect(lastFast).toBeGreaterThan(-1);
    expect(slowContent).toBeGreaterThan(-1); // it does arrive
    expect(skeleton).toBeLessThan(lastFast); // skeleton sits at the slow step's position, before the later steps
    expect(slowContent).toBeGreaterThan(lastFast); // streamed in after them (positive control: inline-awaiting would keep document order)
  });
});
