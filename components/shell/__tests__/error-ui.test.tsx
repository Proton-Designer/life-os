import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

import { ErrorState } from "../error-state";
import { InlineErrorBoundary } from "../inline-error-boundary";

function boom(): never {
  throw new Error("secret internals: SELECT * FROM tasks at /srv/app/lib/x.ts:12");
}

describe("ErrorState", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => undefined));

  it("shows a calm message, a Home link and Try again; never the error text or a stack", () => {
    const retry = vi.fn();
    const err = Object.assign(new Error("secret internals: SELECT * FROM tasks"), { digest: "abc123" });
    const { container } = render(<ErrorState error={err} retry={retry} />);
    expect(screen.getByText(/this didn't load/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /go to home/i }).getAttribute("href")).toBe("/");
    expect(screen.getByText(/Reference: abc123/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/secret internals|SELECT|\.ts:/);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("logs the error to the console", () => {
    const err = new Error("x");
    render(<ErrorState error={err} retry={() => undefined} />);
    expect(console.error).toHaveBeenCalledWith(err);
  });
});

describe("InlineErrorBoundary", () => {
  beforeEach(() => {
    refresh.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("a throwing module becomes a small card while its siblings keep rendering", () => {
    function Bad(): React.ReactNode {
      return boom();
    }
    const { container } = render(
      <div>
        <p>sibling module</p>
        <InlineErrorBoundary label="Sector progress">
          <Bad />
        </InlineErrorBoundary>
      </div>
    );
    expect(screen.getByText("sibling module")).toBeTruthy();
    expect(screen.getByText("Sector progress didn't load")).toBeTruthy();
    expect(container.textContent).not.toMatch(/secret internals/);
  });

  it("positive control: the same throw WITHOUT the boundary takes the whole tree down", () => {
    function Bad(): React.ReactNode {
      return boom();
    }
    expect(() =>
      render(
        <div>
          <p>sibling module</p>
          <Bad />
        </div>
      )
    ).toThrow(/secret internals/);
  });

  it("Try again refreshes the page data and re-renders the module", () => {
    let fail = true;
    function Flaky() {
      if (fail) return boom();
      return <p>module back</p>;
    }
    render(
      <InlineErrorBoundary label="Rhythm">
        <Flaky />
      </InlineErrorBoundary>
    );
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText("module back")).toBeTruthy();
  });
});
