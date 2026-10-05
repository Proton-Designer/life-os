import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const keepOrMoveFinishDate = vi.hoisted(() => vi.fn());
vi.mock("@/app/(app)/deen/quran-plan-actions", () => ({ keepOrMoveFinishDate }));

import { QuranDateChoice } from "../quran-date-choice";
import { resetKeyedQueuesForTests } from "@/lib/client/keyed-queue";

beforeEach(() => {
  resetKeyedQueuesForTests();
  keepOrMoveFinishDate.mockReset().mockResolvedValue({ ok: true });
});

const renderIt = () => render(<QuranDateChoice finishDate="2026-12-04" suggestedDate="2026-12-20" todayStr="2026-10-05" />);

describe("QuranDateChoice", () => {
  it("Keep sends null (same date) and shows the date at once", async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByTestId("quran-date-keep"));
    expect(keepOrMoveFinishDate).toHaveBeenCalledWith(null);
    expect(screen.getByTestId("quran-date-chosen")).toHaveTextContent("Dec. 4th");
  });

  it("Move opens a picker pre-filled with the suggestion and sends the chosen date", async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByTestId("quran-date-move"));
    expect(screen.getByLabelText("New finish date")).toHaveValue("2026-12-20");
    await user.click(screen.getByTestId("quran-date-move-confirm"));
    expect(keepOrMoveFinishDate).toHaveBeenCalledWith("2026-12-20");
    expect(screen.getByTestId("quran-date-chosen")).toHaveTextContent("Dec. 20th");
  });

  it("a failed write brings the choice back and says why (positive control: success above)", async () => {
    keepOrMoveFinishDate.mockResolvedValue({ ok: false, message: "Your plan is paused." });
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByTestId("quran-date-keep"));
    await waitFor(() => expect(screen.getByTestId("quran-date-error")).toHaveTextContent("Your plan is paused."));
    expect(screen.getByTestId("quran-date-keep")).toBeInTheDocument();
  });

  it("Move date is disabled for a date that is not after today", async () => {
    const user = userEvent.setup();
    render(<QuranDateChoice finishDate="2026-12-04" suggestedDate={null} todayStr="2026-10-05" />);
    await user.click(screen.getByTestId("quran-date-move"));
    expect(screen.getByTestId("quran-date-move-confirm")).toBeDisabled();
  });
});
