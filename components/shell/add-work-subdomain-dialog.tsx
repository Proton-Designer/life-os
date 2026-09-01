"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Briefcase, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { createWorkSubdomain, type WorkSubdomainKind } from "@/app/(app)/work/subdomain-actions";

// M4: "creating a new work subdomain -> first prompt: business or job? ->
// then a sub-window to select widgets/features." The widget-picker
// sub-window is deliberately not built here yet — there's no per-subdomain
// widget-rendering system to select FOR (T-0002/widget rendering both still
// open per DECISIONS.md D-010), so shipping a picker with nothing behind it
// would be exactly the "fake, not honest" thing the Lead has repeatedly
// ruled against. New subdomains get an empty widgets set, same as any
// subdomain created during onboarding before its widget step.
export function AddWorkSubdomainDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<WorkSubdomainKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setLabel("");
      setKind(null);
      setError(null);
    }
  }

  function handleCreate() {
    const trimmed = label.trim();
    if (!trimmed) {
      setError("Name it first");
      return;
    }
    if (!kind) {
      setError("Business or job?");
      return;
    }
    setError(null);
    startTransition(async () => {
      const { key } = await createWorkSubdomain(trimmed, kind);
      handleOpenChange(false);
      router.push(`/work/${key}`);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" data-testid="add-work-subdomain-trigger" className="gap-1.5">
          <Plus className="size-4" />
          Add
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New job or business</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="work-subdomain-name">Name</Label>
            <Input
              id="work-subdomain-name"
              data-testid="add-work-subdomain-name"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Acme Inc, Freelance design"
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Business or job?</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={kind === "job" ? "default" : "outline"}
                data-testid="add-work-subdomain-kind-job"
                onClick={() => setKind("job")}
                className="flex-1 gap-1.5"
              >
                <Briefcase className="size-4" />
                Job
              </Button>
              <Button
                type="button"
                variant={kind === "business" ? "default" : "outline"}
                data-testid="add-work-subdomain-kind-business"
                onClick={() => setKind("business")}
                className="flex-1 gap-1.5"
              >
                <Building2 className="size-4" />
                Business
              </Button>
            </div>
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" data-testid="add-work-subdomain-confirm" disabled={isPending} onClick={handleCreate}>
            {isPending ? "Adding…" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
