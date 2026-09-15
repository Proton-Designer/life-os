import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { computeOverconfidenceVerdict, type ConfidenceOutcomePair, type OverconfidenceVerdict } from "./overconfidence";

type TypedClient = SupabaseClient<Database>;

/**
 * Phase 2 #P2-08 — I/O half of the overconfidence detector. Pure
 * calibration math lives in ./overconfidence.ts (computeOverconfidenceVerdict);
 * this just fetches the (confidence, correct) pairs and filters out rows
 * that can't contribute one.
 *
 * CUMULATIVE, NOT WINDOWED: unlike P2-03's weekly recap, this reads the
 * user's ENTIRE review history, no date bound — a calibration claim needs
 * as much evidence as exists, and there is no "this week's calibration"
 * concept the way there's "this week's retention."
 *
 * FILTERED, NOT COERCED: `reviews.confidence` is null for a review that
 * predates migration 085 (confidence-tap capture didn't exist yet) or
 * simply wasn't answered with a confidence tap; `reviews.correct` is null
 * for other row shapes. Both are excluded from the sample entirely rather
 * than treated as a level/outcome — an unanswered question about
 * confidence is not the same as a "guessing" answer, and coercing it
 * would quietly inflate or bias the sample this feature exists to judge
 * honestly.
 */
export async function getOverconfidenceVerdict(supabase: TypedClient, userId: string): Promise<OverconfidenceVerdict> {
  const { data, error } = await supabase
    .from("reviews")
    .select("confidence, correct")
    .eq("user_id", userId)
    .not("confidence", "is", null)
    .not("correct", "is", null);
  if (error) throw error;

  const pairs: ConfidenceOutcomePair[] = (data ?? [])
    .filter((r): r is { confidence: "sure" | "think_so" | "guessing"; correct: boolean } => r.confidence !== null && r.correct !== null)
    .map((r) => ({ confidence: r.confidence, correct: r.correct }));

  return computeOverconfidenceVerdict(pairs);
}
