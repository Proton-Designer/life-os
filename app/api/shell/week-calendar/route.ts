import { shellRead } from "@/lib/api/shell-read";
import { getWeekCalendar } from "@/app/(app)/calendar/actions";

export const dynamic = "force-dynamic";

/** NAV-02: the calendar dialog's read (idle warm on every page load + each open) without the Server Action queue. */
export async function GET() {
  return shellRead(() => getWeekCalendar());
}
