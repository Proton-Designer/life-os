import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { InProgressBanner } from "../in-progress-banner";

describe("InProgressBanner", () => {
  it("renders nothing when there's nothing in progress", () => {
    const { container } = render(<InProgressBanner items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders each item's title, status, and links to its detail page", () => {
    render(
      <InProgressBanner
        items={[{ id: "book-1", title: "Atomic Habits", statusLabel: "Reading your book", progressPct: 12, href: "/personal/self_mastery/book-1" }]}
      />
    );
    expect(screen.getByText("Atomic Habits")).toBeInTheDocument();
    expect(screen.getByText("Reading your book")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/personal/self_mastery/book-1");
  });
});
