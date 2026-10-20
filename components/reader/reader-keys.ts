import type { ReaderMode } from "@/lib/reader/reader-storage";

export type ReaderKeyAction =
  | "toggle"
  | "back"
  | "forward"
  | "backParagraph"
  | "forwardParagraph"
  | "wpmUp"
  | "wpmDown"
  | "listen";

/** Same notion as week-close-button's: keys belong to the field, dialog or menu the user is in. */
function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return true;
  return el.closest('[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]') !== null;
}

/**
 * Maps a keydown to a reader action, or null when the key is not ours. Space leaves a focused button/link alone (it
 * already means "activate"); up/down only change speed in RSVP mode, where there is nothing to scroll.
 */
export function readerKeyAction(
  e: Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey" | "defaultPrevented" | "target">,
  mode: ReaderMode
): ReaderKeyAction | null {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return null;
  if (isTypingTarget(e.target)) return null;
  switch (e.key) {
    case " ": {
      const tag = e.target instanceof HTMLElement ? e.target.tagName : "";
      return tag === "BUTTON" || tag === "A" ? null : "toggle";
    }
    case "ArrowLeft":
      return e.shiftKey ? "backParagraph" : "back";
    case "ArrowRight":
      return e.shiftKey ? "forwardParagraph" : "forward";
    case "ArrowUp":
      return mode === "rsvp" ? "wpmUp" : null;
    case "ArrowDown":
      return mode === "rsvp" ? "wpmDown" : null;
    case "l":
    case "L":
      return "listen";
    default:
      return null;
  }
}
