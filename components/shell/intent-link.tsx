"use client";

import Link from "next/link";
import { forwardRef, useState } from "react";

/**
 * Nav link that prefetches on INTENT (NAV-03). `<Link prefetch>` (true) prefetches the WHOLE route for
 * every link in the viewport and re-fires all of them whenever a write clears the Router Cache -- on
 * Home that was ~20 `_rsc` GETs (each a serverless call + DB reads) after EVERY write. Now a nav link
 * does not prefetch at all until the user shows intent (hover, touch start or keyboard focus); then
 * it prefetches that one route in full (`prefetch={true}`), so the click is still instant: a mouse
 * hover leads the click by 100+ ms and on a phone touchstart fires before the click. Per Next 16's
 * "Hover-triggered prefetch" pattern (node_modules/next/dist/docs/01-app/02-guides/prefetching.md);
 * intent is remembered for the life of the link, so a link you have shown intent for keeps its
 * prefetch fresh and everything else costs nothing.
 *
 * forwardRef + handler merging because Radix `asChild` triggers (the sidebar tooltip) clone this
 * element and inject their own ref and pointer/focus handlers.
 */
export const IntentLink = forwardRef<HTMLAnchorElement, Omit<React.ComponentProps<typeof Link>, "prefetch">>(function IntentLink(
  { onPointerEnter, onTouchStart, onFocus, ...rest },
  ref
) {
  const [intent, setIntent] = useState(false);
  return (
    <Link
      ref={ref}
      prefetch={intent ? true : false}
      onPointerEnter={(e) => {
        setIntent(true);
        onPointerEnter?.(e);
      }}
      onTouchStart={(e) => {
        setIntent(true);
        onTouchStart?.(e);
      }}
      onFocus={(e) => {
        setIntent(true);
        onFocus?.(e);
      }}
      {...rest}
    />
  );
});
