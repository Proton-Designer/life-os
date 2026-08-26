"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SalahCalendarDialog } from "@/components/deen/salah-calendar-dialog";

export function SalahViewMoreButton({
  initialYear,
  initialMonth,
  todayStr,
}: {
  initialYear: number;
  initialMonth: number;
  todayStr: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        View More
      </Button>
      <SalahCalendarDialog
        open={open}
        onOpenChange={setOpen}
        initialYear={initialYear}
        initialMonth={initialMonth}
        todayStr={todayStr}
      />
    </>
  );
}
