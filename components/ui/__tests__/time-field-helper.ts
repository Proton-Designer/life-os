import { screen, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

/**
 * Drives a TimeField12 in a test the way a person would: open the pill, click the hour, minute and AM/PM rows in the
 * wheel's listboxes, then press Done. `time12` is "9:30 PM". `label` is the field's aria-label ("Start time"). The
 * minute must be on the field's step (default 5) unless the field was given that exact minute already.
 */
export async function pickTime12(user: UserEvent, label: string, time12: string): Promise<void> {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(time12.trim());
  if (!m) throw new Error(`pickTime12: expected "h:mm AM|PM", got "${time12}"`);
  await user.click(pill(label));
  const option = (listbox: string, name: string) => within(screen.getByRole("listbox", { name: `${label} ${listbox}` })).getByRole("option", { name });
  await user.click(option("hour", String(Number(m[1]))));
  await user.click(option("minute", m[2]!));
  await user.click(option("AM or PM", m[3]!.toUpperCase()));
  await user.click(screen.getByRole("button", { name: "Done" }));
}

/** The 12-hour text a TimeField12 currently shows, e.g. "9:30 PM" (or "" when empty). */
export function readTime12(label: string): string {
  const text = pill(label).textContent?.trim() ?? "";
  return text === "Set time" ? "" : text;
}

function pill(label: string): HTMLElement {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return screen.getByRole("button", { name: new RegExp(`^(Set ${escaped}|${escaped}: )`) });
}
