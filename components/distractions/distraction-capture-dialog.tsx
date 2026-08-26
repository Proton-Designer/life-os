"use client";

import { useState, useTransition } from "react";
import { Plus, Search } from "lucide-react";
import { createTriggerAndLog, listTriggersForDomain, logDistraction } from "@/app/(app)/distractions/actions";
import { rankTriggersForCapture } from "@/lib/distractions/plan-rules";
import type { DistractionDomain, TriggerSummary } from "@/lib/distractions/types";
import { DOMAIN_ICON } from "@/lib/domain-icons";
import { DOMAIN_ACCENT } from "@/lib/accent-tokens";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconChip } from "@/components/ui/icon-chip";
import { cn } from "@/lib/utils";

// Spec order (§4): Deen, Business, School, Fitness, Work — deliberately not
// DOMAIN_ACCENT's own key order.
const CAPTURE_DOMAINS: DistractionDomain[] = ["deen", "business", "school", "fitness", "co_op"];
const DOMAIN_LABEL: Record<DistractionDomain, string> = {
  deen: "Deen",
  business: "Business",
  school: "School",
  fitness: "Fitness",
  co_op: "Work",
};

const TIERS = [1, 2, 3] as const;
type Tier = (typeof TIERS)[number];
const TIER_LABEL: Record<Tier, string> = { 1: "Light", 2: "Moderate", 3: "Heavy" };

const TEXTAREA_CLASS =
  "rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

type Step = "domain" | "triggers";

export function DistractionCaptureDialog() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("domain");
  const [domain, setDomain] = useState<DistractionDomain | null>(null);
  const [triggers, setTriggers] = useState<TriggerSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [tier, setTier] = useState<Tier | null>(null);
  const [, startTransition] = useTransition();

  function reset() {
    setStep("domain");
    setDomain(null);
    setTriggers([]);
    setSearch("");
    setCreating(false);
    setNewName("");
    setNewDescription("");
    setTier(null);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  async function selectDomain(d: DistractionDomain) {
    setDomain(d);
    setStep("triggers");
    setLoading(true);
    const list = await listTriggersForDomain(d);
    setTriggers(list);
    setLoading(false);
  }

  // Tapping an existing trigger logs and closes in one tap (spec §4) — the
  // dialog closes immediately rather than waiting on the round trip;
  // revalidatePath inside the action refreshes whatever's listening.
  function handleTapTrigger(triggerId: string) {
    const loggedTier = tier ?? undefined;
    setOpen(false);
    startTransition(async () => {
      await logDistraction(triggerId, loggedTier);
    });
    reset();
  }

  function handleSaveNew() {
    if (!domain) return;
    const name = newName.trim();
    if (!name) return;
    const description = newDescription.trim() || null;
    const savedTier = tier ?? undefined;
    setOpen(false);
    startTransition(async () => {
      await createTriggerAndLog({ domain, name, description, tier: savedTier });
    });
    reset();
  }

  const filtered = (() => {
    const ranked = rankTriggersForCapture(triggers);
    const query = search.trim().toLowerCase();
    return query ? ranked.filter((t) => t.name.toLowerCase().includes(query)) : ranked;
  })();

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          Distractions
        </Button>
      </DialogTrigger>
      <DialogContent className={cn("sm:max-w-md", domain === "deen" && step === "triggers" && "sm:max-w-lg")}>
        {step === "domain" && (
          <>
            <DialogHeader>
              <DialogTitle>What's the domain?</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-3 gap-2">
              {CAPTURE_DOMAINS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => selectDomain(d)}
                  className="flex flex-col items-center gap-2 rounded-lg border border-border/40 p-3 transition-colors hover:bg-accent/40"
                >
                  <IconChip icon={DOMAIN_ICON[d]} accent={DOMAIN_ACCENT[d]} size="lg" />
                  <span className="text-xs font-medium">{DOMAIN_LABEL[d]}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === "triggers" && domain && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <IconChip icon={DOMAIN_ICON[domain]} accent={DOMAIN_ACCENT[domain]} size="sm" />
                {DOMAIN_LABEL[domain]}
              </DialogTitle>
            </DialogHeader>
            <div className={cn("grid grid-cols-1 gap-4", domain === "deen" && "sm:grid-cols-[1fr_9rem]")}>
              <div className="flex min-w-0 flex-col gap-3">
                {!creating && (
                  <>
                    <Button type="button" variant="outline" size="sm" className="justify-start" onClick={() => setCreating(true)}>
                      <Plus /> New trigger
                    </Button>
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                      <Input
                        placeholder="Search triggers"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-7"
                      />
                    </div>
                    <ul className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
                      {loading && <li className="px-2 py-6 text-center text-sm text-muted-foreground">Loading…</li>}
                      {!loading && filtered.length === 0 && (
                        <li className="px-2 py-6 text-center text-sm text-muted-foreground">No triggers yet</li>
                      )}
                      {!loading &&
                        filtered.map((t) => (
                          <li key={t.id}>
                            <button
                              type="button"
                              onClick={() => handleTapTrigger(t.id)}
                              className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-accent/40"
                            >
                              <span className="min-w-0 truncate">{t.name}</span>
                              <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                                {t.totalCount}
                              </span>
                            </button>
                          </li>
                        ))}
                    </ul>
                  </>
                )}

                {creating && (
                  <div className="flex flex-col gap-2">
                    <Input
                      autoFocus
                      placeholder="Trigger name"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                    />
                    <textarea
                      placeholder="Explain the trigger"
                      value={newDescription}
                      onChange={(e) => setNewDescription(e.target.value)}
                      rows={3}
                      className={TEXTAREA_CLASS}
                    />
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="ghost" size="sm" onClick={() => setCreating(false)}>
                        Cancel
                      </Button>
                      <Button type="button" size="sm" disabled={!newName.trim()} onClick={handleSaveNew}>
                        Save
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {domain === "deen" && (
                <div className="flex shrink-0 flex-col gap-2">
                  <span className="text-xs font-medium text-muted-foreground">Reflection (optional)</span>
                  {TIERS.map((tv) => (
                    <button
                      key={tv}
                      type="button"
                      onClick={() => setTier((current) => (current === tv ? null : tv))}
                      className={cn(
                        "rounded-md border border-border/40 px-2 py-2 text-xs font-medium transition-colors hover:bg-accent/40",
                        tier === tv && "border-destructive/30 bg-destructive/10"
                      )}
                    >
                      {TIER_LABEL[tv]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
