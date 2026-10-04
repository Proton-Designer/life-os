// @vitest-environment node
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/shell/page-container", () => ({ PageContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/shell/page-header", () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
const data = {
  blockers: [],
  blockingItems: [],
  reviewGroups: [],
  todaysThree: [],
  hoursTodayMinutes: 0,
  weekdayBaselines: null,
  weekdayIndex: 1,
  deltaMinutes: null,
  activeHabits: [],
  tomorrowLines: [],
  planSeeds: [],
};
vi.mock("../actions", () => ({ getEveningCloseData: async () => data }));
vi.mock("@/lib/promotions/read", () => ({
  getDuePromotions: () => new Promise((r) => setTimeout(() => r([{ id: "p1" }]), 40)),
}));
vi.mock("@/lib/inbox/close-inbox", () => ({
  loadCloseInbox: () => new Promise((r) => setTimeout(() => r({ items: [], areas: [] }), 40)),
}));
vi.mock("@/components/evening-close/close-account-stage", () => ({ CloseAccountStage: () => <section>ACCOUNT-STAGE</section> }));
vi.mock("@/components/evening-close/close-reflect-stage", () => ({ CloseReflectStage: () => <section>REFLECT-STAGE</section> }));
vi.mock("@/components/evening-close/close-plan-stage", () => ({ ClosePlanStage: () => <section>PLAN-STAGE</section> }));
vi.mock("@/components/promotions/verdict-card", () => ({ VerdictDueList: () => <section>VERDICTS</section> }));

import EveningClosePage from "../page";

describe("/close stream wiring (NAV-01b)", () => {
  it("Account + Reflect paint in the first flush; promotions and the Inbox/plan stage stream in behind a skeleton", async () => {
    const reader = (await renderToReadableStream(await EveningClosePage())).getReader();
    const dec = new TextDecoder();
    let out = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out += dec.decode(value);
    }
    const at = (needle: string) => out.indexOf(needle);
    expect(at("ACCOUNT-STAGE")).toBeGreaterThan(-1);
    expect(at("REFLECT-STAGE")).toBeGreaterThan(-1);
    // the plan stage's skeleton sits where the stage will be (before the streamed content), and the
    // slow modules' real content arrives after the shell's own stages
    expect(at('data-slot="skeleton"')).toBeGreaterThan(at("REFLECT-STAGE"));
    expect(at("PLAN-STAGE")).toBeGreaterThan(at('data-slot="skeleton"'));
    expect(at("VERDICTS")).toBeGreaterThan(at("REFLECT-STAGE"));
  });
});
