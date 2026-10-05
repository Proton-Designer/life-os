import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const logQuranReading = vi.hoisted(() => vi.fn());
vi.mock("@/app/(app)/deen/quran-plan-actions", () => ({ logQuranReading }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

import { QuranNowRow } from "../quran-now-row";
import { resetKeyedQueuesForTests } from "@/lib/client/keyed-queue";

const ITEM = { title: "Quran · pages 41–50", from: 41, to: 50, pages: 10, surahLabel: "Al-Baqarah", juz: 2, done: false };

beforeEach(() => {
  resetKeyedQueuesForTests();
  logQuranReading.mockReset().mockResolvedValue({ ok: true });
});

describe("QuranNowRow", () => {
  it("shows the pages with surah and juz, linking to /deen", () => {
    render(<QuranNowRow item={ITEM} />);
    expect(screen.getByText("Quran · pages 41–50")).toBeInTheDocument();
    expect(screen.getByText("Al-Baqarah · Juz 2")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/deen");
  });

  it("shows 'Juz a–b' when the portion spans several juz (and a single 'Juz n' otherwise)", () => {
    const { unmount } = render(<QuranNowRow item={{ ...ITEM, juz: 1, juzFrom: 1, juzTo: 10 }} />);
    expect(screen.getByText("Al-Baqarah · Juz 1–10")).toBeInTheDocument();
    unmount();
    render(<QuranNowRow item={{ ...ITEM, juzFrom: 2, juzTo: 2 }} />);
    expect(screen.getByText("Al-Baqarah · Juz 2")).toBeInTheDocument();
  });

  it("one tap ticks the row at once and logs today's portion", async () => {
    const user = userEvent.setup();
    render(<QuranNowRow item={ITEM} />);
    await user.click(screen.getByTestId("quran-now-read"));
    expect(screen.getByTestId("quran-now-done")).toBeInTheDocument();
    expect(screen.queryByTestId("quran-now-read")).not.toBeInTheDocument();
    expect(logQuranReading).toHaveBeenCalledWith({ todaysPortion: true });
  });

  it("a failed write un-ticks the row and shows why (positive control: the same tap succeeds above)", async () => {
    logQuranReading.mockResolvedValue({ ok: false, message: "Your plan is paused." });
    const user = userEvent.setup();
    render(<QuranNowRow item={ITEM} />);
    await user.click(screen.getByTestId("quran-now-read"));
    await waitFor(() => expect(screen.getByTestId("quran-now-error")).toHaveTextContent("Your plan is paused."));
    expect(screen.getByTestId("quran-now-read")).toBeInTheDocument();
  });

  it("starts ticked when today's portion is already read", () => {
    render(<QuranNowRow item={{ ...ITEM, done: true }} />);
    expect(screen.getByTestId("quran-now-done")).toBeInTheDocument();
    expect(screen.queryByTestId("quran-now-read")).not.toBeInTheDocument();
  });
});
