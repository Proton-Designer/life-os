import { cache } from "react";
import { requireUser } from "@/lib/supabase/auth";
import { untypedFrom } from "./untyped-from";
import { INGESTION_STAGE_LABEL, bucketIngestStage, looksUnclaimed } from "./ingestion-stage";
import type { InProgressItem } from "@/components/shell/in-progress-banner";
import type { BookStatus, IngestStage } from "./types";

interface InProgressBookRow {
  id: string;
  title: string;
  status: BookStatus;
  stage: IngestStage;
  progress_pct: number;
  created_at: string;
}

// D-004's Home affordance, Self-Mastery's half of it — the shape (plain
// InProgressItem[]) is generic; only this function is Self-Mastery-
// specific, reading `books` for the current user still uploading/
// processing. `failed` books are deliberately excluded: this banner is
// "work in progress," not a place to relitigate a failure (that's the
// book detail page's job).
export const getInProgressBooks = cache(async (): Promise<InProgressItem[]> => {
  const { supabase, userId } = await requireUser();
  const now = new Date();

  // The `books` table doesn't exist on the live Supabase project yet (this
  // was built against the scratch DB — see types.ts's header) — until the
  // Lead's migration lands, this query fails with an undefined-table error
  // on every request. Home must never break because Self-Mastery's schema
  // isn't deployed yet, so this degrades to "nothing in progress" rather
  // than throwing. Remove this catch once the migration is live and the
  // failure mode would mean something real again.
  const { data, error } = await untypedFrom(supabase, "books")
    .select("id, title, status, stage, progress_pct, created_at")
    .eq("user_id", userId)
    .in("status", ["uploading", "processing"])
    .order("created_at", { ascending: false })
    .returns<InProgressBookRow[]>();
  if (error) {
    console.warn("[self-mastery] getInProgressBooks: query failed, likely pre-migration — returning empty", error.message);
    return [];
  }

  return (data ?? []).map((b) => {
    const statusLabel = looksUnclaimed(b.stage, new Date(b.created_at), now)
      ? "Not yet started"
      : b.status === "uploading"
        ? "Uploading…"
        : INGESTION_STAGE_LABEL[bucketIngestStage(b.stage)];
    return {
      id: b.id,
      title: b.title,
      statusLabel,
      progressPct: b.progress_pct,
      // KNOWN BUG, FIXED HERE (S6, 2026-09-14): this used to be
      // `/personal/self_mastery/${b.id}` — dead for any legacy-mode
      // account, including the owner's own real daily account
      // (ayman.0704m@gmail.com). `app/(app)/personal/[subdomain]/layout.tsx`
      // and `personal/page.tsx` both redirect a legacy-mode account away
      // from `/personal/*` entirely (`kept.length === 0 -> redirect("/")`),
      // so Home's own "resume this book" banner — this function's whole
      // reason to exist — sent a legacy user back to Home the moment they
      // clicked it. `/self-mastery/${b.id}` (app/(app)/self-mastery/
      // [bookId]/page.tsx) renders the exact same BookDetailView without
      // that gate, and works identically for a domains-mode account too —
      // one canonical, mode-independent URL rather than branching this
      // function on `getUserDomains()` just to pick between two routes that
      // render the same component.
      href: `/self-mastery/${b.id}`,
    };
  });
});
