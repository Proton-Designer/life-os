"use client";

import { useRef, useState } from "react";
import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StepShell } from "./step-shell";
import { PERSONAL_SUBDOMAIN_META } from "./domain-meta";
import { stubStoreSelfMasteryUpload } from "./self-mastery-upload-stub";

type Phase = "ask" | "uploading" | "confirmed";

// Collects nothing on the primary path (ULM lead's ruling on
// PHASE-1-SPEC.md) — "Continue" advances immediately. "Add a book" is an
// inline, entirely optional side door; a successful pick advances into a
// short honest confirmation ("check back whenever," no promised
// notification, since none exists) rather than blocking on the ~hour-long
// ingestion pipeline.
export function SelfMasteryStep({
  onBack,
  onNext,
  progressTotal,
  progressIndex,
}: {
  onBack: () => void;
  onNext: () => void;
  progressTotal: number;
  progressIndex: number;
}) {
  const accent = PERSONAL_SUBDOMAIN_META.self_mastery.accent;
  const [phase, setPhase] = useState<Phase>("ask");
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setPhase("uploading");
    setFileName(file.name);
    await stubStoreSelfMasteryUpload(file);
    setPhase("confirmed");
  }

  if (phase === "confirmed") {
    return (
      <StepShell
        stepId="personal_growth-self_mastery-confirm"
        accent={accent}
        icon={BookOpen}
        eyebrow="Personal Growth · Self-Mastery"
        progressTotal={progressTotal}
        progressIndex={progressIndex}
        footer={
          <Button type="button" data-testid="onboarding-next" onClick={onNext} className="self-start">
            Continue
          </Button>
        }
      >
        <div data-testid="selfmastery-upload-confirm" className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold">Reading your book.</h1>
          <p className="text-sm text-muted-foreground">
            Your first lessons will be ready in a few minutes — the rest of the book keeps processing after that.
            Check Self-Mastery whenever you like; nothing is waiting on you.
          </p>
          {fileName ? <p className="text-xs text-muted-foreground">{fileName}</p> : null}
        </div>
      </StepShell>
    );
  }

  return (
    <StepShell
      stepId="personal_growth-self_mastery"
      accent={accent}
      icon={BookOpen}
      eyebrow="Personal Growth · Self-Mastery"
      progressTotal={progressTotal}
      progressIndex={progressIndex}
      footer={
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" data-testid="onboarding-back" onClick={onBack}>
            Back
          </Button>
          <Button type="button" data-testid="selfmastery-continue" onClick={onNext} disabled={phase === "uploading"}>
            Continue
          </Button>
          <Button
            type="button"
            variant="ghost"
            data-testid="selfmastery-add-book"
            disabled={phase === "uploading"}
            onClick={() => fileInputRef.current?.click()}
          >
            {phase === "uploading" ? "Adding…" : "Add a book"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            data-testid="selfmastery-file-input"
            accept=".pdf,.epub,.txt"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
        </div>
      }
    >
      <h1 className="text-xl font-semibold">Remember what you read.</h1>
      <p className="text-sm text-muted-foreground">
        Most of a book is gone within a month of finishing it. Self-Mastery turns a book into a few minutes of daily
        recall — so the ideas are still there when you need them.
      </p>
    </StepShell>
  );
}
