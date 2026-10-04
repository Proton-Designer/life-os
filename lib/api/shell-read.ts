import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/supabase/auth";

// NAV-02: the shell's background reads (notifications, allocation queue, distraction counts, week
// calendar) are GET route handlers, NOT Server Actions. Next dispatches Server Actions from one
// client strictly one at a time (node_modules/next/dist/docs/01-app/02-guides/server-actions.md,
// "Sequential dispatch on the client"; client/components/app-router-instance.js dispatchAction), so
// a poll in flight made the user's next tap-write wait behind it. A fetch() to a route handler is
// outside that queue. Same cookie session, same RLS (the handlers call the same readers as the old
// actions), and never cached: `private, no-store`, per user.
const NO_STORE = { "Cache-Control": "private, no-store" } as const;

export async function shellRead(read: (userId: string) => Promise<unknown>): Promise<NextResponse> {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: NO_STORE });
  try {
    return NextResponse.json(await read(user.id), { headers: NO_STORE });
  } catch (err) {
    console.error("[shell-read]", err);
    // Never echo the error text to the client.
    return NextResponse.json({ error: "failed" }, { status: 500, headers: NO_STORE });
  }
}
