import { fireEvent, render, screen } from "@testing-library/react";
import { createRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prefetchMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ prefetch: prefetchMock }) }));
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

import { INTENT_PREFETCH_THROTTLE_MS, IntentLink, resetIntentPrefetchForTests } from "../intent-link";

describe("IntentLink (one-shot, NAV-03b)", () => {
  beforeEach(() => {
    prefetchMock.mockClear();
    resetIntentPrefetchForTests();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("the Link itself NEVER prefetches (always false), before or after intent", () => {
    render(<IntentLink href="/x">x</IntentLink>);
    const a = screen.getByRole("link");
    expect(a).toHaveAttribute("data-prefetch", "false");
    fireEvent.pointerEnter(a);
    expect(a).toHaveAttribute("data-prefetch", "false");
  });

  it("pointer enter, touch start and focus each call router.prefetch(href, full)", () => {
    for (const [i, fire] of [fireEvent.pointerEnter, fireEvent.touchStart, fireEvent.focus].entries()) {
      resetIntentPrefetchForTests();
      prefetchMock.mockClear();
      const { unmount } = render(<IntentLink href={`/p${i}`}>x</IntentLink>);
      fire(screen.getByRole("link"));
      expect(prefetchMock).toHaveBeenCalledWith(`/p${i}`, { kind: "full" });
      unmount();
    }
  });

  it("throttled per href: repeated intent within 30 s fetches once; after 30 s it may fetch again; other hrefs are independent", () => {
    render(
      <>
        <IntentLink href="/a">a</IntentLink>
        <IntentLink href="/b">b</IntentLink>
      </>
    );
    fireEvent.pointerEnter(screen.getByText("a"));
    fireEvent.focus(screen.getByText("a"));
    fireEvent.touchStart(screen.getByText("a"));
    expect(prefetchMock).toHaveBeenCalledTimes(1);
    fireEvent.pointerEnter(screen.getByText("b"));
    expect(prefetchMock).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(INTENT_PREFETCH_THROTTLE_MS + 1);
    fireEvent.pointerEnter(screen.getByText("a"));
    expect(prefetchMock).toHaveBeenCalledTimes(3);
  });

  // The storm control. A remembered-intent link (NAV-03: `prefetch={intent ? true : false}`) hands Next a
  // `prefetch={true}` Link, which Next re-fires every time a write clears the Router Cache. One-shot never
  // does: nothing is registered with Next after the single imperative call.
  it("positive control: the remembered-intent shape stays prefetch=true after hover; the one-shot shape stays false", () => {
    function Remembered({ href }: { href: string }) {
      const [intent, setIntent] = useState(false);
      return (
        <a data-testid="remembered" data-prefetch={String(intent ? true : false)} onPointerEnter={() => setIntent(true)} href={href}>
          r
        </a>
      );
    }
    render(<Remembered href="/r" />);
    fireEvent.pointerEnter(screen.getByTestId("remembered"));
    expect(screen.getByTestId("remembered")).toHaveAttribute("data-prefetch", "true"); // would re-fire on every cache clear
    render(<IntentLink href="/o">o</IntentLink>);
    fireEvent.pointerEnter(screen.getByText("o"));
    expect(screen.getByText("o")).toHaveAttribute("data-prefetch", "false"); // nothing for Next to re-fire
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
});
