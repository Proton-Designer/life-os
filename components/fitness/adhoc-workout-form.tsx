"use client";

import { useState, useTransition } from "react";
import { logWorkout } from "@/app/(app)/fitness/actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

// Always available regardless of what's scheduled today, per spec.
export function AdhocWorkoutForm({ date }: { date: string }) {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    startTransition(async () => {
      await logWorkout(date, trimmed, "adhoc");
      setName("");
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Log an ad-hoc workout"
      />
      <Button type="submit" disabled={isPending}>
        Log
      </Button>
    </form>
  );
}
