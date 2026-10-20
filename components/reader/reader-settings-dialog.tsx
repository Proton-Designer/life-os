"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { SpeechVoiceInfo } from "@/lib/reader/narration";
import { MAX_WPM, MIN_WPM, WPM_STEP } from "@/lib/reader/rsvp";
import { READER_PALETTES, READER_THEMES, READER_THEME_LABEL } from "@/lib/reader/themes";
import type { ReaderSettings } from "@/lib/reader/types";
import { cn } from "@/lib/utils";

export function ReaderSettingsDialog({
  open,
  onOpenChange,
  settings,
  onChange,
  speech,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: ReaderSettings;
  onChange: (patch: Partial<ReaderSettings>) => void;
  speech: { supported: boolean; voices: SpeechVoiceInfo[] };
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reader settings</DialogTitle>
        </DialogHeader>
        <div className="flex max-h-[70dvh] flex-col gap-5 overflow-y-auto pr-1" data-testid="reader-settings">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="reader-wpm">Speed</Label>
              <span className="text-xs tabular-nums text-muted-foreground">{settings.wpm} words per minute</span>
            </div>
            <input
              id="reader-wpm"
              type="range"
              min={MIN_WPM}
              max={MAX_WPM}
              step={WPM_STEP}
              value={settings.wpm}
              onChange={(e) => onChange({ wpm: Number(e.target.value) })}
              className="h-8 w-full cursor-pointer accent-primary"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="reader-font">Text size</Label>
              <span className="text-xs tabular-nums text-muted-foreground">{Math.round(settings.fontScale * 100)}%</span>
            </div>
            <input
              id="reader-font"
              type="range"
              min={0.75}
              max={2}
              step={0.05}
              value={settings.fontScale}
              onChange={(e) => onChange({ fontScale: Number(e.target.value) })}
              className="h-8 w-full cursor-pointer accent-primary"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Theme</Label>
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="Theme">
              {READER_THEMES.map((t) => {
                const p = READER_PALETTES[t];
                const active = settings.theme === t;
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onChange({ theme: t })}
                    style={{ background: p.bg, color: p.fg, borderColor: active ? p.focal : p.border }}
                    className={cn("flex min-h-11 items-center justify-center gap-2 rounded-lg border-2 px-3 text-sm", active && "font-semibold")}
                  >
                    <span aria-hidden style={{ background: p.focal }} className="size-2.5 rounded-full" />
                    {READER_THEME_LABEL[t]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col">
              <Label htmlFor="reader-focal-lines">Focus guide lines</Label>
              <span className="text-xs text-muted-foreground">Marks where your eyes should rest in fast mode.</span>
            </div>
            <Switch id="reader-focal-lines" checked={settings.focalLines} onCheckedChange={(v) => onChange({ focalLines: v })} />
          </div>

          <div className="flex flex-col gap-3" data-testid="reader-narration-settings">
            <Label>Listening</Label>
            {speech.supported ? (
              <>
                <select
                  aria-label="Voice"
                  value={settings.voiceUri ?? ""}
                  onChange={(e) => onChange({ voiceUri: e.target.value || null })}
                  className="min-h-11 w-full rounded-lg border bg-background px-3 text-sm"
                >
                  <option value="">Default voice</option>
                  {speech.voices.map((v) => (
                    <option key={v.uri} value={v.uri}>
                      {v.name} ({v.lang}){v.local ? "" : " - needs internet"}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Speaking speed"
                  value={settings.speechRate}
                  onChange={(e) => onChange({ speechRate: Number(e.target.value) })}
                  className="min-h-11 w-full rounded-lg border bg-background px-3 text-sm"
                >
                  <option value={1}>Match my reading speed</option>
                  {[0.7, 0.85, 1.15, 1.3, 1.5, 1.75, 2].map((r) => (
                    <option key={r} value={r}>
                      {r}x
                    </option>
                  ))}
                </select>
                <span className="text-xs text-muted-foreground">Uses voices installed on this device, so it can work offline. Voices marked &quot;needs internet&quot; will not.</span>
              </>
            ) : (
              <span className="text-xs text-muted-foreground">This browser cannot read aloud, so the Listen button is hidden.</span>
            )}
          </div>

          {/* R7 slot: daily word goal. */}
        </div>
      </DialogContent>
    </Dialog>
  );
}
