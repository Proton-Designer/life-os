"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sprout } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { promoteLesson } from "@/lib/promotions/actions";
import { hasAction, type PromotableAreasState } from "@/lib/promotions/types";

const TEXTAREA_CLASS =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

export interface PromoteLessonSheetProps {
  lessonId: string;
  lessonTitle: string;
  /** `lessons.action_template`. Null for a lesson that never got one. */
  actionTemplate: string | null;
  areas: PromotableAreasState;
  /** The active promotion for this lesson, if one is already running. */
  existingPromotion: { id: string; acceptedText: string; verdictDueAt: string } | null;
  trigger?: React.ReactNode;
}

function formatDueDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

/**
 * The confirm sheet that turns a lesson's `action_template` into a real
 * commitment (`lesson_promotions`, migration 124).
 *
 * THE DEFAULT TRIGGER SAYS "Commit to this", NOT "Try this". `LessonCard`
 * already prints "Try this" as the LABEL above the proposed action, so the
 * original default put the same two words twice on one lesson -- one naming
 * the suggestion, one committing to it. The LifeOS lead hit it at the mount
 * and his test-id assertion passed the whole time, because both existed. A
 * label collision is invisible to every assertion that checks for presence.
 * Changed here rather than only at his mount site, so the next surface to
 * mount this cannot inherit the same collision.
 *
 * THREE STATES THIS RENDERS HONESTLY, none of them a placeholder that looks
 * like data:
 *
 *   no action_template  -> renders NOTHING AT ALL. A lesson with no proposed
 *                          action has nothing to commit to, and an inert
 *                          button would be a promise the app cannot keep.
 *   already promoted    -> shows the commitment and its due date, with no
 *                          form. `lesson_promotions_active_per_lesson` makes
 *                          a second active promotion impossible, so offering
 *                          the form would be offering a guaranteed error.
 *   no areas            -> says so, plainly, and does not render an empty
 *                          picker. `area_id` is NOT NULL and FKs to
 *                          `user_domains`; an account that never went through
 *                          domain selection has no row to point at, so this
 *                          is not "nothing to show yet", it is "not possible
 *                          for this account until it has areas".
 */
export function PromoteLessonSheet({
  lessonId,
  lessonTitle,
  actionTemplate,
  areas,
  existingPromotion,
  trigger,
}: PromoteLessonSheetProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [acceptedText, setAcceptedText] = useState(actionTemplate ?? "");
  const [areaId, setAreaId] = useState<string>(areas.status === "ready" ? (areas.areas[0]?.id ?? "") : "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Nothing to promote. See the header: this is deliberate silence, not an
  // early return covering a missing case. Uses the SAME predicate the mounting
  // surface uses to decide whether to render its wrapper -- one rule, one
  // definition, so the two cannot drift into a visible empty box.
  if (!hasAction(actionTemplate)) return null;

  function handleOpenChange(next: boolean) {
    if (isPending) return;
    setOpen(next);
    if (!next) {
      setAcceptedText(actionTemplate ?? "");
      setError(null);
    }
  }

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const result = await promoteLesson({ lessonId, acceptedText, areaId });
      if (!result.ok) {
        // R15: the server's sentence, shown where the user is looking.
        // Never replaced with a generic one and never only logged.
        setError(result.message);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  if (existingPromotion) {
    return (
      <div className="rounded-md border border-border bg-muted/30 px-3 py-2" data-testid="promotion-active">
        <p className="text-xs font-medium text-muted-foreground">You&rsquo;re testing this</p>
        <p className="mt-1 text-sm">{existingPromotion.acceptedText}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Verdict due {formatDueDate(existingPromotion.verdictDueAt)}
        </p>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button type="button" variant="outline" size="sm" className="gap-1.5" data-testid="promote-lesson-trigger">
            <Sprout className="size-4" />
            Commit to this
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Try this for thirty days</DialogTitle>
          <DialogDescription>
            From &ldquo;{lessonTitle}&rdquo;. In a month the evening close will ask you whether it stuck.
          </DialogDescription>
        </DialogHeader>

        {areas.status === "no-areas" ? (
          <p className="text-sm text-muted-foreground" data-testid="promote-no-areas">
            This account doesn&rsquo;t have areas set up yet, and a commitment has to belong to one. Choose your
            areas in settings and this becomes available.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="promotion-accepted-text">What you&rsquo;ll actually do</Label>
              <textarea
                id="promotion-accepted-text"
                value={acceptedText}
                onChange={(e) => setAcceptedText(e.target.value)}
                rows={4}
                className={TEXTAREA_CLASS}
                disabled={isPending}
              />
              <p className="text-xs text-muted-foreground">
                The book&rsquo;s wording is filled in. Change it to yours &mdash; you&rsquo;re the one doing it.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="promotion-area">Which area of your life</Label>
              <Select value={areaId} onValueChange={setAreaId} disabled={isPending}>
                <SelectTrigger id="promotion-area" data-testid="promote-area-select">
                  <SelectValue placeholder="Choose an area" />
                </SelectTrigger>
                <SelectContent>
                  {areas.areas.map((area) => (
                    <SelectItem key={area.id} value={area.id}>
                      {area.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive" role="alert" data-testid="promote-error">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)} disabled={isPending}>
            Not now
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isPending || areas.status === "no-areas"}
            data-testid="promote-submit"
          >
            {isPending ? "Saving…" : "Start the thirty days"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
