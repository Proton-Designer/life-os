"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

/**
 * ONB item 1 (and its identical twin on /login): the enclosing page is a
 * Server Component with a plain `<form action={...}>` — no client JS in the
 * submit path at all, so a plain `<Button type="submit">` never showed any
 * pending state. Not a speed problem: `signUp`/`signIn` each make one real
 * external Supabase Auth call that cannot be made instant from here. The
 * bug was a MISSING-FEEDBACK problem — the button didn't even disable on
 * click — and a skeleton over the real latency would have hidden that
 * rather than fixed it.
 *
 * `useFormStatus` reads the ENCLOSING <form>'s pending state without
 * requiring the whole page to become a client component — this button is
 * the only client boundary. It only works as a descendant of the `<form>`
 * whose action it reports on, per React's own contract for the hook.
 */
export function AuthSubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending} aria-busy={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}
