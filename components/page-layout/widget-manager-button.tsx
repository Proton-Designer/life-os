"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WidgetManagerDialog } from "./widget-manager-dialog";

/**
 * WIDGET-02 -- the one entry point into a domain page's widget manager.
 * Two variants, same dialog underneath: "icon" is the header affordance
 * (mounted once per page, in PageHeader's `actions` slot -- every domain
 * page already supports that slot, so this never needs a second row of
 * chrome or a floating button). "text" is the "manage widgets" link a
 * page's own all-hidden empty state uses to get back in, since a
 * server-rendered EmptyState has no way to open a Client Component's
 * dialog state directly -- this is a second, independent instance of the
 * same button/dialog pair, not a shared one, which is why closing/opening
 * either never affects the other.
 *
 * The Dialog itself is only mounted while `open` -- a page that never
 * opens its manager never calls `getPageLayout` for it.
 */
export function WidgetManagerButton({ domainKey, variant = "icon" }: { domainKey: string; variant?: "icon" | "text" }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <>
      {variant === "icon" ? (
        <Button type="button" variant="ghost" size="icon" aria-label="Manage widgets on this page" onClick={() => setOpen(true)}>
          <SlidersHorizontal className="size-4" />
        </Button>
      ) : (
        <Button type="button" variant="link" size="sm" className="h-auto p-0 text-sm" onClick={() => setOpen(true)}>
          Manage widgets
        </Button>
      )}
      {open ? (
        <WidgetManagerDialog
          domainKey={domainKey}
          open={open}
          onOpenChange={setOpen}
          // A saved layout is read fresh on the page's own next render
          // (getPageLayout is called server-side by the page itself, not
          // cached client state) -- router.refresh() re-runs that render
          // without a full page reload, which is also what proves the
          // save persisted rather than just updating in-memory state.
          onSaved={() => router.refresh()}
        />
      ) : null}
    </>
  );
}
