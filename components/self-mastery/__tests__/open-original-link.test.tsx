import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { safeOriginalUrl } from "@/lib/self-mastery/types";
import { OpenOriginalLink } from "../open-original-link";

describe("safeOriginalUrl", () => {
  it("keeps http(s) only (positive control: javascript:, data:, file:, junk and empty are dropped)", () => {
    expect(safeOriginalUrl("https://www.example.com/a?b=1")).toBe("https://www.example.com/a?b=1");
    expect(safeOriginalUrl("http://example.com/")).toBe("http://example.com/");
    for (const bad of ["javascript:alert(1)", "data:text/html,hi", "file:///etc/passwd", "ftp://x.test", "not a url", "", null, undefined]) {
      expect(safeOriginalUrl(bad as string | null), String(bad)).toBeNull();
    }
  });
});

describe("OpenOriginalLink", () => {
  it("opens the original in a new tab without leaking the opener", () => {
    render(<OpenOriginalLink url="https://www.example.com/post" />);
    const a = screen.getByTestId("open-original");
    expect(a).toHaveAttribute("href", "https://www.example.com/post");
    expect(a).toHaveAttribute("target", "_blank");
    expect(a).toHaveAttribute("rel", "noopener noreferrer");
    expect(a).toHaveTextContent("Open original (example.com)");
  });
  it("renders nothing without a url", () => {
    const { container } = render(<OpenOriginalLink url={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
