import { redirect } from "next/navigation";

/** Retired as a screen (IA-P3a): Habits is a step of the weekly reset. Kept as a redirect (bookmarks, old links); nothing was deleted. */
export default function HabitsRedirect() {
  redirect("/week#habits");
}
