"use client";

import { useState } from "react";
import { GraduationCap, Upload, PenLine, Link2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StepShell } from "./step-shell";
import { OptionCard } from "./option-card";
import { TOP_DOMAIN_META } from "./domain-meta";
import { createClass, uploadClassSyllabus } from "@/app/(app)/school/class-actions";
import type { SchoolManualClass, SchoolSource } from "./types";

type Phase = "source" | "upload" | "manual" | "empty_extraction";

// School's one onboarding question, per the CollegeOS lead's fully specified
// content: "How should we get your classes in?" Upload is the primary path
// (store the file only — extraction is Phase 2), manual entry is the floor
// that always works, Canvas is offered but deliberately not built (no web
// connect surface exists yet, and it's a multi-minute off-app detour at the
// worst possible moment).
export function SchoolStep({
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
  const accent = TOP_DOMAIN_META.school.accent;
  const [phase, setPhase] = useState<Phase>("source");
  const [busy, setBusy] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);

  // -- Upload branch --
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingClassName, setPendingClassName] = useState("");

  async function submitUpload() {
    if (!pendingFile) return;
    setBusy(true);
    try {
      const shortName = pendingClassName.trim() || pendingFile.name.replace(/\.[^.]+$/, "");
      const { id } = await createClass({ shortName, code: "" });
      const formData = new FormData();
      formData.set("file", pendingFile);
      await uploadClassSyllabus(id, formData);
      setUploadedFileName(pendingFile.name);
      setPhase("empty_extraction");
    } finally {
      setBusy(false);
    }
  }

  // -- Manual branch --
  const [manualClasses, setManualClasses] = useState<SchoolManualClass[]>([]);
  const [manualName, setManualName] = useState("");
  const [manualCode, setManualCode] = useState("");

  function stageManualClass() {
    if (!manualName.trim()) return;
    setManualClasses((prev) => [...prev, { name: manualName.trim(), code: manualCode.trim() }]);
    setManualName("");
    setManualCode("");
  }

  async function submitManual() {
    setBusy(true);
    try {
      const toCreate = manualName.trim() ? [...manualClasses, { name: manualName.trim(), code: manualCode.trim() }] : manualClasses;
      for (const c of toCreate) {
        await createClass({ shortName: c.name, code: c.code });
      }
      onNext();
    } finally {
      setBusy(false);
    }
  }

  if (phase === "source") {
    const chooseSource = (source: SchoolSource) => {
      if (source === "canvas") return; // deliberately non-blocking, does not advance
      setPhase(source);
    };

    return (
      <StepShell
        stepId="school-source"
        accent={accent}
        icon={GraduationCap}
        eyebrow="School"
        progressTotal={progressTotal}
        progressIndex={progressIndex}
        footer={
          <Button type="button" variant="outline" data-testid="onboarding-back" onClick={onBack} className="self-start">
            Back
          </Button>
        }
      >
        <h1 className="text-xl font-semibold">Your classes</h1>
        <p className="text-sm text-muted-foreground">We&apos;ll pull in what we can. You can add the rest any time.</p>
        <p className="text-sm font-medium">How should we get your classes in?</p>
        <div className="flex flex-col gap-2">
          <OptionCard
            testId="school-source-upload"
            icon={Upload}
            accent={accent}
            label="Upload a syllabus"
            description="PDF, PNG, or JPEG — recommended."
            selected={false}
            onToggle={() => chooseSource("upload")}
          />
          <OptionCard
            testId="school-source-manual"
            icon={PenLine}
            accent={accent}
            label="Add them manually"
            description="Class name and code — nothing else needed."
            selected={false}
            onToggle={() => chooseSource("manual")}
          />
          <OptionCard
            testId="school-source-canvas"
            icon={Link2}
            accent={accent}
            label="Connect Canvas"
            description="Set this up in Settings once you're in."
            selected={false}
            onToggle={() => chooseSource("canvas")}
          />
        </div>
      </StepShell>
    );
  }

  if (phase === "upload") {
    return (
      <StepShell
        stepId="school-upload"
        accent={accent}
        icon={Upload}
        eyebrow="School"
        progressTotal={progressTotal}
        progressIndex={progressIndex}
        footer={
          <div className="flex gap-2">
            <Button type="button" variant="outline" data-testid="onboarding-back" onClick={() => setPhase("source")}>
              Back
            </Button>
            <Button type="button" data-testid="onboarding-next" disabled={!pendingFile || busy} onClick={submitUpload}>
              {busy ? "Saving…" : "Continue"}
            </Button>
          </div>
        }
      >
        <h1 className="text-xl font-semibold">Upload a syllabus</h1>
        <div className="flex flex-col gap-1">
          <Label htmlFor="school-syllabus-file">File</Label>
          <input
            id="school-syllabus-file"
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
            className="rounded-md border border-input bg-transparent px-3 py-2 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="school-syllabus-classname">Class name (optional)</Label>
          <Input
            id="school-syllabus-classname"
            value={pendingClassName}
            onChange={(e) => setPendingClassName(e.target.value)}
            placeholder="e.g. Chemistry II"
          />
        </div>
      </StepShell>
    );
  }

  if (phase === "manual") {
    return (
      <StepShell
        stepId="school-manual"
        accent={accent}
        icon={PenLine}
        eyebrow="School"
        progressTotal={progressTotal}
        progressIndex={progressIndex}
        footer={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" data-testid="onboarding-back" onClick={() => setPhase("source")}>
              Back
            </Button>
            <Button
              type="button"
              data-testid="onboarding-next"
              disabled={busy || (manualClasses.length === 0 && !manualName.trim())}
              onClick={submitManual}
            >
              {busy ? "Saving…" : "Continue"}
            </Button>
          </div>
        }
      >
        <h1 className="text-xl font-semibold">Add your classes</h1>
        {manualClasses.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {manualClasses.map((c, i) => (
              <li key={`${c.name}-${i}`} className="rounded-lg border border-border/50 px-3 py-1.5 text-sm">
                {c.name}
                {c.code ? <span className="text-muted-foreground"> · {c.code}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-col gap-1">
          <Label htmlFor="school-manual-class-name">Class name</Label>
          <Input
            id="school-manual-class-name"
            data-testid="school-manual-class-name"
            value={manualName}
            onChange={(e) => setManualName(e.target.value)}
            placeholder="e.g. Organic Chemistry"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="school-manual-class-code">Class code</Label>
          <Input
            id="school-manual-class-code"
            data-testid="school-manual-class-code"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            placeholder="e.g. CHEM 201"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          data-testid="school-manual-add-another"
          disabled={!manualName.trim()}
          onClick={stageManualClass}
          className="self-start gap-1.5"
        >
          <Plus className="size-4" />
          Add another
        </Button>
      </StepShell>
    );
  }

  // empty_extraction — a success screen, deliberately not styled as an error.
  // Fixes the inherited bug (itemCount===0 rendered as step:"error") at birth.
  return (
    <StepShell
      stepId="school-empty_extraction"
      accent={accent}
      icon={GraduationCap}
      eyebrow="School"
      progressTotal={progressTotal}
      progressIndex={progressIndex}
      footer={
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" data-testid="school-add-assignments-manually" onClick={onNext}>
            Add assignments manually
          </Button>
          <Button type="button" data-testid="onboarding-next" onClick={onNext}>
            Continue
          </Button>
        </div>
      }
    >
      <div data-testid="school-empty-extraction" className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">Syllabus saved — nothing to confirm yet</h1>
        <p className="text-sm text-muted-foreground">
          We read <span className="font-medium text-foreground">{uploadedFileName}</span> and didn&apos;t find dated
          assignments in it. That&apos;s normal — a lot of syllabi link out to the LMS calendar instead of listing
          dates.
        </p>
        <p className="text-sm text-muted-foreground">It&apos;s saved to this class, and you can add assignments as they come.</p>
      </div>
    </StepShell>
  );
}
