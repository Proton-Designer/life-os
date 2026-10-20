import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RsvpView, splitAtOrp } from "../rsvp-view";

describe("splitAtOrp", () => {
  it("splits at the optimal recognition point", () => {
    expect(splitAtOrp("Welcome")).toEqual({ before: "We", focal: "l", after: "come" });
    expect(splitAtOrp("a")).toEqual({ before: "", focal: "a", after: "" });
    expect(splitAtOrp("the")).toEqual({ before: "t", focal: "h", after: "e" });
    expect(splitAtOrp('"reader,')).toEqual({ before: '"re', focal: "a", after: "der," });
    expect(splitAtOrp("")).toEqual({ before: "", focal: "", after: "" });
  });
  it("round-trips: the three parts always rebuild the word", () => {
    for (const w of ["internationalization", "I'm", "—", "naïve", "(x)", "😀ok"]) {
      const s = splitAtOrp(w);
      expect(s.before + s.focal + s.after).toBe(w);
    }
  });
});

describe("RsvpView", () => {
  it("renders the focal letter in its own element, the word as the accessible name, and context", () => {
    render(<RsvpView word="Welcome" before={["to", "the"]} after={["reader", "now"]} fontScale={1} focalLines />);
    expect(screen.getByTestId("rsvp-focal")).toHaveTextContent("l");
    expect(screen.getByTestId("rsvp-word")).toHaveAttribute("aria-label", "Welcome");
    expect(screen.getByTestId("rsvp-context")).toHaveTextContent("to the Welcome reader now");
    expect(screen.getByTestId("focal-lines")).toBeInTheDocument();
  });
  it("hides the guide lines when turned off", () => {
    render(<RsvpView word="Welcome" before={[]} after={[]} fontScale={1} focalLines={false} />);
    expect(screen.queryByTestId("focal-lines")).not.toBeInTheDocument();
  });
  it("keeps the focal letter in the middle column however the word is padded", () => {
    const { rerender } = render(<RsvpView word="a" before={[]} after={[]} fontScale={1} focalLines />);
    const col = (el: HTMLElement) => Array.from(el.parentElement!.children).indexOf(el);
    expect(col(screen.getByTestId("rsvp-focal"))).toBe(1);
    rerender(<RsvpView word="internationalization" before={[]} after={[]} fontScale={1} focalLines />);
    expect(col(screen.getByTestId("rsvp-focal"))).toBe(1);
    expect(screen.getByTestId("rsvp-word").className).toContain("grid-cols-[1fr_auto_1fr]");
  });
});
