import { screen } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

/**
 * Drives a TimeField12 in a test the way a person would: pick the hour, minute and AM/PM from the three selects.
 * `time12` is "9:30 PM". `label` is the field's aria-label ("Start time"). Minute must be on the field's step (default 5)
 * unless the field was given that exact minute already.
 */
export async function pickTime12(user: UserEvent, label: string, time12: string): Promise<void> {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(time12.trim());
  if (!m) throw new Error(`pickTime12: expected "h:mm AM|PM", got "${time12}"`);
  await user.selectOptions(screen.getByRole("combobox", { name: `${label} hour` }), String(Number(m[1])));
  await user.selectOptions(screen.getByRole("combobox", { name: `${label} minute` }), String(Number(m[2])));
  await user.selectOptions(screen.getByRole("combobox", { name: `${label} AM or PM` }), m[3]!.toUpperCase());
}

/** The 12-hour text a TimeField12 currently shows, e.g. "9:30 PM" (or "" when empty). */
export function readTime12(label: string): string {
  const h = (screen.getByRole("combobox", { name: `${label} hour` }) as HTMLSelectElement).value;
  const mi = (screen.getByRole("combobox", { name: `${label} minute` }) as HTMLSelectElement).value;
  const ap = (screen.getByRole("combobox", { name: `${label} AM or PM` }) as HTMLSelectElement).value;
  return h === "" ? "" : `${h}:${mi.padStart(2, "0")} ${ap}`;
}
