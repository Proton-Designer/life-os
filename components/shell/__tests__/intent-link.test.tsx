import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

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

import { IntentLink } from "../intent-link";

describe("IntentLink", () => {
  it("does not prefetch until intent, then prefetches in full: pointer enter, touch start, focus", () => {
    for (const fire of [fireEvent.pointerEnter, fireEvent.touchStart, fireEvent.focus]) {
      const { unmount } = render(<IntentLink href="/x">x</IntentLink>);
      const a = screen.getByRole("link");
      expect(a).toHaveAttribute("data-prefetch", "false");
      fire(a);
      expect(a).toHaveAttribute("data-prefetch", "true");
      unmount();
    }
  });

  it("keeps the caller's own handlers (Radix asChild injects its own) and forwards the ref", () => {
    const onFocus = vi.fn();
    const onPointerEnter = vi.fn();
    const ref = createRef<HTMLAnchorElement>();
    render(
      <IntentLink href="/x" ref={ref} onFocus={onFocus} onPointerEnter={onPointerEnter}>
        x
      </IntentLink>
    );
    const a = screen.getByRole("link");
    fireEvent.pointerEnter(a);
    fireEvent.focus(a);
    expect(onPointerEnter).toHaveBeenCalledTimes(1);
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(ref.current).toBe(a);
  });

  it("intent is per link: hovering one leaves another un-prefetched (the storm control)", () => {
    render(
      <>
        <IntentLink href="/a">a</IntentLink>
        <IntentLink href="/b">b</IntentLink>
      </>
    );
    fireEvent.pointerEnter(screen.getByText("a"));
    expect(screen.getByText("a")).toHaveAttribute("data-prefetch", "true");
    expect(screen.getByText("b")).toHaveAttribute("data-prefetch", "false");
  });
});
