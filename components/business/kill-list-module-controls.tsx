"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { KillListHistoryDialog } from "@/components/business/kill-list-history-dialog";

/**
 * Today's kill list module's header-right content — a "View More" button
 * opening the full history dialog. Used to also carry an inline
 * "Incompleted this Week" count/list (item B3-3); that surface was
 * promoted into its own top-of-page "Incompleted Tasks" module (2026-08-26
 * night batch 3, per Ayman) and lives in
 * components/business/incomplete-tasks-module.tsx now — this component
 * keeps only the piece that was never part of that promotion.
 */
export function KillListModuleControls() {
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <div className="flex items-center gap-4">
      <Button type="button" variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
        View More
      </Button>

      <KillListHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} />
    </div>
  );
}
