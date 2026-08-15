"use client";

import { useState } from "react";
import { Inbox, ListChecks } from "lucide-react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { EmptyState } from "@/components/ui/empty-state";

// The two states that genuinely need client interactivity to demo for real
// (SegmentedControl's value-driven mode, EmptyState's onClick action) —
// everything else in the harness is static server-rendered markup.
export function HarnessInteractive() {
  const [range, setRange] = useState("week");
  const [clicked, setClicked] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <SegmentedControl
          options={[
            { label: "Week", value: "week", active: range === "week" },
            { label: "Month", value: "month", active: range === "month" },
          ]}
          onSelect={setRange}
        />
        <span className="text-sm text-muted-foreground">selected: {range}</span>
      </div>

      <div className="rounded-2xl border border-border/40 bg-card p-4">
        {clicked ? (
          <p className="text-sm text-muted-foreground">Clicked! (reset by reloading)</p>
        ) : (
          <EmptyState
            icon={ListChecks}
            message="No tasks yet — add your first one"
            action={{ label: "Add a task (onClick)", onClick: () => setClicked(true) }}
          />
        )}
      </div>

      <div className="rounded-2xl border border-border/40 bg-card p-4">
        <EmptyState
          icon={Inbox}
          message="Nothing logged yet — start with Fajr"
          action={{ label: "Go to Deen (href)", href: "/deen" }}
        />
      </div>

      <div className="rounded-2xl border border-border/40 bg-card p-4">
        <EmptyState
          icon={Inbox}
          message="No active co-op — nothing scheduled"
          action={{ label: "Add a task", href: "/co-op" }}
        />
      </div>
    </div>
  );
}
