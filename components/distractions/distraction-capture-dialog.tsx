"use client";

import { useEffect, useState, useTransition } from "react";
import { Plus, Search } from "lucide-react";
import {
  createTriggerAndLog,
  listTriggersForDomain,
  listTopTriggersForQuickLog,
  logDistraction,
  getSessionDistractionCountForNow,
} from "@/app/(app)/distractions/actions";
import { useDistractionRefresh } from "@/components/distractions/use-distraction-refresh";
import { rankTriggersForCapture } from "@/lib/distractions/plan-rules";
import type { DistractionDomain, TriggerSummary } from "@/lib/distractions/types";
import { DOMAIN_ICON } from "@/lib/domain-icons";
import { DOMAIN_ACCENT } from "@/lib/accent-tokens";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconChip } from "@/components/ui/icon-chip";
import { cn } from "@/lib/utils";
import { useLockInOverlay, type ActiveWorkSession } from "@/components/business/lock-in-overlay-context";
import { KIND_LABEL } from "@/lib/business/work-session-kind";

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

/** P3-02 (docs/audits/2026-09-13-three-app-feature-audit.md #35 -- "Distraction counter (+1→6 chips→back, 2 taps)"): up to this many of the user's own most-frequent triggers, cross-domain, shown as one-tap chips. */
const QUICK_CHIP_COUNT = 6;

// Same cadence as topbar.tsx's own DistractionCountBadge (#50) — one
// established idiom for "a client component polls a server action for a
// live count," not a second one invented here.
const SESSION_DISTRACTION_POLL_MS = 60 * 1000;

/**
 * #52's live "N this session" counter. Polls
 * `getSessionDistractionCountForNow`, scoped to the active session id, the
 * same idiom `components/shell/topbar.tsx`'s `DistractionCountBadge` uses
 * for its own day-scoped count. Resets to null (renders nothing) whenever
 * `sessionId` changes — a new session starts at zero, not the prior
 * session's last-known count.
 */
function SessionDistractionCounter({ sessionId, bump }: { sessionId: string; bump: number }) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const next = await getSessionDistractionCountForNow(sessionId);
        if (!cancelled) setCount(next);
      } catch {
        // Best-effort, same posture as DistractionCountBadge's own poll —
        // keep the last-known count showing; the next tick retries.
      }
    };
    refresh();
    const interval = setInterval(refresh, SESSION_DISTRACTION_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // `bump` deliberately re-triggers this effect (and its immediate
    // `refresh()`) right after this component's own dialog logs a new
    // event — the count reflects a distraction logged a second ago rather
    // than waiting out the rest of the 60s tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, bump]);

  if (count === null) return null;

  return (
    <span className="text-xs font-medium tabular-nums text-muted-foreground">
      {count} this session
    </span>
  );
}

const TEXTAREA_CLASS =
  "rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

type Step = "quick" | "domain" | "triggers";

/** Which domain a Lock-In session implies, so capture never re-asks a
 * question the session already answered (Ayman, 2026-09-10: "if im doing
 * deep work the domain is automatically Business, and if im doing Deep
 * Study the domain is automatically school"). Null with no active session
 * — the domain picker renders exactly as it always has. */
function inferDomainFromSession(session: ActiveWorkSession | null): DistractionDomain | null {
  if (!session) return null;
  return session.kind === "deep_work" ? "business" : "school";
}

/** `deenMode` (profiles.deen_mode) as a plain boolean; fails closed. Off drops the Deen domain (and with it the reflection-tier UI, which only exists under Deen). */
export function DistractionCaptureDialog({ deenMode = false }: { deenMode?: boolean } = {}) {
  const { session } = useLockInOverlay();
  const inferredDomain = inferDomainFromSession(session);

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("quick");
  const [domain, setDomain] = useState<DistractionDomain | null>(null);
  const [triggers, setTriggers] = useState<TriggerSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [tier, setTier] = useState<Tier | null>(null);
  const [, startTransition] = useTransition();
  const scheduleRefresh = useDistractionRefresh();
  // #52: bumped after every successful log so SessionDistractionCounter
  // re-polls immediately instead of waiting out its own 60s tick.
  const [sessionLogBump, setSessionLogBump] = useState(0);
  // P3-02: the "+1" quick-log step's own chip list (cross-domain, ranked
  // the SAME way the domain-scoped step already ranks -- rankTriggersForCapture).
  const [quickTriggers, setQuickTriggers] = useState<TriggerSummary[]>([]);
  const [quickLoading, setQuickLoading] = useState(false);

  function reset() {
    setStep("quick");
    setDomain(null);
    setTriggers([]);
    setSearch("");
    setCreating(false);
    setNewName("");
    setNewDescription("");
    setTier(null);
    setQuickTriggers([]);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  // Keyed to `open` becoming true, not folded into reset()/the close
  // handler above — the mirror of a bug the Opus Lead's other engineer
  // already caught on the session-setup dialog. reset() always returns to
  // the "quick" chip step on close; this effect re-applies the
  // active-session skip (or loads the quick chips) on every fresh open, so
  // neither can go stale between one open and the next.
  //
  // P3-02: an active Lock-In/Deep Study session keeps its OWN pre-existing
  // fast path unchanged (straight to that domain's own trigger list --
  // already validated, already fewer taps than the generic case). The
  // NEW quick-chip step only applies with no active session, replacing
  // what used to be a domain-picker landing screen.
  useEffect(() => {
    if (!open) return;
    if (inferredDomain) {
      selectDomain(inferredDomain);
      return;
    }
    setStep("quick");
    setQuickLoading(true);
    listTopTriggersForQuickLog().then((list) => {
      setQuickTriggers(list);
      setQuickLoading(false);
      // Nothing to show as chips yet (first-ever use) -- the full
      // domain->create flow is the only option, so land there directly
      // rather than showing an empty chip screen.
      if (list.length === 0) setStep("domain");
    });
    // selectDomain is a stable function declaration re-created each render,
    // not a dependency that should re-trigger this — only open/inferredDomain should.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, inferredDomain]);

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
    const loggedSessionId = session?.id ?? null;
    setOpen(false);
    startTransition(async () => {
      try {
        await logDistraction(triggerId, loggedTier, loggedSessionId);
        setSessionLogBump((n) => n + 1);
      } finally {
        scheduleRefresh();
      }
    });
    reset();
  }

  function handleSaveNew() {
    if (!domain) return;
    const name = newName.trim();
    if (!name) return;
    const description = newDescription.trim() || null;
    const savedTier = tier ?? undefined;
    const loggedSessionId = session?.id ?? null;
    setOpen(false);
    startTransition(async () => {
      try {
        await createTriggerAndLog({ domain, name, description, tier: savedTier, sessionId: loggedSessionId });
        setSessionLogBump((n) => n + 1);
      } finally {
        scheduleRefresh();
      }
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
      <div className="flex items-center gap-2">
        <DialogTrigger asChild>
          {/* P3-02: "+1" is the spec's own entry gesture (docs/audits/2026-09-13-three-app-feature-audit.md #35). aria-label carries the meaning for assistive tech, same posture the Lock-In "Lock In" buttons already established for a short visible label. */}
          <Button type="button" variant="outline" size="sm" aria-label="Log a distraction">
            +1
          </Button>
        </DialogTrigger>
        {/* #52: only rendered during an active Lock-In/Deep Study session —
            "N this session" has no meaning with no session running. */}
        {session && <SessionDistractionCounter sessionId={session.id} bump={sessionLogBump} />}
      </div>
      <DialogContent className={cn("sm:max-w-md", domain === "deen" && step === "triggers" && "sm:max-w-lg")}>
        {step === "quick" && (
          <>
            <DialogHeader>
              <DialogTitle>What happened?</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              {quickLoading ? (
                <p className="px-2 py-6 text-center text-sm text-muted-foreground">Loading…</p>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {rankTriggersForCapture(quickTriggers)
                    .slice(0, QUICK_CHIP_COUNT)
                    .map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => handleTapTrigger(t.id)}
                        className="flex flex-col items-center gap-1.5 rounded-lg border border-border/40 p-3 text-center transition-colors hover:bg-accent/40"
                      >
                        <IconChip icon={DOMAIN_ICON[t.domain]} accent={DOMAIN_ACCENT[t.domain]} size="md" />
                        <span className="line-clamp-2 text-xs font-medium">{t.name}</span>
                      </button>
                    ))}
                </div>
              )}
              <Button type="button" variant="ghost" size="sm" onClick={() => setStep("domain")}>
                More options
              </Button>
            </div>
          </>
        )}

        {step === "domain" && (
          <>
            <DialogHeader>
              <DialogTitle>What's the domain?</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-3 gap-2">
              {CAPTURE_DOMAINS.filter((d) => deenMode || d !== "deen").map((d) => (
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
              {/* Unobtrusive, not a control (Ayman/Opus Lead, 2026-09-10):
                  inferring the domain silently is right, hiding what was
                  inferred is not — if it's ever wrong he needs to see it. */}
              {session && inferredDomain === domain && (
                <DialogDescription>Inferred from your {KIND_LABEL[session.kind]} session</DialogDescription>
              )}
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
