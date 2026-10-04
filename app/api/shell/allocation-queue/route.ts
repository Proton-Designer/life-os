import { shellRead } from "@/lib/api/shell-read";
import { getPendingAllocationQueue } from "@/lib/checkins/get-allocation-queue";

export const dynamic = "force-dynamic";

/** NAV-02: replaces the getAllocationQueueForNow Server Action (the check-in queue's poll). */
export async function GET() {
  return shellRead((userId) => getPendingAllocationQueue(userId, new Date()));
}
