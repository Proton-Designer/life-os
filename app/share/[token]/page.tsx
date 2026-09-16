import { notFound } from "next/navigation";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getPublicQuestionBankCore } from "@/lib/school/public-question-bank-core";
import { checkPublicShareViewLimit } from "@/lib/school/public-share-rate-limit";
import { PublicQuestionBankDrill } from "@/components/school/public-question-bank-drill";

// P3-08: force-dynamic, deliberately — this reads `questions`/
// `class_question_shares` LIVE on every request. There is no snapshot
// anywhere for an owner's edit or retirement (the only "delete" this app
// has) to go stale against; the very next request after either always
// reflects it. Never add ISR/a cache tag to this route.
export const dynamic = "force-dynamic";

// Opus Lead's requirement: this is a user's own study material, never a
// public search result. Emits <meta name="robots" content="noindex,
// nofollow">; the matching X-Robots-Tag HTTP header is added in
// next.config.ts's headers() rule for /share/:path*, since a Server
// Component can't set an arbitrary response header directly.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function PublicQuestionBankPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const serviceClient = createServiceRoleClient();

  // Rate-limited and "not found" are DELIBERATELY the same response (see
  // the task's own board Log for the full reasoning) -- a hammering script
  // cannot distinguish "this token doesn't exist" from "you're throttled"
  // from "this class doesn't want sharing" either.
  const rateVerdict = await checkPublicShareViewLimit(serviceClient, await headers());
  if (rateVerdict.limited) notFound();

  const bank = await getPublicQuestionBankCore(serviceClient, token);
  if (bank === null) notFound();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-lg font-semibold">{bank.className}</h1>
        <p className="text-sm text-muted-foreground">A shared question bank — drill mode, no account needed.</p>
      </div>
      <PublicQuestionBankDrill questions={bank.questions} />
    </main>
  );
}
