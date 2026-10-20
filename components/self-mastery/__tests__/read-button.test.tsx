import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReadButton } from "../read-button";

describe("ReadButton", () => {
  it("says Read before a bookmark, Continue at 0%, and Continue · N% once there is progress", () => {
    const { rerender } = render(<ReadButton bookId="b" progressPct={null} started={false} />);
    expect(screen.getByTestId("read-book")).toHaveTextContent(/^Read$/);
    rerender(<ReadButton bookId="b" progressPct={0} started />);
    expect(screen.getByTestId("read-book")).toHaveTextContent(/^Continue$/);
    rerender(<ReadButton bookId="b" progressPct={37} started />);
    expect(screen.getByTestId("read-book")).toHaveTextContent("Continue · 37%");
  });
});
