import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Skeleton } from "@/components/ui/skeleton";
import { FormSkeleton, PillRowSkeleton } from "../route-skeleton";
import WeekLoading from "@/app/(app)/week/loading";
import CloseLoading from "@/app/(app)/close/loading";
import SelfMasteryLoading from "@/app/(app)/self-mastery/loading";
import BookLoading from "@/app/(app)/self-mastery/[bookId]/loading";
import OnboardingLoading from "@/app/(app)/onboarding/loading";
import CaptureLoading from "@/app/(capture)/capture/loading";

describe("skeleton motion (NAV-01b)", () => {
  it("the shimmer pulse is switched off for prefers-reduced-motion", () => {
    const { container } = render(<Skeleton />);
    expect(container.firstElementChild!.className).toContain("animate-pulse");
    expect(container.firstElementChild!.className).toContain("motion-reduce:animate-none");
  });

  it("the composed pieces carry the delayed fade-in root (a fast route never flashes a skeleton)", () => {
    const { container: a } = render(<PillRowSkeleton count={3} />);
    expect(a.firstElementChild!.className).toContain("route-skeleton-fade-in");
    expect(a.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(3);
    const { container: b } = render(<FormSkeleton fields={2} />);
    expect(b.firstElementChild!.className).toContain("route-skeleton-fade-in");
    expect(b.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThanOrEqual(5); // 2 labels + 2 inputs + button
  });
});

describe("new loading.tsx files render the shape of their page", () => {
  it.each([
    ["week", WeekLoading, /Weekly reset/],
    ["close", CloseLoading, /Evening close/],
    ["self-mastery", SelfMasteryLoading, /Self-Mastery/],
  ])("%s keeps the real page title (known before any fetch) and shows skeleton blocks", (_n, Page, title) => {
    const { container } = render(<Page />);
    expect(container.textContent).toMatch(title);
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(3);
  });

  it.each([
    ["book", BookLoading],
    ["onboarding", OnboardingLoading],
    ["capture", CaptureLoading],
  ])("%s renders skeleton blocks without throwing", (_n, Page) => {
    const { container } = render(<Page />);
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(2);
  });
});
