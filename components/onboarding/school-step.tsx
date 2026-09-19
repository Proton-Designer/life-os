"use client";

import { useState } from "react";
import { GraduationCap, PenLine, Link2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StepShell } from "./step-shell";
import { OptionCard } from "./option-card";
import { TOP_DOMAIN_META } from "./domain-meta";
import { createClass, uploadClassSyllabus } from "@/app/(app)/school/class-actions";
import { connectCanvas } from "@/app/(app)/settings/canvas-actions";
import type { SchoolManualClass, SchoolSource } from "./types";

type Phase = "source" | "canvas" | "manual" | "empty_extraction";

// A manually-staged class, plus an OPTIONAL syllabus file (ONB item 10:
// syllabus upload folded into add-manually, no longer a separate top-level
// source). `file` is local-only UI state -- never part of SchoolManualClass,
// the shared structural type onboarding/actions.ts also uses, since a raw
// File isn't something a plain server-action payload can carry.
type StagedManualClass = SchoolManualClass & { file: File | null };

// School's one onboarding question, per the CollegeOS lead's fully specified
// content: "How should we get your classes in?" ONB item 10 (Ayman): keep
// exactly two source options -- add manually (the floor that always works,
// syllabus upload folded in as an optional attachment per class) and Connect
// Canvas, now a REAL connect flow (reusing settings/canvas-actions.ts's
// connectCanvas -- same validation, same encrypted storage, same automatic
// course import, not reimplemented here). Connect Canvas was previously
// wired to a deliberate no-op with no visual difference from the two real
// options, which is why it looked broken (P4-38-adjacent finding, ONB
// item 10 diagnosis) -- the original "multi-minute off-app detour at the
// worst possible moment" objection no longer applies now that "Setup Later"
// gives every visitor to this screen a real, always-available way out.
export function SchoolStep({
  onBack,
  onNext,
  progressTotal,
  progressIndex,
  active = true,
}: {
  onBack: () => void;
  onNext: () => void;
  progressTotal: number;
  progressIndex: number;
  /** ONB item 5 — see PersonalGrowthStep's note. Mounted-but-hidden so the
   * chosen source, staged classes and uploads survive leaving this domain. */
  active?: boolean;
}) {
  const accent = TOP_DOMAIN_META.school.accent;
  const [phase, setPhase] = useState<Phase>("source");
  const [busy, setBusy] = useState(false);
  const [uploadedFileNames, setUploadedFileNames] = useState<string[]>([]);

  // -- Canvas branch (ONB item 10: real connect, reusing settings' own action) --
  const [canvasUrl, setCanvasUrl] = useState("");
  const [canvasToken, setCanvasToken] = useState("");
  const [canvasMessage, setCanvasMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [canvasConnected, setCanvasConnected] = useState(false);

  async function submitCanvas() {
    setBusy(true);
    setCanvasMessage(null);
    try {
      const url = canvasUrl.trim().replace(/\/+$/, "");
      const res = await connectCanvas(url, canvasToken.trim());
      setCanvasMessage({ ok: res.ok, text: res.message });
      if (res.ok) {
        setCanvasConnected(true);
        setCanvasToken("");
      }
    } finally {
      setBusy(false);
    }
  }

  // -- Manual branch (ONB item 10: syllabus upload folded in, optional per class) --
  const [manualClasses, setManualClasses] = useState<StagedManualClass[]>([]);
  const [manualName, setManualName] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [manualFile, setManualFile] = useState<File | null>(null);

  function stageManualClass() {
    if (!manualName.trim()) return;
    setManualClasses((prev) => [...prev, { name: manualName.trim(), code: manualCode.trim(), file: manualFile }]);
    setManualName("");
    setManualCode("");
    setManualFile(null);
  }

  async function submitManual() {
    setBusy(true);
    try {
      const toCreate = manualName.trim()
        ? [...manualClasses, { name: manualName.trim(), code: manualCode.trim(), file: manualFile }]
        : manualClasses;
      const uploaded: string[] = [];
      for (const c of toCreate) {
        const { id } = await createClass({ shortName: c.name, code: c.code });
        if (c.file) {
          const formData = new FormData();
          formData.set("file", c.file);
          await uploadClassSyllabus(id, formData);
          uploaded.push(c.file.name);
        }
      }
      if (uploaded.length > 0) {
        setUploadedFileNames(uploaded);
        setPhase("empty_extraction");
      } else {
        onNext();
      }
    } finally {
      setBusy(false);
    }
  }

  // ONB item 5: mounted but not shown -- staged classes and phase survive.
  if (!active) return null;

  if (phase === "source") {
    const chooseSource = (source: SchoolSource) => setPhase(source);

    return (
      <StepShell
        stepId="school-source"
        accent={accent}
        icon={GraduationCap}
        eyebrow="School"
        progressTotal={progressTotal}
        progressIndex={progressIndex}
        footer={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" data-testid="onboarding-back" onClick={onBack}>
              Back
            </Button>
            <Button type="button" variant="outline" data-testid="school-setup-later" onClick={onNext}>
              Setup Later
            </Button>
          </div>
        }
      >
        <h1 className="text-xl font-semibold">Your classes</h1>
        <p className="text-sm text-muted-foreground">We&apos;ll pull in what we can. You can add the rest any time.</p>
        <p className="text-sm font-medium">How should we get your classes in?</p>
        <div className="flex flex-col gap-2">
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
            description="Paste your instance URL and access token — we'll pull in your classes."
            selected={false}
            onToggle={() => chooseSource("canvas")}
          />
        </div>
      </StepShell>
    );
  }

  if (phase === "canvas") {
    return (
      <StepShell
        stepId="school-canvas"
        accent={accent}
        icon={Link2}
        eyebrow="School"
        progressTotal={progressTotal}
        progressIndex={progressIndex}
        footer={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" data-testid="onboarding-back" onClick={() => setPhase("source")}>
              Back
            </Button>
            {canvasConnected ? (
              <Button type="button" data-testid="onboarding-next" onClick={onNext}>
                Continue
              </Button>
            ) : (
              <Button
                type="button"
                data-testid="school-canvas-connect"
                disabled={busy || !canvasUrl.trim() || !canvasToken.trim()}
                onClick={submitCanvas}
              >
                {busy ? "Connecting…" : "Connect"}
              </Button>
            )}
          </div>
        }
      >
        <h1 className="text-xl font-semibold">Connect Canvas</h1>
        {!canvasConnected ? (
          <>
            <p className="text-sm text-muted-foreground">
              Paste your Canvas instance URL and a personal access token — we&apos;ll verify it and pull in your
              classes automatically.
            </p>
            <div className="flex flex-col gap-1">
              <Label htmlFor="school-canvas-url">Canvas instance URL</Label>
              <Input
                id="school-canvas-url"
                data-testid="school-canvas-url"
                placeholder="https://yourschool.instructure.com"
                autoComplete="off"
                value={canvasUrl}
                onChange={(e) => setCanvasUrl(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="school-canvas-token">Personal access token</Label>
              <Input
                id="school-canvas-token"
                data-testid="school-canvas-token"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={canvasToken}
                onChange={(e) => setCanvasToken(e.target.value)}
                disabled={busy}
              />
            </div>
          </>
        ) : null}
        {canvasMessage ? (
          <p
            data-testid="school-canvas-message"
            className={`text-sm ${canvasMessage.ok ? "text-muted-foreground" : "text-destructive"}`}
          >
            {canvasMessage.text}
          </p>
        ) : null}
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
                {c.file ? <span className="text-muted-foreground"> · {c.file.name}</span> : null}
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
        <div className="flex flex-col gap-1">
          <Label htmlFor="school-manual-syllabus-file">Syllabus (optional)</Label>
          {/* ONB item 10: syllabus upload folded INSIDE add-manually -- was a
              separate top-level source option, redundant with this one
              (every real path needs a class name/code either way). Attaches
              to whichever class is currently being entered; staged alongside
              it by stageManualClass, uploaded after createClass in
              submitManual. */}
          <input
            id="school-manual-syllabus-file"
            data-testid="school-manual-syllabus-file"
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            onChange={(e) => setManualFile(e.target.files?.[0] ?? null)}
            className="rounded-md border border-input bg-transparent px-3 py-2 text-sm"
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
        <h1 className="text-xl font-semibold">
          {uploadedFileNames.length > 1 ? "Syllabi saved" : "Syllabus saved"} — nothing to confirm yet
        </h1>
        <p className="text-sm text-muted-foreground">
          We read <span className="font-medium text-foreground">{uploadedFileNames.join(", ")}</span> and
          didn&apos;t find dated assignments in {uploadedFileNames.length > 1 ? "them" : "it"}. That&apos;s normal —
          a lot of syllabi link out to the LMS calendar instead of listing dates.
        </p>
        <p className="text-sm text-muted-foreground">
          {uploadedFileNames.length > 1 ? "They're" : "It's"} saved to the class, and you can add assignments as they
          come.
        </p>
      </div>
    </StepShell>
  );
}
