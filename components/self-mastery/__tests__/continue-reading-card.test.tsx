import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ContinueReadingCard } from "../continue-reading-card";

describe("ContinueReadingCard", () => {
  it("links to the reader and shows progress, words vs goal and streak", () => {
    render(<ContinueReadingCard reading={{ bookId: "b1", title: "Deep Work", progressPct: 42, todayWords: 320, dailyWordGoal: 1000, streak: 3 }} />);
    const card = screen.getByTestId("continue-reading-card");
    expect(card).toHaveAttribute("href", "/read/b1");
    expect(card).toHaveTextContent("Continue reading: Deep Work");
    expect(card).toHaveTextContent("42% read · 320 / 1,000 words today · 3-day streak");
  });
  it("omits what is unknown", () => {
    render(<ContinueReadingCard reading={{ bookId: "b1", title: "X", progressPct: null, todayWords: 0, dailyWordGoal: null, streak: 0 }} />);
    expect(screen.getByTestId("continue-reading-card")).toHaveTextContent("0 words today");
    expect(screen.getByTestId("continue-reading-card")).not.toHaveTextContent("streak");
  });
  it("renders nothing without a book", () => {
    const { container } = render(<ContinueReadingCard reading={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
