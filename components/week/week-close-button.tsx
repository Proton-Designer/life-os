"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Back when the user came from inside the app; Home otherwise (external referrer or a fresh tab). */
export function shouldGoBack(referrer: string, origin: string, historyLength: number): boolean {
  if (historyLength <= 1) return false;
  if (!referrer) return true;
  try {
    return new URL(referrer).origin === origin;
  } catch {
    return false;
  }
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return true;
  return el.closest('[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]') !== null;
}

function useLeaveWeek() {
  const router = useRouter();
  return useCallback(() => {
    if (shouldGoBack(document.referrer, window.location.origin, window.history.length)) router.back();
    else router.push("/");
  }, [router]);
}

/** Header control: X + "Close" (icon-only under ~400 px), plus Escape outside inputs and dialogs. */
export function WeekCloseButton() {
  const leave = useLeaveWeek();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented || isTypingTarget(e.target)) return;
      leave();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [leave]);
  return (
    <Button type="button" variant="outline" size="sm" onClick={leave} aria-label="Close weekly reset" data-testid="week-close">
      <X className="size-4" aria-hidden />
      <span className="hidden min-[400px]:inline">Close</span>
    </Button>
  );
}

/** Bottom of the page, after step 5. */
export function WeekDoneButton() {
  const leave = useLeaveWeek();
  return (
    <div className="flex justify-end pb-4">
      <Button type="button" onClick={leave} data-testid="week-done">
        Done
      </Button>
    </div>
  );
}
