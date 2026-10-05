import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QuranCloseLine } from "../quran-close-line";

describe("QuranCloseLine", () => {
  it("done: 'Quran today ✓ N pages', no log link", () => {
    render(<QuranCloseLine line={{ kind: "done", pages: 10, text: "Quran today ✓ 10 pages" }} />);
    expect(screen.getByTestId("quran-close-line")).toHaveTextContent("Quran today ✓ 10 pages");
    expect(screen.queryByTestId("quran-close-log")).not.toBeInTheDocument();
  });
  it("not yet: a quiet line with a link to log it on /deen (positive control: done has none)", () => {
    render(<QuranCloseLine line={{ kind: "not_yet", text: "Quran today: not yet. Log it?" }} />);
    expect(screen.getByTestId("quran-close-line")).toHaveAttribute("data-kind", "not_yet");
    expect(screen.getByTestId("quran-close-log")).toHaveAttribute("href", "/deen");
  });
  it("no active plan -> nothing at all", () => {
    const { container } = render(<QuranCloseLine line={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
