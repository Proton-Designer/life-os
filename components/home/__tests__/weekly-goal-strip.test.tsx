import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Real next/link never forwards `prefetch` to the DOM (destructured out,
// consumed internally — see node_modules/next/dist/client/app-dir/link.js),
// so intercept it before Link eats it. Mirrors real rendering for every
// other prop this file's other assertions rely on.
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

import { WeeklyGoalStrip } from "../weekly-goal-strip";

describe("WeeklyGoalStrip", () => {
  it("shows the 'This week' label", () => {
    render(<WeeklyGoalStrip deen={{ headline: "Finish Juz 5" }} business={null} />);
    expect(screen.getByText("This week")).toBeInTheDocument();
  });

  it("shows both headlines when both goals are set", () => {
    render(
      <WeeklyGoalStrip
        deen={{ headline: "Finish Juz 5" }}
        business={{ headline: "Close 3 deals" }}
      />
    );
    expect(screen.getByText("Finish Juz 5")).toBeInTheDocument();
    expect(screen.getByText("Close 3 deals")).toBeInTheDocument();
  });

  it("prompts for the missing domain when only Deen is set", () => {
    render(<WeeklyGoalStrip deen={{ headline: "Finish Juz 5" }} business={null} />);
    expect(screen.getByText("Finish Juz 5")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set this week's Business goal →" })).toBeInTheDocument();
  });

  it("prompts for the missing domain when only Business is set", () => {
    render(<WeeklyGoalStrip deen={null} business={{ headline: "Close 3 deals" }} />);
    expect(screen.getByText("Close 3 deals")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set this week's Deen goal →" })).toBeInTheDocument();
  });

  it("collapses to a single recruiting line when neither goal is set, rather than two prompts", () => {
    render(<WeeklyGoalStrip deen={null} business={null} />);
    expect(screen.getByRole("link", { name: "Set this week's goals →" })).toBeInTheDocument();
    expect(screen.queryByText(/Set this week's Deen goal/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Set this week's Business goal/)).not.toBeInTheDocument();
  });

  it("all links go to /weekly-planning and prefetch", () => {
    render(<WeeklyGoalStrip deen={{ headline: "Finish Juz 5" }} business={null} />);
    for (const link of screen.getAllByRole("link")) {
      expect(link).toHaveAttribute("href", "/weekly-planning");
      expect(link).toHaveAttribute("data-prefetch", "true");
    }
  });

  it("meets the 44px minimum tap target on every link, new-code bar per spec", () => {
    render(
      <WeeklyGoalStrip
        deen={{ headline: "Finish Juz 5" }}
        business={{ headline: "Close 3 deals" }}
      />
    );
    for (const link of screen.getAllByRole("link")) {
      expect(link.className).toMatch(/min-h-11/);
    }
  });

  it("wraps headline text in a single-line truncating span, so a long headline never wraps to a third line", () => {
    render(<WeeklyGoalStrip deen={{ headline: "Finish Juz 5" }} business={null} />);
    const headline = screen.getByText("Finish Juz 5");
    expect(headline.className).toMatch(/truncate/);
  });

  it("uses the domain accent color on an unset prompt", () => {
    render(<WeeklyGoalStrip deen={null} business={{ headline: "Close 3 deals" }} />);
    const prompt = screen.getByRole("link", { name: "Set this week's Deen goal →" });
    expect(prompt.className).toContain("text-accent-deen");
  });

  it("uses the domain accent color on a set headline too — with no labels or icons in the strip, color is the only thing that says which goal is which", () => {
    render(
      <WeeklyGoalStrip
        deen={{ headline: "Finish Juz 5" }}
        business={{ headline: "Close 3 deals" }}
      />
    );
    expect(screen.getByRole("link", { name: "Finish Juz 5" }).className).toContain("text-accent-deen");
    expect(screen.getByRole("link", { name: "Close 3 deals" }).className).toContain("text-accent-business");
  });

  it("does not force an equal 50/50 split between slots — a short headline shouldn't reserve space it doesn't need", () => {
    render(
      <WeeklyGoalStrip
        deen={{ headline: "Finish Juz 5" }}
        business={{ headline: "Close 3 deals" }}
      />
    );
    expect(screen.getByRole("link", { name: "Finish Juz 5" }).className).not.toMatch(/\bflex-1\b/);
    expect(screen.getByRole("link", { name: "Close 3 deals" }).className).not.toMatch(/\bflex-1\b/);
  });

  it("stacks the goal slots into their own full-width lines below lg, rather than splitting narrow width between them", () => {
    render(
      <WeeklyGoalStrip
        deen={{ headline: "Finish Juz 5" }}
        business={{ headline: "Close 3 deals" }}
      />
    );
    const row = screen.getByRole("link", { name: "Finish Juz 5" }).parentElement;
    expect(row?.className).toMatch(/flex-col/);
    expect(row?.className).toMatch(/lg:flex-row/);
  });
});
