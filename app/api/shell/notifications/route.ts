import { shellRead } from "@/lib/api/shell-read";
import { getNotifications } from "@/lib/notifications/get-notifications";

export const dynamic = "force-dynamic";

/** NAV-02: replaces the getNotificationsForNow Server Action (the bell's poll). Server time, not the client's. */
export async function GET() {
  return shellRead((userId) => getNotifications(userId, new Date()));
}
