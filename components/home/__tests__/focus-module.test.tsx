import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/business/actions", () => ({
  startWorkSession: vi.fn(),
}));

// Real next/link never forwards `prefetch` to the DOM (destructured out,
// consumed internally), so intercept it before Link eats it. Mirrors real
// rendering for every other prop this file's other assertions rely on.
vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: React.forwardRef(function MockLink(
      { href, prefetch, children, ...rest }: React.ComponentPropsWithoutRef<"a"> & { prefetch?: unknown },
      ref: React.Ref<HTMLAnchorElement>
    ) {
      return (
        <a ref={ref} href={href} data-prefetch={String(prefetch)} {...rest}>
          {children}
        </a>
      );
    }),
  };
});

import { startWorkSession } from "@/app/(app)/business/actions";
import { FocusModule } from "../focus-module";

describe("FocusModule", () => {
  it("shows today's focus total when idle", () => {
    render(<FocusModule focusMinutesToday={85} sessionCount={2} activeSession={null} />);
    expect(screen.getByText("1h 25m")).toBeInTheDocument();
  });

  it("shows a real 0m total rather than omitting it when nothing's logged yet", () => {
    render(<FocusModule focusMinutesToday={0} sessionCount={0} activeSession={null} />);
    expect(screen.getByText("0m")).toBeInTheDocument();
  });

  it("shows a no-sessions caption when idle with zero sessions today", () => {
    render(<FocusModule focusMinutesToday={0} sessionCount={0} activeSession={null} />);
    expect(screen.getByText("No Lock-In sessions yet today")).toBeInTheDocument();
  });

  it("shows a pluralized session-count caption when idle with sessions today", () => {
    render(<FocusModule focusMinutesToday={45} sessionCount={2} activeSession={null} />);
    expect(screen.getByText("2 Lock-In sessions")).toBeInTheDocument();
  });

  it("shows the Lock In button when idle", () => {
    render(<FocusModule focusMinutesToday={0} sessionCount={0} activeSession={null} />);
    expect(screen.getByRole("button", { name: "Lock In" })).toBeInTheDocument();
  });

  it("swaps to the active view after Lock In resolves, without a page reload", async () => {
    vi.mocked(startWorkSession).mockResolvedValue({
      id: "s1",
      startedAt: "2026-08-17T22:00:00Z",
    });
    const user = userEvent.setup();
    render(<FocusModule focusMinutesToday={0} sessionCount={0} activeSession={null} />);

    await user.click(screen.getByRole("button", { name: "Lock In" }));

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Open session →" })).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Lock In" })).not.toBeInTheDocument();
  });

  it("renders the active view directly when an active session is passed in", () => {
    render(
      <FocusModule
        focusMinutesToday={30}
        sessionCount={1}
        activeSession={{ id: "s1", startedAtIso: "2026-08-17T22:00:00Z" }}
      />
    );
    expect(screen.getByRole("link", { name: "Open session →" })).toHaveAttribute("href", "/business");
    expect(screen.queryByRole("button", { name: "Lock In" })).not.toBeInTheDocument();
  });

  it("prefetches the Open session link (navigation-prefetch-fix, Part A)", () => {
    render(
      <FocusModule
        focusMinutesToday={30}
        sessionCount={1}
        activeSession={{ id: "s1", startedAtIso: "2026-08-17T22:00:00Z" }}
      />
    );
    expect(screen.getByRole("link", { name: "Open session →" })).toHaveAttribute("data-prefetch", "true");
  });
});
