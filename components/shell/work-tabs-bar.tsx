"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Briefcase, Pencil, Target } from "lucide-react";
import { SubdomainTabs, type SubdomainTabItem } from "@/components/shell/subdomain-tabs";
import { AddWorkSubdomainDialog } from "@/components/shell/add-work-subdomain-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { saveWorkTabs, ensureBusinessWorkTab, refreshWorkViews } from "@/app/(app)/work/subdomain-actions";
import { enqueueByKey } from "@/lib/client/keyed-queue";
import { useScheduleRefresh } from "@/lib/client/use-optimistic-item";
import { cn } from "@/lib/utils";

export type WorkTab = { key: string; label: string; kind: "job" | "business" | null };

// Lazy on purpose: the action is only touched when the debounced refresh fires.
const refreshWork = () => refreshWorkViews();

/**
 * The Work screen's tab bar plus its editor (WORK-W1). The first tab is the default (the Work
 * nav link points at it). Edits are optimistic: saving closes the dialog and the bar changes at
 * once; the whole edit is ONE atomic server write (saveWorkTabs), queued so two quick edits land
 * in order, and a failure puts the bar back with an inline error.
 */
export function WorkTabsBar({ tabs: serverTabs, activeKey }: { tabs: WorkTab[]; activeKey: string }) {
  const router = useRouter();
  const scheduleRefresh = useScheduleRefresh(refreshWork);
  const [tabs, setTabs] = useState<WorkTab[]>(serverTabs);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(0);

  // Take the server's tabs whenever they change and no write of ours is still in flight.
  useEffect(() => {
    if (inflight.current === 0) setTabs(serverTabs);
  }, [serverTabs]);

  const hasBusiness = tabs.some((t) => t.kind === "business");

  function save(edited: (WorkTab & { archived: boolean })[]) {
    const previous = tabs;
    const staying = edited.filter((t) => !t.archived).map(({ key, label, kind }) => ({ key, label: label.trim(), kind }));
    setError(null);
    setTabs(staying);
    if (!staying.some((t) => t.key === activeKey)) router.replace(`/work/${staying[0].key}`);
    inflight.current += 1;
    void enqueueByKey("work-tabs", () => saveWorkTabs(edited.map((t) => ({ key: t.key, label: t.label, archived: t.archived }))))
      .catch((e: unknown) => {
        setTabs(previous);
        setError(e instanceof Error ? e.message : "Couldn't save the tabs. Try again.");
      })
      .finally(() => {
        inflight.current -= 1;
        scheduleRefresh();
      });
  }

  async function addBusinessTab() {
    setError(null);
    try {
      const { key } = await ensureBusinessWorkTab();
      router.push(`/work/${key}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add the Business tab. Try again.");
    }
  }

  const items: SubdomainTabItem[] = tabs.map((t) => ({
    key: t.key,
    href: `/work/${t.key}`,
    label: t.label,
    icon: t.kind === "business" ? Target : Briefcase,
    accent: t.kind === "business" ? "business" : "coop",
    active: t.key === activeKey,
  }));

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-2 px-4 pt-6 md:px-6 md:pt-8 xl:px-8">
      <div className="flex items-center justify-between gap-2">
        <SubdomainTabs items={items} testIdPrefix="work-subdomain-tab" />
        <div className="flex shrink-0 items-center gap-2">
          <EditTabsDialog tabs={tabs} hasBusiness={hasBusiness} onSave={save} onAddBusiness={addBusinessTab} />
          <AddWorkSubdomainDialog />
        </div>
      </div>
      {error ? (
        <p role="alert" data-testid="work-tabs-error" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function EditTabsDialog({
  tabs,
  hasBusiness,
  onSave,
  onAddBusiness,
}: {
  tabs: WorkTab[];
  hasBusiness: boolean;
  onSave: (edited: (WorkTab & { archived: boolean })[]) => void;
  onAddBusiness: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<(WorkTab & { archived: boolean })[]>([]);
  const [adding, setAdding] = useState(false);

  function handleOpenChange(next: boolean) {
    if (next) setDraft(tabs.map((t) => ({ ...t, archived: false })));
    setOpen(next);
  }

  const remaining = draft.filter((t) => !t.archived).length;
  const blank = draft.some((t) => !t.archived && t.label.trim() === "");

  function move(index: number, delta: -1 | 1) {
    setDraft((prev) => {
      const next = [...prev];
      const to = index + delta;
      if (to < 0 || to >= next.length) return prev;
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" data-testid="edit-work-tabs-trigger" className="gap-1.5">
          <Pencil className="size-4" />
          Edit tabs
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit tabs</DialogTitle>
          <DialogDescription>Rename a tab, or move it up or down. The first tab opens by default.</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-2" data-testid="edit-work-tabs-list">
          {draft.map((t, i) => (
            <li key={t.key} className={cn("flex items-center gap-2", t.archived && "opacity-50")}>
              <Input
                aria-label={`Name of tab ${i + 1}`}
                value={t.label}
                maxLength={40}
                disabled={t.archived}
                onChange={(e) => setDraft((prev) => prev.map((x) => (x.key === t.key ? { ...x, label: e.target.value } : x)))}
              />
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${t.label} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp className="size-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${t.label} down`} disabled={i === draft.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t.archived ? `Restore ${t.label}` : `Remove ${t.label}`}
                disabled={!t.archived && remaining <= 1}
                title={!t.archived && remaining <= 1 ? "Keep at least one tab" : undefined}
                onClick={() => setDraft((prev) => prev.map((x) => (x.key === t.key ? { ...x, archived: !x.archived } : x)))}
              >
                {t.archived ? "Restore" : "Remove"}
              </Button>
            </li>
          ))}
        </ul>
        {!hasBusiness ? (
          <Button
            type="button"
            variant="outline"
            data-testid="add-business-tab"
            disabled={adding}
            onClick={async () => {
              setAdding(true);
              await onAddBusiness();
              setAdding(false);
              setOpen(false);
            }}
          >
            Add a Business tab
          </Button>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            data-testid="edit-work-tabs-save"
            disabled={blank || remaining < 1}
            onClick={() => {
              onSave(draft);
              setOpen(false);
            }}
          >
            Save tabs
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
