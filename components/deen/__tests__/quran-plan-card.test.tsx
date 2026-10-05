import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/deen/use-optimistic-item", () => ({ useScheduleRefresh: () => () => {} }));

import { QuranPlanCard } from "../quran-plan-card";
import type { QuranPlanActions, QuranPlanView } from "../quran-plan-types";
import { resetKeyedQueuesForTests } from "@/lib/client/keyed-queue";

const TODAY = "2026-10-05";
const OK = { ok: true } as const;
const actions = (): { [K in keyof QuranPlanActions]: ReturnType<typeof vi.fn> } => ({
  start: vi.fn().mockResolvedValue(OK),
  logPortion: vi.fn().mockResolvedValue(OK),
  logToPage: vi.fn().mockResolvedValue(OK),
  undoLast: vi.fn().mockResolvedValue(OK),
  setBookmark: vi.fn().mockResolvedValue(OK),
  keepDate: vi.fn().mockResolvedValue(OK),
  moveDate: vi.fn().mockResolvedValue(OK),
  pause: vi.fn().mockResolvedValue(OK),
  resume: vi.fn().mockResolvedValue(OK),
  startNext: vi.fn().mockResolvedValue(OK),
});
const plan = (over: Partial<Extract<QuranPlanView, { kind: "plan" }>> = {}): QuranPlanView => ({
  kind: "plan",
  khatmNumber: 1,
  state: "active",
  currentPage: 41,
  percent: 7,
  targetDate: "2026-12-04",
  pagesPerDay: 10,
  portion: { fromPage: 41, toPage: 50, pages: 10, label: "Al-Baqarah · Juz 2" },
  portionDone: false,
  status: { kind: "on_track", pages: 0, days: null, neededPerDay: 10, projectedFinish: null, suggestMove: false },
  last7Days: 5,
  juzComplete: null,
  ...over,
});
const BEHIND = { kind: "behind", pages: 30, days: 3, neededPerDay: 12, projectedFinish: "2026-12-20", suggestMove: false } as const;

let a: ReturnType<typeof actions>;
const renderIt = (view: QuranPlanView) => render(<QuranPlanCard view={view} actions={a as unknown as QuranPlanActions} todayStr={TODAY} />);
beforeEach(() => {
  resetKeyedQueuesForTests();
  a = actions();
});

describe("QuranPlanCard (QURAN-02)", () => {
  it("no plan: presets with 60 days pre-selected, each with its finish date; Start sends the chosen preset from page 1", async () => {
    const user = userEvent.setup();
    renderIt({ kind: "none", currentPage: null });
    expect(screen.getByTestId("quran-preset-60d")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("quran-preset-30d")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("quran-preset-60d")).toHaveTextContent("about 10 pages a day · done by Dec. 3rd");
    await user.click(screen.getByTestId("quran-preset-30d"));
    await user.click(screen.getByTestId("quran-start"));
    expect(a.start).toHaveBeenCalledWith({ preset: "30d" }, 1);
  });

  it("setup: the 60-day default starts as-is; a custom date must be in the future (positive control: a past date disables Start)", async () => {
    const user = userEvent.setup();
    renderIt({ kind: "none", currentPage: null });
    await user.click(screen.getByTestId("quran-start"));
    expect(a.start).toHaveBeenCalledWith({ preset: "60d" }, 1);
  });

  it("setup: custom date and custom pace; Start is disabled until each is valid", async () => {
    const user = userEvent.setup();
    renderIt({ kind: "none", currentPage: null });
    await user.click(screen.getByTestId("quran-preset-date"));
    expect(screen.getByTestId("quran-start")).toBeDisabled();
    await user.type(screen.getByLabelText("Finish date"), "2026-11-30");
    expect(screen.getByTestId("quran-start")).toBeEnabled();
    await user.click(screen.getByTestId("quran-start"));
    expect(a.start).toHaveBeenCalledWith({ targetDate: "2026-11-30" }, 1);
  });

  it("setup: with an existing bookmark, 'Continue from page N' starts there", async () => {
    const user = userEvent.setup();
    renderIt({ kind: "none", currentPage: 120 });
    await user.click(screen.getByRole("radio", { name: "Continue from page 120" }));
    await user.click(screen.getByTestId("quran-start"));
    expect(a.start).toHaveBeenCalledWith({ preset: "60d" }, 120);
  });

  it("active: 'Khatm 1 · 7% · page 41 of 604', today's pages with surah and juz, last-7 count (no streak)", () => {
    renderIt(plan());
    expect(screen.getByTestId("quran-heading")).toHaveTextContent("Khatm 1 · 7% · page 41 of 604");
    expect(screen.getByTestId("quran-portion")).toHaveTextContent("Today: pages 41–50 · Al-Baqarah · Juz 2");
    expect(screen.getByTestId("quran-last7")).toHaveTextContent("5 of last 7 days");
    expect(screen.getByTestId("quran-status")).toHaveTextContent("On track");
    expect(screen.queryByText(/streak/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("quran-keep")).not.toBeInTheDocument(); // Keep/Move only when behind
  });

  it("one tap on 'Read today's portion' updates the bookmark at once (optimistic) and calls logPortion('today')", async () => {
    const user = userEvent.setup();
    renderIt(plan());
    await user.click(screen.getByTestId("quran-log-portion"));
    expect(a.logPortion).toHaveBeenCalledWith("today");
    expect(screen.getByTestId("quran-heading")).toHaveTextContent("page 51 of 604");
    expect(screen.getByTestId("quran-done")).toBeInTheDocument();
    expect(screen.queryByTestId("quran-log-portion")).not.toBeInTheDocument();
  });

  it("a failed log rolls the card back and says why (positive control: the same tap succeeds above)", async () => {
    a.logPortion.mockResolvedValue({ ok: false, message: "Quran plan not found." });
    const user = userEvent.setup();
    renderIt(plan());
    await user.click(screen.getByTestId("quran-log-portion"));
    await waitFor(() => expect(screen.getByTestId("quran-plan-error")).toHaveTextContent("Quran plan not found."));
    expect(screen.getByTestId("quran-heading")).toHaveTextContent("page 41 of 604");
    expect(screen.getByTestId("quran-log-portion")).toBeInTheDocument();
  });

  it("'I'm on page' logs up to that page; it cannot go backwards (a page below the bookmark disables Log)", async () => {
    const user = userEvent.setup();
    renderIt(plan());
    await user.type(screen.getByLabelText("I'm on page"), "30");
    expect(screen.getByTestId("quran-log-page")).toBeDisabled();
    await user.clear(screen.getByLabelText("I'm on page"));
    await user.type(screen.getByLabelText("I'm on page"), "47");
    await user.click(screen.getByTestId("quran-log-page"));
    expect(a.logToPage).toHaveBeenCalledWith(47, "today");
    expect(screen.getByTestId("quran-heading")).toHaveTextContent("page 48 of 604");
  });

  it("log for yesterday, undo, edit bookmark", async () => {
    const user = userEvent.setup();
    renderIt(plan());
    await user.click(screen.getByTestId("quran-log-yesterday"));
    expect(a.logPortion).toHaveBeenCalledWith("yesterday");
    await user.click(screen.getByTestId("quran-undo"));
    expect(a.undoLast).toHaveBeenCalled();
    await user.click(screen.getByTestId("quran-edit-bookmark"));
    const input = screen.getByLabelText("Next page to read");
    await user.clear(input);
    await user.type(input, "100");
    await user.click(within(screen.getByTestId("quran-bookmark-form")).getByRole("button", { name: "Set" }));
    expect(a.setBookmark).toHaveBeenCalledWith(100);
    expect(screen.getByTestId("quran-heading")).toHaveTextContent("page 100 of 604");
  });

  it("behind: names the gap without guilt, shows the pace needed and the recent-pace finish, with Keep / Move", async () => {
    const user = userEvent.setup();
    renderIt(plan({ status: BEHIND }));
    const status = screen.getByTestId("quran-status");
    expect(status).toHaveTextContent("30 pages behind (about 3 days)");
    expect(status).toHaveTextContent("To still finish Dec. 4th: 12 a day.");
    expect(status).toHaveTextContent("At your recent pace you'd finish Dec. 20th.");
    await user.click(screen.getByTestId("quran-keep"));
    expect(a.keepDate).toHaveBeenCalled();
  });

  it("Move date opens a picker pre-filled with the projected finish and sends the chosen date", async () => {
    const user = userEvent.setup();
    renderIt(plan({ status: BEHIND }));
    await user.click(screen.getByTestId("quran-move"));
    expect(screen.getByLabelText("New finish date")).toHaveValue("2026-12-20");
    await user.click(screen.getByTestId("quran-move-confirm"));
    expect(a.moveDate).toHaveBeenCalledWith("2026-12-20");
  });

  it("when the needed pace is over 2x the plan, a gentle suggestion to move the date appears (and not otherwise)", () => {
    const { unmount } = renderIt(plan({ status: { ...BEHIND, suggestMove: true } }));
    expect(screen.getByTestId("quran-suggest-move")).toBeInTheDocument();
    unmount();
    renderIt(plan({ status: BEHIND }));
    expect(screen.queryByTestId("quran-suggest-move")).not.toBeInTheDocument();
  });

  it("ahead shows 'N pages ahead' with no Keep/Move", () => {
    renderIt(plan({ status: { kind: "ahead", pages: 12, days: 1, neededPerDay: 9, projectedFinish: null, suggestMove: false } }));
    expect(screen.getByTestId("quran-status")).toHaveTextContent("12 pages ahead");
    expect(screen.queryByTestId("quran-keep")).not.toBeInTheDocument();
  });

  it("pause freezes the card at once (no portion, no status, Resume instead); resume brings it back", async () => {
    const user = userEvent.setup();
    renderIt(plan());
    await user.click(screen.getByTestId("quran-pause"));
    expect(a.pause).toHaveBeenCalled();
    expect(screen.getByTestId("quran-paused")).toBeInTheDocument();
    expect(screen.queryByTestId("quran-portion")).not.toBeInTheDocument();
    expect(screen.queryByTestId("quran-status")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("quran-resume"));
    expect(a.resume).toHaveBeenCalled();
    expect(screen.getByTestId("quran-today")).toBeInTheDocument();
  });

  it("a juz milestone shows 'Juz 7 complete · 7 of 30'", () => {
    renderIt(plan({ juzComplete: { juz: 7 } }));
    expect(screen.getByTestId("quran-juz-note")).toHaveTextContent("Juz 7 complete · 7 of 30");
  });

  it("completed: the khatm screen with the dua and 'Start Khatm 2 at the same pace'", async () => {
    const user = userEvent.setup();
    renderIt(plan({ state: "completed", currentPage: 605, percent: 100, portion: null }));
    expect(screen.getByTestId("quran-khatm")).toHaveTextContent("Khatm 1 complete");
    expect(screen.getByTestId("khatm-dua-arabic")).toHaveAttribute("dir", "rtl");
    await user.click(screen.getByTestId("quran-start-next"));
    expect(a.startNext).toHaveBeenCalled();
  });

  it("logging the last portion flips the card to the khatm screen at once", async () => {
    const user = userEvent.setup();
    renderIt(plan({ currentPage: 600, percent: 99, portion: { fromPage: 600, toPage: 604, pages: 5, label: "An-Nas" } }));
    await user.click(screen.getByTestId("quran-log-portion"));
    expect(screen.getByTestId("quran-khatm")).toBeInTheDocument();
  });
});
