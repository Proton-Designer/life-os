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
      href: `/personal/self_mastery/${b.id}`,
    };
  });
});
