"use client";

import { useState } from "react";
import { Briefcase, Users, Building2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StepShell } from "./step-shell";
import { OptionCard } from "./option-card";
import { WidgetPicker } from "./widget-picker";
import { TOP_DOMAIN_META } from "./domain-meta";
import { defaultWidgetIdsFor } from "./widget-catalogue";
import type { WorkSubdomainDraft, WorkSubdomainKind } from "./types";

type Phase = "list" | "name" | "kind" | "widgets";

function slugify(label: string): string {
  return (
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "subdomain"
  );
}

// Work -> repeatable: create one or more subdomains. Each one: name it ->
// "business or job?" -> widget picker (all preselected). At least one is
// required, matching Personal Growth's minimum-one rule in spirit (you
// picked Work, you get something to show for it).
export function WorkStep({
  onBack,
  onNext,
  progressTotal,
  progressIndex,
}: {
  onBack: () => void;
  onNext: (drafts: WorkSubdomainDraft[]) => void;
  progressTotal: number;
  progressIndex: number;
}) {
  const accent = TOP_DOMAIN_META.work.accent;
  const [drafts, setDrafts] = useState<WorkSubdomainDraft[]>([]);
  const [phase, setPhase] = useState<Phase>("list");
  const [draftName, setDraftName] = useState("");
  const [draftKind, setDraftKind] = useState<WorkSubdomainKind | null>(null);

  function startNewSubdomain() {
    setDraftName("");
    setDraftKind(null);
    setPhase("name");
  }

  function removeDraft(key: string) {
    setDrafts((prev) => prev.filter((d) => d.key !== key));
  }

  function confirmWidgets(widgetIds: string[]) {
    if (!draftKind) return;
    const key = slugify(draftName);
    setDrafts((prev) => [...prev, { key, label: draftName.trim(), kind: draftKind, widgets: widgetIds }]);
    setPhase("list");
  }

  if (phase === "name") {
    return (
      <StepShell
        stepId="work-name"
        accent={accent}
        icon={Briefcase}
        eyebrow="Work"
        progressTotal={progressTotal}
        progressIndex={progressIndex}
        footer={
          <div className="flex gap-2">
            <Button type="button" variant="outline" data-testid="onboarding-back" onClick={() => setPhase("list")}>
              Back
            </Button>
            <Button
              type="button"
              data-testid="onboarding-next"
              disabled={!draftName.trim()}
              onClick={() => setPhase("kind")}
            >
              Continue
            </Button>
          </div>
        }
      >
        <h1 className="text-xl font-semibold">What do you want to call it?</h1>
        <p className="text-sm text-muted-foreground">A job, a client, a business — whatever you&apos;re tracking.</p>
        <div className="flex flex-col gap-1">
          <Label htmlFor="work-subdomain-name">Name</Label>
          <Input
            id="work-subdomain-name"
            data-testid="work-subdomain-name"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder="e.g. Acme Inc, Freelance design"
            autoFocus
          />
        </div>
      </StepShell>
    );
  }

  if (phase === "kind") {
    return (
      <StepShell
        stepId="work-kind"
        accent={accent}
        icon={Briefcase}
        eyebrow="Work"
        progressTotal={progressTotal}
        progressIndex={progressIndex}
        footer={
          <Button type="button" variant="outline" data-testid="onboarding-back" onClick={() => setPhase("name")} className="self-start">
            Back
          </Button>
        }
      >
        <h1 className="text-xl font-semibold">Business or job?</h1>
        <div className="flex flex-col gap-2">
          <OptionCard
            testId="work-kind-job"
            icon={Users}
            accent={accent}
            label="Job"
            description="Employed, shift or salaried work."
            selected={draftKind === "job"}
            onToggle={() => {
              setDraftKind("job");
              setPhase("widgets");
            }}
          />
          <OptionCard
            testId="work-kind-business"
            icon={Building2}
            accent={accent}
            label="Business"
            description="Clients, projects, or something you run."
            selected={draftKind === "business"}
            onToggle={() => {
              setDraftKind("business");
              setPhase("widgets");
            }}
          />
        </div>
      </StepShell>
    );
  }

  if (phase === "widgets" && draftKind) {
    return (
      <StepShell
        stepId="work-widgets"
        accent={accent}
        icon={Briefcase}
        eyebrow={`Work · ${draftName}`}
        progressTotal={progressTotal}
        progressIndex={progressIndex}
        footer={
          <Button type="button" variant="outline" data-testid="onboarding-back" onClick={() => setPhase("kind")} className="self-start">
            Back
          </Button>
        }
      >
        <h1 className="text-xl font-semibold">What should this screen show?</h1>
        <WidgetPicker accent={accent} defaultSelectedIds={defaultWidgetIdsFor(draftKind)} onConfirm={confirmWidgets} />
      </StepShell>
    );
  }

  return (
    <StepShell
      stepId="work-list"
      accent={accent}
      icon={Briefcase}
      eyebrow="Work"
      progressTotal={progressTotal}
      progressIndex={progressIndex}
      footer={
        <div className="flex gap-2">
          <Button type="button" variant="outline" data-testid="onboarding-back" onClick={onBack}>
            Back
          </Button>
          <Button type="button" data-testid="onboarding-next" disabled={drafts.length === 0} onClick={() => onNext(drafts)}>
            Continue
          </Button>
        </div>
      }
    >
      <h1 className="text-xl font-semibold">Set up Work</h1>
      <p className="text-sm text-muted-foreground">Add at least one job or business to track here.</p>
      {drafts.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {drafts.map((d) => (
            <li key={d.key} className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2">
              <div className="flex flex-col">
                <span className="text-sm font-medium">{d.label}</span>
                <span className="text-xs text-muted-foreground capitalize">{d.kind}</span>
              </div>
              <button
                type="button"
                aria-label={`Remove ${d.label}`}
                onClick={() => removeDraft(d.key)}
                className="text-muted-foreground transition-colors hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <Button type="button" variant="outline" data-testid="work-add-subdomain" onClick={startNewSubdomain} className="self-start gap-1.5">
        <Plus className="size-4" />
        Add {drafts.length > 0 ? "another" : "a job or business"}
      </Button>
    </StepShell>
  );
}
