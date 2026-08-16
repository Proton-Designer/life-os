"use client";

import { useLinkStatus } from "next/link";

// Always rendered, fixed-size, opacity-toggled (per the useLinkStatus docs'
// own guidance) so it never shifts nav layout — absolutely positioned via
// .nav-pending-dot (globals.css), so it's also out of flow for icon-only
// nav items where there's no room to reserve inline space. Must render
// inside a `<Link>` and inside a `relative` ancestor.
export function NavLinkPendingHint() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      data-testid="nav-pending-dot"
      className={`nav-pending-dot${pending ? " is-pending" : ""}`}
    />
  );
}
