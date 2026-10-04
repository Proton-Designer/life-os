"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { forwardRef } from "react";

/**
 * ONE-SHOT intent prefetch for nav links (NAV-03b, refining NAV-03). `<Link prefetch>` prefetches every
 * route in the viewport and re-fires them ALL whenever a write clears the Router Cache (~20 `_rsc` GETs
 * after each write on Home). NAV-03 gated that behind intent, but a link that stays `prefetch={true}`
 * after one hover keeps re-firing on every cache clear -- hover all 8 nav items once and the storm is
 * back. So the Link here is ALWAYS `prefetch={false}` (it never prefetches or re-prefetches by itself);
 * on pointerenter / touchstart / focus we call `router.prefetch(href, { kind: "full" })` ourselves: one
 * full-page request for that route, at most once per THROTTLE_MS per href. A cache clear then refetches
 * nothing until the next intent. (`kind: "full"` is Next 16's PrefetchKind.FULL; without it
 * router.prefetch only fetches the loading-boundary shell for a dynamic route -- see
 * node_modules/next/dist/client/components/app-router-instance.js.)
 *
 * forwardRef + handler merging because Radix `asChild` triggers (the sidebar tooltip) clone this element
 * and inject their own ref and pointer/focus handlers.
 */
export const INTENT_PREFETCH_THROTTLE_MS = 30_000;
const lastPrefetchAt = new Map<string, number>();

/** Test hook: forget what was prefetched. */
export function resetIntentPrefetchForTests() {
  lastPrefetchAt.clear();
}

type Router = ReturnType<typeof useRouter>;
const FULL = { kind: "full" } as unknown as Parameters<Router["prefetch"]>[1];

export const IntentLink = forwardRef<HTMLAnchorElement, Omit<React.ComponentProps<typeof Link>, "prefetch">>(function IntentLink(
  { onPointerEnter, onTouchStart, onFocus, href, ...rest },
  ref
) {
  const router = useRouter();
  const target = typeof href === "string" ? href : (href.pathname ?? "");

  function intent() {
    if (!target) return;
    const now = Date.now();
    const last = lastPrefetchAt.get(target);
    if (last !== undefined && now - last < INTENT_PREFETCH_THROTTLE_MS) return;
    lastPrefetchAt.set(target, now);
    router.prefetch(target, FULL);
  }

  return (
    <Link
      ref={ref}
      href={href}
      prefetch={false}
      onPointerEnter={(e) => {
        intent();
        onPointerEnter?.(e);
      }}
      onTouchStart={(e) => {
        intent();
        onTouchStart?.(e);
      }}
      onFocus={(e) => {
        intent();
        onFocus?.(e);
      }}
      {...rest}
    />
  );
});
